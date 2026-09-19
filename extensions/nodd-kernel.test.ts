import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
