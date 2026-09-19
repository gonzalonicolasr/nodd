// gate-evidence — the one that makes the rest worth having.
//
// ODD says "evidence is what you observed, not what you expect" and then lets
// the model write `Evidence: tests pass` with nothing behind it. Here a checkoff
// is refused unless a `success` outcome was observed, from a real command, after
// the task's last write.
//
// Four independent facts must line up, and each is checked against observation
// rather than assertion:
//
//   1. a command ran           — a `tool_result`, not an assistant sentence
//   2. it succeeded            — `isError === false`, i.e. exit 0 by pi's
//                                construction; `exit`/`aborted`/`timeout`/
//                                `unknown` never qualify (T019)
//   3. it ran after the edit   — a green run predating the change proves
//                                nothing about the change
//   4. it was *the declared check* — the runner recorded at declaration time,
//                                not whatever string the model picked
//
// Fact 4 is what makes the other three worth having. pi's bash tool exits 0 for
// `echo 'I have verified that all tests pass'` just as it does for `npm test`,
// so a gate that accepts any exit-0 accepts the model's own sentence wearing a
// command's clothes — `Evidence: tests pass` again, now in NODD's format. The
// model does not choose the runner: it is declared once, lands in the feature
// doc's `## Verification` section, and the gate compares against it.
//
// Honest limit: when no runner was declared, fact 4 cannot be checked and is
// skipped rather than faked. The refusal and the artifact both say so.
//
// Plus a fourth, per the ledger integrity rule: the record must be one this
// kernel observed. A record on disk is a claim about the past; only the
// committed observation set makes it evidence.
//
// With the gate off the checkoff proceeds but the artifact says
// `observed: none (gate disabled)`. A disabled gate may stop enforcing; it may
// not make the document assert something that was never verified.

import type { Committed } from "../state.ts";
import { classifyRecords, describeDegraded, type LedgerRecord } from "../ledger.ts";
import { describeOutcome, isSuccess, parseOutcome } from "../outcome.ts";
import { refuse, resolveFlag, type Policy, type Remedy } from "./policy.ts";

export type TddContext = { mode: "strict" | "off"; source: string; runner: string };

export type CheckRequest = {
  task: string;
  /** When the task's last observed write happened. Evidence must postdate it. */
  lastWriteAt: string;
  /**
   * That write's position in observation order. Two tool results can share a
   * millisecond, so the ordering is decided here and `lastWriteAt` is what the
   * refusal quotes. `0` means nothing has been written yet.
   */
  lastWriteSeq?: number;
  /** The declared verification command. `null` when the declaration pinned none. */
  runner: string | null;
  tdd?: TddContext;
};

export type ObservedEvidence = {
  command: string;
  outcome: string;
  at?: string;
  /** The call this evidence came from, so the caller can record exactly it. */
  toolCallId?: string;
  tdd?: TddContext;
};

export type EvidenceDecision =
  | { allow: true; observed: ObservedEvidence }
  | { allow: false; gate: "evidence"; reason: string; remedy: Remedy };

const REMEDY = "run the verification command, then check the task off once it is observed to succeed";

/**
 * Whether an observed command *is* the declared runner. Prefix match on whole
 * tokens, so `npm test -- src/login.test.ts` counts and `echo npm test` does
 * not: a runner narrowed to one file is the ordinary way a task verifies
 * itself, while the runner quoted inside another command is not a run of it.
 *
 * Exported because `gate-promotion`'s failure streak counts runs of the same
 * declared runner, and the two gates must agree on what "a run of it" means.
 */
export function isDeclaredRunner(command: string, runner: string): boolean {
  const actual = command.trim().split(/\s+/);
  const declared = runner.trim().split(/\s+/);
  if (declared.length === 0 || actual.length < declared.length) return false;
  return declared.every((token, i) => actual[i] === token);
}

function deny(reason: string, remedy: string = REMEDY): EvidenceDecision {
  const refusal = refuse("evidence", reason, remedy);
  return { allow: false, gate: "evidence", reason: refusal.reason, remedy: refusal.remedy };
}

export function evidenceGate(
  committed: Committed,
  ledger: LedgerRecord[],
  request: CheckRequest,
  policy: Policy,
): EvidenceDecision {
  if (!resolveFlag("evidence", policy).enabled) {
    return { allow: true, observed: { command: "none", outcome: "none (gate disabled)" } };
  }

  const runs = committed.commandResults.map((result) => ({
    ...result,
    outcome: parseOutcome(result.isError, result.resultText),
  }));

  // A ledger record this kernel did not observe is unverified, not evidence; one
  // it *did* observe and that says something else is a mismatch, which is a
  // different and more serious failure. Passing the observed calls is what makes
  // the second branch reachable at all.
  const observedIds = new Set(runs.map((run) => run.toolCallId));
  const observedCalls = new Map(runs.map((run) => [
    run.toolCallId,
    { command: run.command, outcome: describeOutcome(run.outcome) },
  ]));
  const { degraded } = classifyRecords(ledger, observedIds, observedCalls);

  const contradicted = degraded.filter((entry) => entry.reason === "mismatch");
  if (contradicted.length > 0) {
    // Fail closed and say which way: the ledger on disk disagrees with what this
    // process watched happen, so neither can be trusted to back a checkoff.
    return deny(
      `the ledger contradicts this session's observations: ${describeDegraded(contradicted).join(" ")}`,
      "re-run the verification command so a fresh, observed result replaces the contradicted record",
    );
  }

  if (runs.length === 0 && degraded.length > 0) {
    // Resuming in a new process lands here every time, by design: evidence
    // means "observed by this kernel", and a fresh process has observed
    // nothing yet. Correct, but a bare "insufficient evidence" would read as a
    // bug and get the gate switched off, so the refusal says what happened and
    // what to do about it.
    return deny(
      `the ledger holds ${degraded.length} record(s) from a previous session, which this kernel did not observe, so they are unverified and cannot support a checkoff`,
      "re-run the verification command in this session so the result is observed, then check the task off",
    );
  }

  if (runs.length === 0) {
    return deny(`no command has been observed running for ${request.task}, so there is nothing to record as evidence`);
  }

  // The declared check, before success is even considered: a green `echo` is
  // not a failing test run, it is not a test run at all.
  const relevant = request.runner === null
    ? runs
    : runs.filter((run) => isDeclaredRunner(run.command, request.runner!));
  if (relevant.length === 0) {
    const observed = runs.map((run) => `\`${run.command}\``).join(", ");
    return deny(
      `this feature declared \`${request.runner}\` as its verification runner, and no observed command was a run of it (observed: ${observed})`,
      `run \`${request.runner}\`, then check ${request.task} off once it is observed to succeed`,
    );
  }

  const green = relevant.filter((run) => isSuccess(run.outcome));
  if (green.length === 0) {
    const last = relevant[relevant.length - 1];
    return deny(`the last observed run of \`${last.command}\` ended ${describeOutcome(last.outcome)}, which is not success`);
  }

  const afterWrite = green.filter((run) => run.seq > (request.lastWriteSeq ?? 0) && run.at >= request.lastWriteAt);
  if (afterWrite.length === 0) {
    const last = green[green.length - 1];
    return deny(
      `the only observed success (\`${last.command}\`) ran before the last write to ${request.task}, so it says nothing about the current code`,
    );
  }

  if (request.tdd?.mode === "strict") {
    const chosen = afterWrite[afterWrite.length - 1];
    const red = relevant.find((run) => !isSuccess(run.outcome) && run.at <= chosen.at);
    if (!red) {
      return deny(
        `TDD mode is strict (${request.tdd.source}) but no failing (RED) run was observed before this success, so the test was never seen to fail first`,
      );
    }
  }

  const chosen = afterWrite[afterWrite.length - 1];
  return {
    allow: true,
    observed: {
      command: chosen.command,
      outcome: describeOutcome(chosen.outcome),
      at: chosen.at,
      toolCallId: chosen.toolCallId,
      ...(request.tdd?.mode === "strict" ? { tdd: request.tdd } : {}),
    },
  };
}

/** The feature doc's evidence line. Never rendered from anything but a decision. */
export function renderObserved(observed: ObservedEvidence | null): string {
  if (!observed) return "observed: none";
  if (observed.outcome === "none (gate disabled)") return "observed: none (gate disabled)";
  return `observed: \`${observed.command}\` → ${observed.outcome}`;
}
