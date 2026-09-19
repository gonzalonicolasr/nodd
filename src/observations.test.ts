import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { observation, pendingCall } from "./observations.ts";
import { emptyState } from "./state.ts";

test("an observation carries the raw observed fields", () => {
  const obs = observation({
    toolCallId: "call_1",
    toolName: "bash",
    input: { command: "npm test" },
    isError: false,
    resultText: "12 passing",
    at: "2026-09-19T10:00:00.000Z",
  });
  assert.equal(obs.toolCallId, "call_1");
  assert.equal(obs.toolName, "bash");
  assert.deepEqual(obs.input, { command: "npm test" });
  assert.equal(obs.isError, false);
  assert.equal(obs.resultText, "12 passing");
});

test("an observation cannot be constructed without a toolCallId", () => {
  const missing = { toolCallId: "", toolName: "bash", input: {}, isError: false, resultText: "", at: "t" };
  assert.throws(() => observation(missing), /toolCallId/);
  // @ts-expect-error — the field is required by type, and rejected at runtime too.
  assert.throws(() => observation({ toolName: "bash", input: {}, isError: false, resultText: "", at: "t" }), /toolCallId/);
});

test("a pending call is keyed by toolCallId and carries no result", () => {
  const pending = pendingCall({ toolCallId: "call_2", toolName: "write", input: { path: "a.ts" } });
  assert.equal(pending.toolCallId, "call_2");
  assert.ok(!("resultText" in pending), "a pending call has no result yet");
  assert.ok(!("isError" in pending), "a pending call has no outcome yet");
});

test("state splits committed from pending", () => {
  const state = emptyState();
  assert.ok(state.pending instanceof Map);
  assert.equal(state.pending.size, 0);
  assert.equal(state.committed.toolCalls, 0);
  assert.equal(state.committed.declaration, null);
});

// The ledger stores what was observed. Interpretation (success/failure) is
// derived later by src/outcome.ts, so evidence stays re-derivable and is never
// pre-collapsed into a boolean a caller could trust blindly.
test("no raw observation field is a boolean verdict", () => {
  const obs = observation({
    toolCallId: "call_3", toolName: "bash", input: {}, isError: true, resultText: "boom", at: "t",
  });
  for (const key of ["ok", "passed", "success", "failed"]) {
    assert.ok(!(key in obs), `Observation must not carry a '${key}' verdict field`);
  }
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "observations.ts"), "utf8");
  for (const key of ["ok:", "passed:", "success:"]) {
    assert.ok(!src.includes(key), `observations.ts must not define '${key}'`);
  }
});
