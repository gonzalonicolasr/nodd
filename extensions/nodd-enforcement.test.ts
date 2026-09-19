// Every assertion here goes through the *registered* `tool_call` handler.
//
// No test in this file calls `trackGate()` or any other gate function directly.
// That is the whole point: the gates were fully tested as pure functions and
// still never fired, because nothing connected them to pi. A test that reaches
// past the handler would have passed in that broken state too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register from "./nodd-kernel.ts";

type Handler = (event: unknown) => unknown;
type Block = { block?: boolean; reason?: string; terminate?: boolean } | undefined;

function session(options: { cwd?: string } = {}) {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, (args: never) => unknown>();
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerTool: (name: string, opts: { handler: (args: never) => unknown }) => tools.set(name, opts.handler),
    appendEntry: () => {},
  };
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), "nodd-enforce-"));
  const kernel = register(pi as never, cwd);

  const toolCall = handlers.get("tool_call");
  const toolResult = handlers.get("tool_result");
  assert.ok(toolCall, "the kernel must register a tool_call handler");
  assert.ok(toolResult, "the kernel must register a tool_result handler");

  let nextId = 0;
  return {
    cwd,
    kernel,
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
// Robustness
// ---------------------------------------------------------------------------
test("a malformed event never throws and never blocks by accident", () => {
  const s = session();
  for (const input of [undefined, null, "string", 42, { path: null }]) {
    assert.doesNotThrow(() => s.call("write", input as never));
  }
  assert.doesNotThrow(() => s.call("", {}));
});
