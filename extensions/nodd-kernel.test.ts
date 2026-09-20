import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import register, { createKernel } from "./nodd-kernel.ts";

type Handler = (event: any, ctx?: any) => any;

function fakePi() {
  const handlers = new Map<string, Handler>();
  const entries: Array<{ type: string; data: unknown }> = [];
  return {
    handlers,
    entries,
    on(event: string, handler: Handler) { handlers.set(event, handler); },
    registerTool() {},
    appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
    emit(event: string, payload: any, ctx?: unknown) { return handlers.get(event)?.(payload, ctx); },
  };
}

test("the config is read from the given home, so the suite never reads the user's", () => {
  // Without an injectable home, `register()` reads the real `~/.pi/nodd.json`
  // and the suite's verdict depends on the machine running it: measured on one
  // commit, a local config with the gates off turned 434 passes into 408.
  const home = mkdtempSync(join(tmpdir(), "nodd-home-"));
  mkdirSync(join(home, ".pi"), { recursive: true });
  writeFileSync(join(home, ".pi", "nodd.json"), JSON.stringify({ gates: { classify: { enabled: false } } }));

  const kernel = register(fakePi() as never, mkdtempSync(join(tmpdir(), "nodd-cwd-")), home);
  assert.deepEqual(kernel.policy().config, { classify: { enabled: false } }, "the given home is what was read");

  const other = register(fakePi() as never, mkdtempSync(join(tmpdir(), "nodd-cwd-")), mkdtempSync(join(tmpdir(), "nodd-empty-")));
  assert.deepEqual(other.policy().config, {}, "an empty home means nobody chose, whatever the real one says");
});

test("reloadPolicy picks up a config written after the session started", () => {
  // `/nodd-gates off` writes the file; without a re-read the gate keeps blocking
  // until pi restarts, while disk already says it is off. A user who turns off
  // the kill switch and watches it keep blocking concludes it does not work.
  const home = mkdtempSync(join(tmpdir(), "nodd-home-"));
  mkdirSync(join(home, ".pi"), { recursive: true });
  const kernel = register(fakePi() as never, mkdtempSync(join(tmpdir(), "nodd-cwd-")), home);
  assert.deepEqual(kernel.policy().config, {}, "nothing configured yet");

  writeFileSync(join(home, ".pi", "nodd.json"), JSON.stringify({ gates: { track: { enabled: false } } }));
  kernel.reloadPolicy();
  assert.deepEqual(kernel.policy().config, { track: { enabled: false } }, "the new config is in effect");
});

test("/nodd-gates disable takes effect without restarting pi", () => {
  // The kill switch is user-owned: it must obey at once. Reading the config
  // only at startup left the gate blocking while disk already said it was off,
  // and the refusal kept offering /nodd-allow as though nobody had decided —
  // a user who turns it off and watches it keep blocking concludes it is broken.
  const home = mkdtempSync(join(tmpdir(), "nodd-home-"));
  mkdirSync(join(home, ".pi"), { recursive: true });
  const pi = fakePi();
  register(pi as never, mkdtempSync(join(tmpdir(), "nodd-cwd-")), home);

  const write = { toolName: "write", toolCallId: "c1", input: { file_path: "a.ts", content: "x" } };
  assert.equal(pi.emit("tool_call", write)?.block, true, "undeclared writes are blocked while the gate is on");

  // What `/nodd-gates disable classify` writes, mid-session.
  writeFileSync(join(home, ".pi", "nodd.json"), JSON.stringify({ gates: { classify: { enabled: false } } }));

  const after = pi.emit("tool_call", { ...write, toolCallId: "c2" });
  assert.equal(after, undefined, "the very next call sees the gate off, with no restart");
});

test("a read-only session of read/grep/ls produces zero blocks", () => {
  const pi = fakePi();
  register(pi as never);
  const calls = [
    { toolName: "read", toolCallId: "c1", input: { path: "a.ts" } },
    { toolName: "grep", toolCallId: "c2", input: { pattern: "x" } },
    { toolName: "ls", toolCallId: "c3", input: { path: "." } },
    { toolName: "read", toolCallId: "c4", input: { path: "b.ts" } },
  ];
  for (const call of calls) {
    const decision = pi.emit("tool_call", call);
    assert.ok(decision === undefined || decision.block !== true, `${call.toolName} must not be blocked`);
    pi.emit("tool_result", { ...call, isError: false, content: "" });
  }
});

test("tool_call inserts into pending and tool_result moves it into committed", () => {
  const kernel = createKernel();
  kernel.onToolCall({ toolName: "write", toolCallId: "c1", input: { path: "a.ts" } });
  assert.equal(kernel.state.pending.size, 1);
  assert.equal(kernel.state.committed.filesWritten.size, 0, "a pending write is not a written file");

  kernel.onToolResult({ toolName: "write", toolCallId: "c1", input: { path: "a.ts" }, isError: false, content: "" });
  assert.equal(kernel.state.pending.size, 0);
  assert.deepEqual([...kernel.state.committed.filesWritten.keys()], ["a.ts"]);
});

test("evidence helpers take Committed, so a pending sibling is structurally unreachable", () => {
  const kernel = createKernel();
  // Same assistant batch: two siblings preflighted, neither finished.
  kernel.onToolCall({ toolName: "bash", toolCallId: "c1", input: { command: "npm test" } });
  kernel.onToolCall({ toolName: "nodd_task", toolCallId: "c2", input: { action: "check", id: "T1" } });

  const evidence = kernel.evidenceView();
  assert.equal(evidence.commandResults.length, 0, "a pending sibling must not be visible as evidence");
  assert.ok(!("pending" in evidence), "the evidence view has no pending half at all");
});

test("session replay is idempotent by toolCallId", () => {
  const kernel = createKernel();
  const entry = { toolName: "read", toolCallId: "c1", input: { path: "a.ts" }, isError: false, content: "" };
  kernel.onToolResult(entry);
  kernel.onToolResult(entry);
  assert.equal(kernel.state.committed.toolCalls, 1);
});

// This test used to emit `{ entries: [...] }` on the event and read
// `entry.type`. pi's SessionStartEvent has no `entries` field at all
// (`dist/core/extensions/types.d.ts:416-422`) — the log is reached through
// `ctx.sessionManager.getEntries()`, and a custom entry is
// `{ type: "custom", customType, data }` (`dist/core/session-manager.d.ts:69-73`).
// So the old test passed against a shape production never receives, and the
// replay path it "covered" was dead code. It now uses pi's real contract.
test("session_start replays the session log's nodd entries into committed state", () => {
  const pi = fakePi();
  const kernel = register(pi as never);
  const entries = [
    { type: "custom", customType: "nodd:observation", data: { toolName: "read", toolCallId: "r1", input: { path: "a.ts" }, isError: false, resultText: "", at: "t" } },
    { type: "custom", customType: "nodd:observation", data: { toolName: "write", toolCallId: "w1", input: { path: "b.ts" }, isError: false, resultText: "", at: "t" } },
    { type: "custom", customType: "something:else", data: { nope: true } },
    { type: "message", role: "user" },
  ];
  pi.emit("session_start", { type: "session_start", reason: "resume" }, { sessionManager: { getEntries: () => entries } });

  assert.deepEqual([...kernel.state.committed.filesRead], ["a.ts"]);
  assert.deepEqual([...kernel.state.committed.filesWritten.keys()], ["b.ts"]);
});

test("replay restores context but never evidence: a run another process saw is not ours", () => {
  const pi = fakePi();
  const kernel = register(pi as never);
  const entries = [
    { type: "custom", customType: "nodd:observation", data: { toolName: "write", toolCallId: "w1", input: { path: "b.ts" }, isError: false, resultText: "", at: "t" } },
    { type: "custom", customType: "nodd:observation", data: { toolName: "bash", toolCallId: "b1", input: { command: "npm test" }, isError: false, resultText: "42 passing", at: "t" } },
  ];
  pi.emit("session_start", { type: "session_start", reason: "resume" }, { sessionManager: { getEntries: () => entries } });

  assert.deepEqual([...kernel.state.committed.filesWritten.keys()], ["b.ts"], "context comes back");
  assert.deepEqual(kernel.state.committed.commandResults, [], "evidence does not");
});

test("a session_start with no session manager never throws", () => {
  const pi = fakePi();
  register(pi as never);
  pi.emit("session_start", { type: "session_start", reason: "startup" });
  pi.emit("session_start", { type: "session_start", reason: "startup" }, {});
});

test("terminate is never assigned anywhere in the extension", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nodd-kernel.ts"), "utf8");
  assert.ok(!/terminate\s*[:=]/.test(src), "blocking one sibling must never abort the batch");
});

// ---------------------------------------------------------------------------
// Visibility. Gates do nothing until they block, so a healthy session is
// indistinguishable from an extension that failed to load — unless it says so.
// ---------------------------------------------------------------------------
/** A pi whose tools are registered, plus a footer to read back. */
function harnessWithUi() {
  const tools = new Map<string, { name: string; handler: (args: unknown) => unknown }>();
  const handlers = new Map<string, Handler>();
  const status = new Map<string, string | undefined>();
  const pi = {
    on(event: string, handler: Handler) { handlers.set(event, handler); },
    registerTool(tool: { name: string; handler: (args: unknown) => unknown }) { tools.set(tool.name, tool); },
    appendEntry() {},
  };
  register(pi as never, mkdtempSync(join(tmpdir(), "nodd-ui-")), mkdtempSync(join(tmpdir(), "nodd-uih-")));
  return { handlers, tools, ui: { ui: { setStatus: (k: string, v?: string) => status.set(k, v) } }, status };
}

test("the footer says nodd is running before anything has happened", () => {
  const { handlers, ui, status } = harnessWithUi();
  handlers.get("session_start")?.({}, { sessionManager: { getEntries: () => [] }, ...ui });
  assert.equal(status.get("nodd"), "nodd · sin declarar");
});

test("the footer follows the declared route", () => {
  const { handlers, tools, ui, status } = harnessWithUi();
  handlers.get("session_start")?.({}, { sessionManager: { getEntries: () => [] }, ...ui });

  const args = { intent: "change", route: "tracked", slug: "auth", title: "login", summary: "s" };
  handlers.get("tool_call")?.({ toolName: "nodd_declare", toolCallId: "d1", input: args }, ui);
  const out = tools.get("nodd_declare")?.execute("d1", args)?.content?.[0]?.text;
  handlers.get("tool_result")?.({ toolName: "nodd_declare", toolCallId: "d1", input: args, isError: false, content: out }, ui);

  assert.equal(status.get("nodd"), "nodd · tracked · auth");
});

test("a host without a footer does not break the session", () => {
  // `ctx.ui` is absent in print mode (`extensions.md:947`). A status update is
  // decoration; losing it must never cost a tool call.
  const { handlers } = harnessWithUi();
  assert.doesNotThrow(() => handlers.get("session_start")?.({}, { sessionManager: { getEntries: () => [] } }));
  assert.doesNotThrow(() => handlers.get("tool_call")?.({ toolName: "read", toolCallId: "r1", input: { file_path: "a" } }));
});

// ---------------------------------------------------------------------------
// T003 -- D1's blast radius: gate-promotion and gate-evidence both read
// `filesWritten`, and both were contaminated by a refused write counting as a
// real one. These go through the registered `tool_call`/`tool_result`
// handlers, exactly as `nodd-enforcement.test.ts` does, so they exercise the
// real path rather than a gate function in isolation.
// ---------------------------------------------------------------------------
function handlerSession(cwd: string) {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, { execute: (id: string, args: unknown) => Promise<{ content?: Array<{ text?: string }> }> }>();
  const pi = {
    on(event: string, handler: Handler) { handlers.set(event, handler); },
    registerTool(tool: { name: string; execute: (id: string, args: unknown) => Promise<unknown> }) { tools.set(tool.name, tool as never); },
    appendEntry() {},
  };
  register(pi as never, cwd);
  handlers.get("session_start")?.({}, { sessionManager: { getEntries: () => [] } });
  let n = 0;
  return {
    call(toolName: string, input: Record<string, unknown>) {
      return handlers.get("tool_call")?.({ toolName, toolCallId: `c${++n}`, input });
    },
    observe(toolName: string, input: Record<string, unknown>, isError = false) {
      handlers.get("tool_result")?.({ toolName, toolCallId: `c${++n}`, input, isError, content: "" });
    },
    async runTool(toolName: string, args: Record<string, unknown>) {
      const id = `c${++n}`;
      handlers.get("tool_call")?.({ toolName, toolCallId: id, input: args });
      const result = await tools.get(toolName)?.execute(id, args);
      const text = result?.content?.[0]?.text;
      handlers.get("tool_result")?.({ toolName, toolCallId: id, input: args, isError: false, content: text });
      return text;
    },
  };
}

test("gate-promotion: a refused write does not inflate observedFiles into false divergence", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodd-t003-"));
  const s = handlerSession(cwd);
  await s.runTool("nodd_declare", {
    intent: "change", route: "tracked", slug: "scope", summary: "one file",
    runner: "npm test", files: ["/repo/a.ts"],
  });
  s.observe("subagent", { agent: "writer" });
  // Two writes refused, to files never declared -- must not count toward
  // `observedFiles`, or the next real write on the one declared file would be
  // refused as "3 written against 1 declared".
  s.observe("write", { path: "/repo/never-1.ts" }, true);
  s.observe("write", { path: "/repo/never-2.ts" }, true);

  const blocked = s.call("write", { path: "/repo/a.ts", content: "x" });
  assert.equal((blocked as { block?: boolean } | undefined)?.block, undefined, "the one declared file must not read as divergence");
});

test("gate-evidence: a refused write does not advance lastWriteSeq past evidence that legitimately postdates the real write", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodd-t003-"));
  const s = handlerSession(cwd);
  await s.runTool("nodd_declare", {
    intent: "change", route: "tracked", slug: "login", summary: "build login",
    runner: "npm test", files: ["/repo/src/login.ts"],
  });
  await s.runTool("nodd_task", { action: "add", id: "T1", title: "Implement login", slug: "login" });

  s.observe("edit", { path: "/repo/src/login.ts" }); // the real write
  s.observe("bash", { command: "npm test" }); // the genuine, postdating green
  // A refused edit of the *same declared file*, after the green run: it must
  // not advance `lastWriteSeq` past the green, or the genuine evidence would
  // read as stale-green and be refused for a write that never happened.
  s.observe("edit", { path: "/repo/src/login.ts" }, true);

  const reply = String(await s.runTool("nodd_task", { action: "check", id: "T1", slug: "login" }));
  assert.match(reply, /checked in/, `a refused write after the green run must not invalidate it, got: ${reply}`);
});



// ---------------------------------------------------------------------------
// Defect #6 — the self-amplifying lockout, surviving on the path D1's tests
// could not see.
//
// D1 fixed `committed.filesWritten`, which `fold` guards with `obs.isError`.
// But `gate-delegate` also counts `state.pending`, and pi never emits
// `tool_result` for a blocked call: `agent-loop.js:419-428` returns
// `{ kind: "immediate" }`, and `afterToolCall` — the source of the
// `tool_result` event — only runs inside `finalizeExecutedToolCall` (:487).
// So a blocked call's pending entry is never removed, and each refusal
// inflates the count that causes the next one. Same monotonic trap, same gate,
// different map.
//
// This is driven through `createKernel` on purpose. The D1 tests pass
// `noPending` into `delegateGate`, so they structurally cannot observe the
// kernel's own bookkeeping — which is why 545 green tests missed this.
// ---------------------------------------------------------------------------
test("a blocked call does not inflate the counter that blocked it", () => {
  // Driven through `register`, not the kernel directly: the fix lives in the
  // `tool_call` hook, which is the only place that knows a call was refused.
  const handlers = new Map<string, (event: unknown) => unknown>();
  const pi = {
    on: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler),
    registerTool: () => {},
    appendEntry: () => {},
  };
  const kernel = register(pi as never, "/tmp/nodd-pending-probe", process.env.HOME);
  const declared = { intent: "change", route: "inline", slug: "probe", summary: "s", title: "P" };
  kernel.declare(declared as never);
  const d = { toolName: "nodd_declare", toolCallId: "d1", input: declared };
  handlers.get("tool_call")!(d);
  handlers.get("tool_result")!({ ...d, isError: false, content: "" });

  const reasons: string[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const event = { toolName: "write", toolCallId: `w${i}`, input: { file_path: `/repo/f${i}.ts` } };
    const decision = handlers.get("tool_call")!(event) as { reason?: string } | undefined;
    // pi only reports a result for calls it actually executed.
    if (!decision) handlers.get("tool_result")!({ ...event, isError: false, content: "" });
    else reasons.push(String(decision.reason));
  }

  // One write landed; the other five were refused and touched nothing.
  assert.equal(kernel.evidenceView().filesWritten.size, 1);
  const escalating = reasons.filter((r) => /written [3-9] distinct files/.test(r));
  assert.deepEqual(
    escalating,
    [],
    `refusals must not count themselves: the gate escalated to ${escalating.length} higher counts over writes that never happened`,
  );
});

// ---------------------------------------------------------------------------
// The footer counts tasks.
//
// `statusLine` has taken a `TaskProgress` since it was written and it is
// tested, but the kernel never passed one, so the counter could not appear:
// a tested capability wired to nothing. The doc on disk is the source of
// truth, same as everywhere else in NODD.
// ---------------------------------------------------------------------------
test("the footer reports task progress from the feature doc", () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodd-footer-"));
  const handlers = new Map<string, (event: unknown) => unknown>();
  const statuses: string[] = [];
  const pi = {
    on: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler),
    registerTool: () => {},
    appendEntry: () => {},
  };
  const kernel = register(pi as never, cwd, mkdtempSync(join(tmpdir(), "nodd-footer-h-")));
  const declared = {
    intent: "change", route: "tracked", slug: "counted",
    title: "C", summary: "s", runner: "npm test",
  };
  kernel.declare(declared as never);
  kernel.task({ action: "add", slug: "counted", id: "T1", title: "one" } as never);
  kernel.task({ action: "add", slug: "counted", id: "T2", title: "two" } as never);

  // The footer is drawn from the hooks, which is how pi drives it.
  const ctx = { ui: { setStatus: (_k: string, text: string) => statuses.push(text) } };
  const d = { toolName: "nodd_declare", toolCallId: "d1", input: declared };
  handlers.get("tool_call")!(d, ctx);
  handlers.get("tool_result")!({ ...d, isError: false, content: "" }, ctx);

  const last = statuses.at(-1) ?? "";
  assert.match(last, /0\/2/, `expected the footer to count the two declared tasks, got: "${last}"`);
});

// ---------------------------------------------------------------------------
// Defect #6, third path: the abort.
//
// `c16872c` attributed the missing `tool_result` to one `{kind:"immediate"}`
// return. There are two more that fire *after* `beforeToolCall` has already
// populated `pending`: the `signal?.aborted` checks at `agent-loop.js:411-416`
// and `:426-430`. On those, NODD *allowed* the call, so the block-path cleanup
// never runs and the entry leaks — the same monotonic trap, reached by
// pressing Esc.
// ---------------------------------------------------------------------------
test("an aborted call does not block the write that follows it", () => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const kernel = register(
    { on: (n: string, f: (e: unknown) => unknown) => handlers.set(n, f), registerTool: () => {}, appendEntry: () => {} } as never,
    mkdtempSync(join(tmpdir(), "nodd-abort-")),
    mkdtempSync(join(tmpdir(), "nodd-abort-h-")),
  );
  const declared = { intent: "change", route: "inline", slug: "p", summary: "s", title: "P" };
  kernel.declare(declared as never);
  const d = { toolName: "nodd_declare", toolCallId: "d1", input: declared };
  handlers.get("tool_call")!(d);
  handlers.get("tool_result")!({ ...d, isError: false, content: "" });

  // Allowed by the gate, then aborted by the user: no result will ever arrive.
  handlers.get("tool_call")!({ toolName: "write", toolCallId: "a1", input: { file_path: "/repo/aborted.ts" } });
  handlers.get("turn_end")?.({});

  const genuine = { toolName: "write", toolCallId: "g1", input: { file_path: "/repo/real.ts" } };
  const decision = handlers.get("tool_call")!(genuine) as { reason?: string } | undefined;
  assert.equal(
    decision,
    undefined,
    `the first genuine write was refused over an abandoned call: ${decision?.reason ?? ""}`,
  );
});

// The guard on the cleanup is load-bearing: `pending` is how gate-delegate sees
// write intent that shares one assistant message, before any result exists.
// Forgetting unconditionally would erase the siblings and let a divergent batch
// through, so the guard needs a test of its own.
test("write intent within one batch survives the pending cleanup", () => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const kernel = register(
    { on: (n: string, f: (e: unknown) => unknown) => handlers.set(n, f), registerTool: () => {}, appendEntry: () => {} } as never,
    mkdtempSync(join(tmpdir(), "nodd-batch-")),
    mkdtempSync(join(tmpdir(), "nodd-batch-h-")),
  );
  const declared = { intent: "change", route: "inline", slug: "p", summary: "s", title: "P" };
  kernel.declare(declared as never);
  const d = { toolName: "nodd_declare", toolCallId: "d1", input: declared };
  handlers.get("tool_call")!(d);
  handlers.get("tool_result")!({ ...d, isError: false, content: "" });

  // Three writes preflighted in one assistant message: none has a result yet.
  const blocked = ["b1", "b2", "b3"].map((id, i) =>
    Boolean(handlers.get("tool_call")!({ toolName: "write", toolCallId: id, input: { file_path: `/repo/n${i}.ts` } })),
  );
  assert.deepEqual(
    blocked,
    [false, true, true],
    "a batch wide enough to trip the writer threshold must still be caught on intent alone",
  );
});
