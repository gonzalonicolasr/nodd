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
