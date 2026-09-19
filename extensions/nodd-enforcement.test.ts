// Every assertion here goes through the *registered* `tool_call` handler.
//
// No test in this file calls `trackGate()` or any other gate function directly.
// That is the whole point: the gates were fully tested as pure functions and
// still never fired, because nothing connected them to pi. A test that reaches
// past the handler would have passed in that broken state too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register from "./nodd-kernel.ts";

type Handler = (event: unknown, ctx?: unknown) => unknown;

/**
 * Tool call ids are unique within a session file, so a resumed session never
 * re-mints one its predecessor already used. This counter is module-level for
 * that reason: a per-session counter made session 2 emit `call-0` again, which
 * the reducer correctly dropped as a replayed duplicate, and the test then
 * looked like a fail-closed bug it was not. The helper was unfaithful to pi,
 * so the helper changed.
 */
let nextId = 0;
type Block = { block?: boolean; reason?: string; terminate?: boolean } | undefined;

/**
 * A session driven through the registered handlers.
 *
 * `entries` is pi's session log: the kernel appends to it through
 * `pi.appendEntry` and reads it back on `session_start` through
 * `ctx.sessionManager.getEntries()`, in pi's real `{ type: "custom",
 * customType, data }` shape. Passing a previous session's array is how a resume
 * is simulated: same session file, new process, empty in-memory state.
 */
function session(options: { cwd?: string; entries?: Array<Record<string, unknown>> } = {}) {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, (args: never) => unknown>();
  const entries = options.entries ?? [];
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerTool: (name: string, opts: { handler: (args: never) => unknown }) => tools.set(name, opts.handler),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
  };
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), "nodd-enforce-"));
  const kernel = register(pi as never, cwd);

  const toolCall = handlers.get("tool_call");
  const toolResult = handlers.get("tool_result");
  const sessionStart = handlers.get("session_start");
  assert.ok(toolCall, "the kernel must register a tool_call handler");
  assert.ok(toolResult, "the kernel must register a tool_result handler");
  assert.ok(sessionStart, "the kernel must register a session_start handler");

  // pi fires session_start on every session, resume or not, and the entries
  // come from the context, never from the event.
  sessionStart!({ type: "session_start", reason: options.entries ? "resume" : "startup" }, {
    sessionManager: { getEntries: () => entries },
  });

  return {
    cwd,
    kernel,
    entries,
    /** Fire one tool call through the real handler. */
    call(toolName: string, input: Record<string, unknown> = {}): Block {
      return toolCall!({ toolName, toolCallId: `call-${nextId++}`, input }) as Block;
    },
    /**
     * A NODD tool as pi actually runs it: preflight, execute, then the result
     * event that advances committed state. Calling the tool handler alone would
     * be a shortcut no real session takes.
     */
    runTool(toolName: string, args: Record<string, unknown>): string {
      const toolCallId = `call-${nextId++}`;
      toolCall!({ toolName, toolCallId, input: args });
      const text = String(tools.get(toolName)!(args as never));
      toolResult!({ toolName, toolCallId, input: args, isError: false, content: text });
      return text;
    },
    /** A tool result pi delivered, with no preflight: an observed fact. */
    observe(toolName: string, input: Record<string, unknown>, content = ""): void {
      toolResult!({ toolName, toolCallId: `call-${nextId++}`, input, isError: false, content });
    },
    /** The same, for a result pi reported as an error. */
    fail(toolName: string, input: Record<string, unknown>, content = ""): void {
      toolResult!({ toolName, toolCallId: `call-${nextId++}`, input, isError: true, content });
    },
    declare(args: Record<string, unknown>) {
      return this.runTool("nodd_declare", args);
    },
    task(args: Record<string, unknown>) {
      return this.runTool("nodd_task", args);
    },
  };
}

const WRITE = { path: "/repo/src/thing.ts", content: "x" };

// ---------------------------------------------------------------------------
// The handler actually reaches the gates
// ---------------------------------------------------------------------------
test("an undeclared write is blocked through the handler, with a reason", () => {
  const s = session();
  const result = s.call("write", WRITE);

  assert.ok(result, "the handler must return a decision, not undefined");
  assert.equal(result!.block, true);
  assert.ok(typeof result!.reason === "string" && result!.reason.length > 0, "a block must carry a reason");
  assert.match(result!.reason!, /nodd\//, "the reason names the gate that refused");
});

test("the block names the concrete action and the escape hatch", () => {
  const reason = session().call("write", WRITE)!.reason!;
  assert.match(reason, /nodd_declare/, "it names what unblocks the call");
  assert.match(reason, /\/nodd-allow/, "it names the one-shot override");
});

test("a kernel that only observed would fail this: the gates are on the real path", () => {
  // If the handler recorded the pending call and returned nothing, this is the
  // assertion that catches it.
  const s = session();
  assert.notEqual(s.call("write", WRITE), undefined, "the handler returned nothing for a violating write");
});

// ---------------------------------------------------------------------------
// Reads and read-only sessions are untouched
// ---------------------------------------------------------------------------
test("a read is never blocked", () => {
  const s = session();
  assert.equal(s.call("read", { path: "/repo/src/thing.ts" }), undefined);
});

test("a read-only declaration lets reads through and blocks writes", () => {
  const s = session();
  s.declare({ intent: "read-only", route: "inline", slug: "audit", summary: "look only" });

  assert.equal(s.call("read", { path: "/repo/a.ts" }), undefined, "reading is the point of read-only");
  assert.equal(s.call("grep", { pattern: "x" }), undefined);

  const blocked = s.call("write", WRITE);
  assert.equal(blocked?.block, true);
  assert.match(blocked!.reason!, /authorize/, "read-only writes are gate-authorize's business");
});

test("a declared inline change may write", () => {
  const s = session();
  s.declare({ intent: "change", route: "inline", slug: "fix", summary: "small fix" });
  assert.equal(s.call("write", WRITE), undefined, "an authorized inline write proceeds");
});

// ---------------------------------------------------------------------------
// Mutating bash goes through the same path
// ---------------------------------------------------------------------------
test("mutating bash is blocked when undeclared; a read-only command is not", () => {
  const s = session();
  assert.equal(s.call("bash", { command: "ls -la" }), undefined, "listing mutates nothing");
  assert.equal(s.call("bash", { command: "rm -rf build" })?.block, true);
});

// ---------------------------------------------------------------------------
// Order and precedence
// ---------------------------------------------------------------------------
test("when authorize and track both apply, only authorize speaks", () => {
  const s = session();
  // read-only + a tracked route with no doc: authorize refuses first, and the
  // call must come back with exactly one message.
  s.declare({ intent: "read-only", route: "tracked", slug: "both", summary: "x" });

  const reason = s.call("write", WRITE)!.reason!;
  assert.match(reason, /nodd\/authorize/, "the first gate in registry order wins");
  assert.ok(!reason.includes("nodd/track"), "a single call never collects two refusals");
  assert.equal(reason.split("nodd/").length - 1, 1, `exactly one gate message, got: ${reason}`);
});

test("gate-track fires once authorize is satisfied", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "warmup", summary: "x" });

  // The declaration created the doc, so the write proceeds; writing into
  // .nodd/ is what track still refuses.
  const blocked = s.call("write", { path: join(s.cwd, ".nodd", "warmup", "feature.md"), content: "hand-edited" });
  assert.equal(blocked?.block, true);
  assert.match(blocked!.reason!, /nodd\/track/, "NODD's own artifacts are written by NODD");
});

// ---------------------------------------------------------------------------
// Kill switches, on the real path
// ---------------------------------------------------------------------------
test("a disabled gate lets the same call through the handler", () => {
  const blocked = session();
  assert.equal(blocked.call("write", WRITE)?.block, true, "baseline: this call blocks");

  const off = session();
  off.kernel.setPolicy({ config: { classify: { enabled: false } }, flags: {}, hatches: {} });
  assert.equal(off.call("write", WRITE), undefined, "gates.classify.enabled=false turns it off entirely");
});

test("--nodd-off=all turns every gate off on the real path", () => {
  const s = session();
  s.kernel.setPolicy({ config: {}, flags: { all: false }, hatches: {} });

  s.declare({ intent: "read-only", route: "tracked", slug: "x", summary: "y" });
  assert.equal(s.call("write", WRITE), undefined, "off means off, entirely");
  assert.equal(s.call("bash", { command: "rm -rf /tmp/whatever" }), undefined);
});

test("turning off one gate leaves the others enforcing", () => {
  const s = session();
  s.kernel.setPolicy({ config: { classify: { enabled: false } }, flags: {}, hatches: {} });
  s.declare({ intent: "read-only", route: "inline", slug: "audit", summary: "x" });

  const blocked = s.call("write", WRITE);
  assert.equal(blocked?.block, true, "authorize still enforces");
  assert.match(blocked!.reason!, /authorize/);
});

// ---------------------------------------------------------------------------
// The escape hatch, on the real path
// ---------------------------------------------------------------------------
test("a granted hatch lets exactly one call through, then the gate blocks again", () => {
  const s = session();
  assert.equal(s.call("write", WRITE)?.block, true, "baseline");

  s.kernel.setPolicy({ config: {}, flags: {}, hatches: { classify: { reason: "one-off" } } });

  assert.equal(s.call("write", WRITE), undefined, "the hatch is honoured on the real path");
  assert.equal(s.call("write", WRITE)?.block, true, "and it was consumed, not kept");
});

test("a hatch for one gate does not open another", () => {
  const s = session();
  s.declare({ intent: "read-only", route: "inline", slug: "audit", summary: "x" });
  s.kernel.setPolicy({ config: {}, flags: {}, hatches: { track: { reason: "wrong gate" } } });

  const blocked = s.call("write", WRITE);
  assert.equal(blocked?.block, true, "a track hatch must not excuse an authorize refusal");
  assert.match(blocked!.reason!, /authorize/);
});

// ---------------------------------------------------------------------------
// terminate is never set
// ---------------------------------------------------------------------------
test("no refusal ever sets terminate", () => {
  const s = session();
  const refusals: Block[] = [
    s.call("write", WRITE),
    s.call("bash", { command: "rm -rf x" }),
    s.call("edit", { path: "/repo/a.ts", edits: [] }),
  ];
  for (const refusal of refusals) {
    assert.equal(refusal?.block, true);
    assert.equal(refusal?.terminate, undefined, "a blocked call stops the call, never the agent");
  }
});

// ---------------------------------------------------------------------------
// The evidence gate on the checkoff path
// ---------------------------------------------------------------------------
test("checking off a task with no observed run is refused, not recorded as unverified", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "warmup", summary: "x" });
  s.task({ action: "add", id: "T1", title: "Do the thing", slug: "warmup" });

  const reply = String(s.task({ action: "check", id: "T1", slug: "warmup" }));
  assert.match(reply, /nodd\/evidence/, "the evidence gate must be on this path");
  assert.ok(!/unverified \(evidence gate not yet active\)/.test(reply), "the placeholder must be gone");
});

// ---------------------------------------------------------------------------
// The two round-1 attacks, replayed through the real handler
//
// Both of these checked a task off in round 1. They are the reason evidence is
// now bound to (declared runner, time of the task's last write) rather than to
// "some exit-0 happened in this session".
// ---------------------------------------------------------------------------
function trackedFeature(s: ReturnType<typeof session>, extra: Record<string, unknown> = {}) {
  s.declare({
    intent: "change", route: "tracked", slug: "login", summary: "build login",
    runner: "npm test", files: ["/repo/src/login.ts"], ...extra,
  });
  s.task({ action: "add", id: "T1", title: "Implement the login system", slug: "login" });
}

test("stale-green attack: a run observed BEFORE the edit cannot check the task off", () => {
  const s = session();
  trackedFeature(s);

  // Green first...
  s.observe("bash", { command: "npm test" }, "42 passing");
  // ...then the source is edited. The green now describes code that no longer
  // exists, which is precisely what it must not be allowed to certify.
  s.observe("edit", { path: "/repo/src/login.ts" }, "");

  const reply = String(s.task({ action: "check", id: "T1", slug: "login" }));
  assert.match(reply, /nodd\/evidence/, "the evidence gate must refuse");
  assert.match(reply, /before the last write/i, reply);
  assert.ok(!/checked in/.test(reply), "the task must not be checked");
});

test("stale-green, repaired: re-running after the edit is accepted", () => {
  const s = session();
  trackedFeature(s);
  s.observe("bash", { command: "npm test" }, "42 passing");
  s.observe("edit", { path: "/repo/src/login.ts" }, "");
  s.observe("bash", { command: "npm test" }, "42 passing");

  assert.match(String(s.task({ action: "check", id: "T1", slug: "login" })), /checked in/, "the remedy the refusal named must work");
});

test("echo attack: an exit-0 sentence the model chose is not the declared check", () => {
  const s = session();
  trackedFeature(s);
  s.observe("edit", { path: "/repo/src/login.ts" }, "");
  // Exit 0. pi reports no error. In round 1 this was recorded, verbatim, as
  // `observed: `echo 'I have verified that all tests pass'` → success`.
  s.observe("bash", { command: "echo 'I have verified that all tests pass'" }, "I have verified that all tests pass");

  const reply = String(s.task({ action: "check", id: "T1", slug: "login" }));
  assert.match(reply, /nodd\/evidence/);
  assert.match(reply, /npm test/, "the refusal names the runner that was declared");
  assert.ok(!/checked in/.test(reply));

  const doc = readFileSync(join(s.cwd, ".nodd", "login", "feature.md"), "utf8");
  assert.ok(!doc.includes("I have verified"), "model prose must not reach the artifact at all");
  assert.match(doc, /- \[ \] T1\./, "the task is still open on disk");
});

// The round-1 echo attack has a second entrance: `runner` is optional, so
// omitting it at declaration skips the runner comparison entirely and the echo
// certifies the task. That path cannot be closed without making the field
// mandatory, so what NODD owes the reader is disclosure in the artifact --
// which round 2 promised in the README and did not implement.
test("echo attack with no runner declared: allowed, but the artifact says the runner was not pinned", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "bare", summary: "build login", files: ["/repo/src/login.ts"] });
  s.task({ action: "add", id: "T1", title: "Implement the login system", slug: "bare" });
  s.observe("edit", { path: "/repo/src/login.ts" }, "");
  s.observe("bash", { command: "echo 'I have verified that all tests pass'" }, "I have verified that all tests pass");

  assert.match(String(s.task({ action: "check", id: "T1", slug: "bare" })), /checked in/, "nothing was pinned, so nothing can be compared");

  const doc = readFileSync(join(s.cwd, ".nodd", "bare", "feature.md"), "utf8");
  const evidenceLine = doc.split("\n").find((line) => line.trim().startsWith("- observed:"));
  assert.ok(evidenceLine, "a checked task carries an evidence line");
  assert.match(
    evidenceLine!,
    /runner not pinned/,
    `the evidence line must disclose the unpinned runner, got: ${evidenceLine}`,
  );
});

// Two claims of the README meet here, and round 2 left the seam open.
//
// "The choice is made up front ... so the command the work is judged by cannot
// be invented afterwards to fit whatever happened to pass" is only true if a
// later declaration cannot rewrite the runner. It could: nodd_declare
// overwrites `## Verification` wholesale, so a refused checkoff was repaired by
// re-declaring with the echo as the runner, and the second attempt passed.
test("the runner cannot be re-declared to fit a run that already happened", () => {
  const s = session();
  trackedFeature(s);
  s.observe("edit", { path: "/repo/src/login.ts" }, "");
  s.observe("bash", { command: "echo 'I have verified that all tests pass'" }, "ok");
  assert.match(String(s.task({ action: "check", id: "T1", slug: "login" })), /nodd\/evidence/, "the echo is not npm test");

  // The repair attempt: keep the feature, swap the runner for the thing that
  // did pass. This must not become a checkoff.
  const redeclared = String(s.declare({
    intent: "change", route: "tracked", slug: "login", summary: "build login",
    runner: "echo 'I have verified that all tests pass'", files: ["/repo/src/login.ts"],
  }));
  assert.match(redeclared, /runner/i, `re-pinning an already-pinned runner must be refused, got: ${redeclared}`);

  const doc = readFileSync(join(s.cwd, ".nodd", "login", "feature.md"), "utf8");
  assert.match(doc, /- runner: npm test$/m, "the originally declared runner stands");
  assert.ok(!doc.includes("I have verified"), "the invented runner must not reach the artifact");
  assert.match(String(s.task({ action: "check", id: "T1", slug: "login" })), /nodd\/evidence/, "and the checkoff is still refused");
});

test("a checkoff certified by the declared runner carries no unpinned caveat", () => {
  // The disclosure above is only worth something if it discriminates. If every
  // line carried it, the two cases would read the same again.
  const s = session();
  trackedFeature(s);
  s.observe("edit", { path: "/repo/src/login.ts" }, "");
  s.observe("bash", { command: "npm test" }, "42 passing");
  assert.match(String(s.task({ action: "check", id: "T1", slug: "login" })), /checked in/);

  const doc = readFileSync(join(s.cwd, ".nodd", "login", "feature.md"), "utf8");
  assert.match(doc, /- observed: `npm test` → success$/m, "a pinned checkoff reads clean");
  assert.ok(!doc.includes("not pinned"), "the caveat must not appear when the runner was pinned");
});

test("the declared runner is recorded in the feature doc, not chosen per checkoff", () => {
  const s = session();
  trackedFeature(s, { tdd: "strict" });
  const doc = readFileSync(join(s.cwd, ".nodd", "login", "feature.md"), "utf8");
  assert.match(doc, /## Verification/);
  assert.match(doc, /- runner: npm test/);
  assert.match(doc, /- tdd: strict/);
  assert.match(doc, /- source: nodd_declare/);
});

test("strict TDD on the real path: GREEN with no observed RED is refused", () => {
  const s = session();
  trackedFeature(s, { tdd: "strict" });
  s.observe("edit", { path: "/repo/src/login.ts" }, "");
  s.observe("bash", { command: "npm test" }, "42 passing");

  const reply = String(s.task({ action: "check", id: "T1", slug: "login" }));
  assert.match(reply, /red|failing/i, reply);
  assert.ok(!/checked in/.test(reply));
});

// ---------------------------------------------------------------------------
// gate-promotion, on the real path
//
// In round 1 this gate was wired and inert: `promotionSignals()` hardcoded every
// trigger to zero, so deleting its registry row left the whole suite green.
// Every test here drives it through the registered handler with signals derived
// from what the kernel observed.
// ---------------------------------------------------------------------------
test("writing more distinct files than were declared blocks, naming both counts", () => {
  const s = session();
  s.declare({
    intent: "change", route: "tracked", slug: "scope", summary: "two files",
    runner: "npm test", files: ["/repo/a.ts", "/repo/b.ts"],
  });
  // Delegation is satisfied so gate-delegate does not speak first.
  s.observe("subagent", { agent: "writer" }, "done");
  s.observe("write", { path: "/repo/a.ts" }, "");
  s.observe("write", { path: "/repo/b.ts" }, "");

  const blocked = s.call("write", { path: "/repo/c.ts", content: "x" });
  assert.equal(blocked?.block, true, "a third file against two declared is divergence");
  assert.match(blocked!.reason!, /nodd\/promotion/);
  assert.match(blocked!.reason!, /2/, "the declared count");
  assert.match(blocked!.reason!, /3/, "the observed count");
  assert.match(blocked!.reason!, /nodd-promote scope/, "the way forward is named");
});

test("writing exactly the declared files never blocks, however many they are", () => {
  const s = session();
  const files = Array.from({ length: 40 }, (_, i) => `/repo/f${i}.ts`);
  s.declare({ intent: "change", route: "tracked", slug: "big", summary: "forty files", runner: "npm test", files });
  s.observe("subagent", { agent: "writer" }, "done");
  for (const path of files.slice(0, 39)) s.observe("write", { path }, "");

  assert.equal(s.call("write", { path: files[39], content: "x" }), undefined, "mismatch is the trigger, never magnitude");
});

test("two consecutive failed runs of the declared runner block the next write", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "stuck", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.observe("subagent", { agent: "writer" }, "done");
  s.fail("bash", { command: "npm test" }, "FAIL\nCommand exited with code 1");
  s.fail("bash", { command: "npm test" }, "FAIL\nCommand exited with code 1");

  const blocked = s.call("write", { path: "/repo/a.ts", content: "x" });
  assert.equal(blocked?.block, true, "the plan is not working, which is what escalation is for");
  assert.match(blocked!.reason!, /nodd\/promotion/);
  assert.match(blocked!.reason!, /2/, "both attempts are counted");
});

test("one failure does not block: a first red is ordinary work, especially under TDD", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "red", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.observe("subagent", { agent: "writer" }, "done");
  s.fail("bash", { command: "npm test" }, "FAIL\nCommand exited with code 1");

  assert.equal(s.call("write", { path: "/repo/a.ts", content: "x" }), undefined);
});

test("a failure then a success does not block: the streak is consecutive, not cumulative", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "fixed", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.observe("subagent", { agent: "writer" }, "done");
  s.fail("bash", { command: "npm test" }, "FAIL\nCommand exited with code 1");
  s.fail("bash", { command: "npm test" }, "FAIL\nCommand exited with code 1");
  s.observe("bash", { command: "npm test" }, "42 passing");

  assert.equal(s.call("write", { path: "/repo/a.ts", content: "x" }), undefined, "a resolved task must not stay blocked");
});

test("failures of some other command are not this task's failures", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "other", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.observe("subagent", { agent: "writer" }, "done");
  s.fail("bash", { command: "grep -r missing ." }, "Command exited with code 1");
  s.fail("bash", { command: "grep -r missing ." }, "Command exited with code 1");

  assert.equal(s.call("write", { path: "/repo/a.ts", content: "x" }), undefined, "a failing grep is not a failing plan");
});

test("gates.promotion off lets the diverging write through", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "off", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.observe("subagent", { agent: "writer" }, "done");
  s.observe("write", { path: "/repo/a.ts" }, "");
  assert.equal(s.call("write", { path: "/repo/b.ts", content: "x" })?.block, true, "baseline: this blocks");

  const disabled = session();
  disabled.kernel.setPolicy({ config: { promotion: { enabled: false } }, flags: {}, hatches: {} });
  disabled.declare({ intent: "change", route: "tracked", slug: "off", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  disabled.observe("subagent", { agent: "writer" }, "done");
  disabled.observe("write", { path: "/repo/a.ts" }, "");
  assert.equal(disabled.call("write", { path: "/repo/b.ts", content: "x" }), undefined, "off means off");
});

// ---------------------------------------------------------------------------
// gate-delegate, on the real path
//
// The gate had thorough unit tests and no proof of being wired: deleting its
// registry row left the whole suite green, the same defect the round-1 verdict
// found in gate-promotion. Unit-testing a gate function and registering it are
// two claims, and only the second one blocks anything.
// ---------------------------------------------------------------------------
test("a second non-trivial write without a delegate is refused through the registry", () => {
  const s = session();
  s.declare({ intent: "change", route: "inline", slug: "del", summary: "x", runner: "npm test" });
  s.observe("write", { path: "/repo/a.ts" }, "");

  const blocked = s.call("write", { path: "/repo/b.ts", content: "x" });
  assert.equal(blocked?.block, true, "the writer threshold must fire from the registered gate");
  assert.match(blocked!.reason!, /nodd\/delegate/);
});

test("reading past the mapping threshold without a delegate is refused through the registry", () => {
  const s = session();
  s.declare({ intent: "change", route: "inline", slug: "map", summary: "x", runner: "npm test" });
  for (const path of ["/r/1.ts", "/r/2.ts", "/r/3.ts", "/r/4.ts", "/r/5.ts"]) {
    s.observe("read", { path }, "");
  }

  const blocked = s.call("write", { path: "/r/1.ts", content: "x" });
  assert.equal(blocked?.block, true, "the mapping threshold must fire from the registered gate");
  assert.match(blocked!.reason!, /nodd\/delegate/);
});

// ---------------------------------------------------------------------------
// Resume: the README's fail-closed promise, made true
//
// Round 1 replayed persisted observations into `committed.commandResults`, which
// is exactly what the evidence gate reads. A second process that ran no command
// checked a task off, while the README promised the check had to be re-run.
// ---------------------------------------------------------------------------
function resumedSession(first: ReturnType<typeof session>) {
  return session({ cwd: first.cwd, entries: first.entries });
}

test("a resumed session cannot check a task off on the previous session's evidence", () => {
  const s1 = session();
  s1.declare({
    intent: "change", route: "tracked", slug: "resume", summary: "x",
    runner: "npm test", files: ["/repo/a.ts"],
  });
  s1.task({ action: "add", id: "T1", title: "First", slug: "resume" });
  s1.task({ action: "add", id: "T2", title: "Second", slug: "resume" });
  s1.observe("write", { path: "/repo/a.ts" }, "");
  s1.observe("bash", { command: "npm test" }, "42 passing");
  assert.match(String(s1.task({ action: "check", id: "T1", slug: "resume" })), /checked in/, "session 1 earned its checkoff");

  // New process, same session file. No command is run.
  const s2 = resumedSession(s1);
  const reply = String(s2.task({ action: "check", id: "T2", slug: "resume" }));

  assert.match(reply, /nodd\/evidence/, "the resumed session must be refused");
  assert.ok(!/checked in/.test(reply), "a task checked off with zero commands run is the whole bug");
  assert.match(reply, /re-?run/i, "and the refusal says what to do, or it reads as NODD being broken");
});

test("the resumed session can check the task off once it re-runs the check", () => {
  const s1 = session();
  s1.declare({ intent: "change", route: "tracked", slug: "redo", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s1.task({ action: "add", id: "T1", title: "First", slug: "redo" });
  s1.observe("write", { path: "/repo/a.ts" }, "");

  const s2 = resumedSession(s1);
  s2.observe("bash", { command: "npm test" }, "42 passing");
  assert.match(String(s2.task({ action: "check", id: "T1", slug: "redo" })), /checked in/, "re-running is the documented remedy");
});

test("replay still rebuilds the gate context, so a resumed session is not un-gated", () => {
  const s1 = session();
  s1.declare({ intent: "read-only", route: "inline", slug: "audit", summary: "look only" });

  const s2 = resumedSession(s1);
  const blocked = s2.call("write", WRITE);
  assert.equal(blocked?.block, true, "a read-only declaration must survive the reload");
  assert.match(blocked!.reason!, /authorize/);
});

test("replay carries writes forward, so a resumed run cannot outrun its own edits", () => {
  const s1 = session();
  s1.declare({ intent: "change", route: "tracked", slug: "carry", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s1.task({ action: "add", id: "T1", title: "First", slug: "carry" });
  s1.observe("bash", { command: "npm test" }, "42 passing");
  s1.observe("write", { path: "/repo/a.ts" }, "");

  const s2 = resumedSession(s1);
  // The edit from session 1 is known; this fresh green must postdate it.
  s2.observe("bash", { command: "npm test" }, "42 passing");
  assert.match(String(s2.task({ action: "check", id: "T1", slug: "carry" })), /checked in/);
});

// ---------------------------------------------------------------------------
// The ledger exists in production
// ---------------------------------------------------------------------------
test("a successful checkoff writes the evidence it relied on to the ledger", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "led", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.task({ action: "add", id: "T1", title: "First", slug: "led" });
  s.observe("write", { path: "/repo/a.ts" }, "");
  s.observe("bash", { command: "npm test" }, "42 passing");
  s.task({ action: "check", id: "T1", slug: "led" });

  const path = join(s.cwd, ".nodd", "led", "ledger.json");
  assert.ok(existsSync(path), `the ledger must exist at ${path}, or its integrity rules are dead code`);
  const { records } = JSON.parse(readFileSync(path, "utf8")) as { records: Array<Record<string, unknown>> };
  assert.equal(records.length, 1);
  assert.equal(records[0].command, "npm test");
  assert.ok(typeof records[0].toolCallId === "string" && records[0].toolCallId !== "", "a record without a toolCallId is not an observation");
});

test("a ledger contradicting what this session observed reads as a mismatch, not as staleness", () => {
  const s = session();
  s.declare({ intent: "change", route: "tracked", slug: "tamper", summary: "x", runner: "npm test", files: ["/repo/a.ts"] });
  s.task({ action: "add", id: "T1", title: "First", slug: "tamper" });
  s.observe("write", { path: "/repo/a.ts" }, "");
  s.fail("bash", { command: "npm test" }, "FAIL\nCommand exited with code 1");

  // Someone edits the ledger to claim the failing run passed, reusing the real
  // toolCallId so it is not merely unobserved.
  const path = join(s.cwd, ".nodd", "tamper", "ledger.json");
  const id = s.kernel.state.committed.commandResults[0].toolCallId;
  mkdirSync(join(s.cwd, ".nodd", "tamper"), { recursive: true });
  writeFileSync(path, JSON.stringify({
    records: [{ toolCallId: id, tool: "bash", command: "npm test", outcome: { kind: "success" }, at: "2026-09-19T10:00:00.000Z" }],
  }), "utf8");

  const reply = String(s.task({ action: "check", id: "T1", slug: "tamper" }));
  assert.ok(!/checked in/.test(reply), "a forged ledger must not check anything off");
  assert.match(reply, /contradict|mismatch/i, `the refusal must name the contradiction: ${reply}`);
  assert.ok(!/previous session/i.test(reply), "a contradicted record is not a staleness problem");
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------
test("a malformed event never throws and never blocks by accident", () => {
  const s = session();
  for (const input of [undefined, null, "string", 42, { path: null }]) {
    assert.doesNotThrow(() => s.call("write", input as never));
  }
  assert.doesNotThrow(() => s.call("", {}));
});
