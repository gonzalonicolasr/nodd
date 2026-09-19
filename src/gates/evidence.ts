// gate-evidence — the one that makes the rest worth having.
//
// ODD says "evidence is what you observed, not what you expect" and then lets
// the model write `Evidence: tests pass` with nothing behind it. Here a checkoff
// is refused unless a `success` outcome was observed, from a real command, after
// the task's last write.
//
// Three independent facts must line up, and each is checked against observation
// rather than assertion:
//
//   1. a command ran           — a `tool_result`, not an assistant sentence
//   2. it succeeded            — `isError === false`, i.e. exit 0 by pi's
//                                construction; `exit`/`aborted`/`timeout`/
//                                `unknown` never qualify (T019)
//   3. it ran after the edit   — a green run predating the change proves
//                                nothing about the change
//
// Plus a fourth, per the ledger integrity rule: the record must be one this
// kernel observed. A record on disk is a claim about the past; only the
// committed observation set makes it evidence.
//
// With the gate off the checkoff proceeds but the artifact says
// `observed: none (gate disabled)`. A disabled gate may stop enforcing; it may
// not make the document assert something that was never verified.

import type { Committed } from "../state.ts";
import { classifyRecords, type LedgerRecord } from "../ledger.ts";
import { describeOutcome, isSuccess, parseOutcome } from "../outcome.ts";
import { refuse, resolveFlag, type Policy, type Remedy } from "./policy.ts";

export type TddContext = { mode: "strict" | "off"; source: string; runner: string };

export type CheckRequest = {
  task: string;
  /** When the task's last observed write happened. Evidence must postdate it. */
  lastWriteAt: string;
  tdd?: TddContext;
};

export type ObservedEvidence = {
  command: string;
  outcome: string;
  at?: string;
  tdd?: TddContext;
};

export type EvidenceDecision =
  | { allow: true; observed: ObservedEvidence }
  | { allow: false; gate: "evidence"; reason: string; remedy: Remedy };

const REMEDY = "run the verification command, then check the task off once it is observed to succeed";

function deny(reason: string): EvidenceDecision {
  const refusal = refuse("evidence", reason, REMEDY);
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

  // A ledger record this kernel did not observe is unverified, not evidence.
  const observedIds = new Set(runs.map((run) => run.toolCallId));
  const { degraded } = classifyRecords(ledger, observedIds);
  if (runs.length === 0 && degraded.length > 0) {
    return deny(
      `the ledger holds ${degraded.length} record(s) this session did not observe, so they are unverified and cannot support a checkoff`,
    );
  }

  if (runs.length === 0) {
    return deny(`no command has been observed running for ${request.task}, so there is nothing to record as evidence`);
  }

  const green = runs.filter((run) => isSuccess(run.outcome));
  if (green.length === 0) {
    const last = runs[runs.length - 1];
    return deny(`the last observed run of \`${last.command}\` ended ${describeOutcome(last.outcome)}, which is not success`);
  }

  const afterWrite = green.filter((run) => run.at >= request.lastWriteAt);
  if (afterWrite.length === 0) {
    const last = green[green.length - 1];
    return deny(
      `the only observed success (\`${last.command}\`) ran before the last write to ${request.task}, so it says nothing about the current code`,
    );
  }

  if (request.tdd?.mode === "strict") {
    const chosen = afterWrite[afterWrite.length - 1];
    const red = runs.find((run) => !isSuccess(run.outcome) && run.at <= chosen.at);
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
