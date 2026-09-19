import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, fold, type Committed } from "../state.ts";
import { observation } from "../observations.ts";
import type { LedgerRecord } from "../ledger.ts";
import { emptyPolicy } from "./policy.ts";
import { evidenceGate, renderObserved } from "./evidence.ts";

function afterCommand(command: string, isError: boolean, resultText = "", id = "b1"): Committed {
  return fold(emptyCommitted(), observation({
    toolCallId: id, toolName: "bash", input: { command }, isError, resultText, at: "2026-09-19T10:05:00.000Z",
  }));
}

function ledgerFor(committed: Committed): LedgerRecord[] {
  return committed.commandResults.map((r) => ({
    toolCallId: r.toolCallId,
    tool: "bash",
    command: r.command,
    outcome: r.isError ? { kind: "unknown" as const } : { kind: "success" as const },
    at: r.at,
  }));
}

const check = { task: "T1", lastWriteAt: "2026-09-19T10:00:00.000Z" };

// ---------------------------------------------------------------------------
// The mandated provenance test: the recorded value comes from the observed
// tool result, never from the model saying so.
// ---------------------------------------------------------------------------
test("only a real successful tool_result satisfies a checkoff", () => {
  const policy = emptyPolicy();

  // (a) the model asserts "tests pass" and no command ever ran.
  const claimed = fold(emptyCommitted(), observation({
    toolCallId: "a1", toolName: "assistant_message",
    input: { text: "I ran the tests and they pass. Evidence: all 42 tests pass." },
    isError: false, resultText: "", at: "2026-09-19T10:05:00.000Z",
  }));
  const a = evidenceGate(claimed, [], check, policy);
  assert.equal(a.allow, false, "a model claim is not evidence");
  assert.ok(a.allow === false && /no command/i.test(a.reason));

  // (b) a real command that really failed.
  const failed = afterCommand("npm test", true, "FAIL 3 tests\nCommand exited with code 1");
  const b = evidenceGate(failed, ledgerFor(failed), check, policy);
  assert.equal(b.allow, false, "a failing result is not evidence");
  assert.ok(b.allow === false && b.reason.includes("exit 1"), "the refusal quotes the real code");

  // (c) a real command that really succeeded.
  const passed = afterCommand("npm test", false, "42 passing");
  const c = evidenceGate(passed, ledgerFor(passed), check, policy);
  assert.equal(c.allow, true);
  assert.equal(c.allow === true && c.observed.command, "npm test");
  assert.equal(c.allow === true && c.observed.outcome, "success");
});

test("an empty ledger and no commands refuses", () => {
  const decision = evidenceGate(emptyCommitted(), [], check, emptyPolicy());
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && decision.remedy.action.length > 0);
});

test("aborted, timeout and unknown never satisfy a checkoff", () => {
  for (const [text, quoted] of [
    ["Command aborted", "aborted"],
    ["Command timed out after 120 seconds", "timed out"],
    ["ENOENT: no such file", "unknown"],
  ]) {
    const state = afterCommand("npm test", true, text);
    const decision = evidenceGate(state, ledgerFor(state), check, emptyPolicy());
    assert.equal(decision.allow, false, `${text} must refuse`);
    assert.ok(decision.allow === false && decision.reason.includes(quoted), `the refusal must say "${quoted}"`);
  }
});

test("the success must come after the task's last write", () => {
  const state = afterCommand("npm test", false, "ok");
  const stale = { task: "T1", lastWriteAt: "2026-09-19T23:00:00.000Z" };
  const decision = evidenceGate(state, ledgerFor(state), stale, emptyPolicy());
  assert.equal(decision.allow, false, "a run predating the edit proves nothing about the edit");
  assert.ok(decision.allow === false && /before/i.test(decision.reason));
});

// routing.go:101 — in TDD mode the failing test comes first.
test("TDD mode requires an observed RED before an implementation checkoff", () => {
  const policy = emptyPolicy();
  const green = afterCommand("npm test", false, "ok");
  const tdd = { ...check, tdd: { mode: "strict" as const, source: "config", runner: "npm test" } };

  const withoutRed = evidenceGate(green, ledgerFor(green), tdd, policy);
  assert.equal(withoutRed.allow, false);
  assert.ok(withoutRed.allow === false && /red|failing/i.test(withoutRed.reason));

  const red = afterCommand("npm test", true, "Command exited with code 1", "r1");
  const both = fold(red, observation({
    toolCallId: "g1", toolName: "bash", input: { command: "npm test" },
    isError: false, resultText: "ok", at: "2026-09-19T10:06:00.000Z",
  }));
  const withRed = evidenceGate(both, ledgerFor(both), tdd, policy);
  assert.equal(withRed.allow, true, "RED then GREEN satisfies TDD mode");
  assert.equal(withRed.allow === true && withRed.observed.tdd?.mode, "strict");
  assert.equal(withRed.allow === true && withRed.observed.tdd?.runner, "npm test");
});

// routing.go:117 — a disabled gate must not make the artifact lie.
test("the flag off allows the checkoff but records that nothing was verified", () => {
  const policy = { ...emptyPolicy(), config: { evidence: { enabled: false } } };
  const decision = evidenceGate(emptyCommitted(), [], check, policy);
  assert.equal(decision.allow, true);
  assert.equal(decision.allow === true && decision.observed.outcome, "none (gate disabled)");
  assert.equal(renderObserved(decision.allow === true ? decision.observed : null), "observed: none (gate disabled)");
});

test("the rendered line carries the real command and outcome", () => {
  const passed = afterCommand("node --test", false, "ok");
  const decision = evidenceGate(passed, ledgerFor(passed), check, emptyPolicy());
  assert.equal(renderObserved(decision.allow === true ? decision.observed : null), "observed: `node --test` → success");
});

// The steering condition: a ledger record this kernel never saw is not evidence.
test("a ledger record the kernel never observed cannot satisfy a checkoff", () => {
  const forged: LedgerRecord[] = [{
    toolCallId: "forged-1", tool: "bash", command: "npm test",
    outcome: { kind: "success" }, at: "2026-09-19T10:05:00.000Z",
  }];
  const decision = evidenceGate(emptyCommitted(), forged, check, emptyPolicy());
  assert.equal(decision.allow, false, "a record on disk is not an observation");
  assert.ok(decision.allow === false && /unverified|not observed/i.test(decision.reason),
    `the refusal must name the degradation: ${decision.allow === false ? decision.reason : ""}`);
});
