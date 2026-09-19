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

const check = { task: "T1", lastWriteAt: "2026-09-19T10:00:00.000Z", runner: "npm test" };

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

// The property the whole product sells, isolated: the model's prose is not an
// input. Same real success, once with an assistant message asserting the
// result and once without — the recorded evidence must be byte-identical.
// Without this, the test above only proves "there was no evidence", which is a
// weaker and different claim.
test("an assistant message asserting the result changes nothing about what is recorded", () => {
  const passed = afterCommand("npm test", false, "42 passing");
  const withClaim = fold(passed, observation({
    toolCallId: "a1", toolName: "assistant_message",
    input: { text: "Tests pass. Evidence: 42/42 green, everything verified." },
    isError: false, resultText: "", at: "2026-09-19T10:06:00.000Z",
  }));

  const silent = evidenceGate(passed, ledgerFor(passed), check, emptyPolicy());
  const claiming = evidenceGate(withClaim, ledgerFor(withClaim), check, emptyPolicy());

  assert.equal(silent.allow, true);
  assert.equal(claiming.allow, true);
  assert.deepEqual(
    claiming.allow === true ? claiming.observed : null,
    silent.allow === true ? silent.observed : null,
    "the model's assertion must not alter the recorded evidence",
  );
  assert.equal(
    renderObserved(claiming.allow === true ? claiming.observed : null),
    renderObserved(silent.allow === true ? silent.observed : null),
    "the rendered line must be byte-identical with and without the claim",
  );
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
  const stale = { ...check, lastWriteAt: "2026-09-19T23:00:00.000Z" };
  const decision = evidenceGate(state, ledgerFor(state), stale, emptyPolicy());
  assert.equal(decision.allow, false, "a run predating the edit proves nothing about the edit");
  assert.ok(decision.allow === false && /before/i.test(decision.reason));
});

// ---------------------------------------------------------------------------
// The two attacks the round-1 verdict landed. Both produced a green checkoff.
// ---------------------------------------------------------------------------
test("the stale-green attack is refused: a run before the edit never certifies the edit", () => {
  // Green at 10:05, then the source is edited at 10:30. In round 1 this checked
  // the task off, because `lastWriteAt` read `commandResults` (bash only) and
  // `filesWritten` carried no timestamps at all.
  const green = fold(emptyCommitted(), observation({
    toolCallId: "b1", toolName: "bash", input: { command: "npm test" },
    isError: false, resultText: "ok", at: "2026-09-19T10:05:00.000Z",
  }));
  const edited = fold(green, observation({
    toolCallId: "w1", toolName: "edit", input: { path: "/repo/src/login.ts" },
    isError: false, resultText: "", at: "2026-09-19T10:30:00.000Z",
  }));

  const decision = evidenceGate(
    edited,
    ledgerFor(edited),
    { task: "T1", lastWriteAt: "2026-09-19T10:30:00.000Z", runner: "npm test" },
    emptyPolicy(),
  );
  assert.equal(decision.allow, false, "the edit is newer than the only green run");
  assert.ok(decision.allow === false && /before the last write/i.test(decision.reason), decision.allow === false ? decision.reason : "");
});

test("the echo attack is refused: an exit-0 string the model chose is not the declared check", () => {
  const state = afterCommand("echo 'I have verified that all tests pass'", false, "I have verified that all tests pass");
  const decision = evidenceGate(state, ledgerFor(state), check, emptyPolicy());
  assert.equal(decision.allow, false, "exit 0 on a sentence is not evidence of anything");
  assert.ok(decision.allow === false && /npm test/.test(decision.reason), "the refusal names the declared runner");
  assert.ok(decision.allow === false && /runner|declared/i.test(decision.reason), decision.allow === false ? decision.reason : "");
});

test("a command that merely contains the runner as a substring is not the runner", () => {
  const state = afterCommand("echo npm test", false, "npm test");
  assert.equal(evidenceGate(state, ledgerFor(state), check, emptyPolicy()).allow, false);
});

test("the declared runner with its own arguments is still the declared runner", () => {
  // `npm test -- src/login.test.ts` is the runner scoped to a file, which is the
  // ordinary way a task verifies itself. Refusing it would make the gate a
  // nuisance and get it switched off.
  const state = afterCommand("npm test -- src/login.test.ts", false, "ok");
  assert.equal(evidenceGate(state, ledgerFor(state), check, emptyPolicy()).allow, true);
});

test("with no runner declared, any observed success still has to postdate the write", () => {
  // Honest limit, stated: a feature doc without a declared runner cannot have
  // its command checked against one. The write-ordering half still applies, and
  // the recorded evidence says the runner was not pinned.
  const state = afterCommand("node --test", false, "ok");
  const decision = evidenceGate(state, ledgerFor(state), { task: "T1", lastWriteAt: "2026-09-19T10:00:00.000Z", runner: null }, emptyPolicy());
  assert.equal(decision.allow, true);
  assert.equal(decision.allow === true && decision.observed.command, "node --test");
});

// routing.go:101 — in TDD mode the failing test comes first.
test("TDD mode requires an observed RED before an implementation checkoff", () => {
  const policy = emptyPolicy();
  const green = afterCommand("npm test", false, "ok");
  const tdd = { ...check, tdd: { mode: "strict" as const, source: "nodd_declare", runner: "npm test" } };

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
  const decision = evidenceGate(passed, ledgerFor(passed), { ...check, runner: "node --test" }, emptyPolicy());
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

  // Resuming in a fresh session hits this every time. If the refusal does not
  // say why and what to do, it reads as "NODD is broken" and gets switched off.
  assert.ok(decision.allow === false && /previous session|earlier session/i.test(decision.reason),
    "the refusal must explain that the ledger is from a previous session");
  assert.ok(decision.allow === false && /re-?run/i.test(decision.remedy.action),
    "the remedy must say to re-run the check");
});

test("a mismatching record reads differently from a merely unverified one", () => {
  const state = afterCommand("npm test", true, "Command exited with code 1");
  const flipped: LedgerRecord[] = [{
    toolCallId: "b1", tool: "bash", command: "npm test",
    outcome: { kind: "success" }, at: "2026-09-19T10:05:00.000Z",
  }];
  const decision = evidenceGate(state, flipped, check, emptyPolicy());
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && !/previous session/i.test(decision.reason),
    "a contradicted record is not a stale-session problem and must not be described as one");
});
