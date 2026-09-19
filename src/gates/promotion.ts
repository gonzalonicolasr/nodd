// gate-promotion — escalate on divergence, never on size.
//
// `REQ: escalation-divergence`. ODD escalates a route by predicted magnitude
// (`routing.go:68`); NODD keeps only the half of that decision it can observe.
// The three triggers are:
//
//   1. two consecutive non-`success` outcomes on the same task — the plan is
//      not working, which is a fact about observed results;
//   2. a task writing more distinct files than it declared — the work is not
//      the shape it was declared to be;
//   3. the user asking.
//
// **No size, line count, byte count or risk score is read.** A big task that
// succeeds is not divergent, and a three-line task that fails twice is. The
// counts this gate does use are *declared vs observed*, which is a mismatch, not
// a magnitude: 40 files against 40 declared allows, 3 against 2 blocks. A test
// scans this file for every size-flavoured identifier, including any import of
// `delivery.ts`, whose line counter exists to inform a human and must never
// reach a gate.
//
// A block offers exactly two ways forward, because a gate that stops the work
// without naming the exit is a dead end.

import { allow, refuse, resolveFlag, type GateDecision, type Policy } from "./policy.ts";
import type { GateRequest } from "./request.ts";
import { isFileWrite } from "./request.ts";

export type PromotionSignals = {
  slug: string;
  /** Non-`success` outcomes in a row on `failedTaskId`. Reset by the caller. */
  consecutiveFailures: number;
  failedTaskId: string | null;
  /** Distinct files the current task said it would touch. */
  declaredFiles: number;
  /** Distinct files it has actually written. */
  observedFiles: number;
  userRequested: boolean;
};

const CONSECUTIVE_FAILURE_LIMIT = 2;

export function promotionGate(signals: PromotionSignals, request: GateRequest, policy: Policy): GateDecision {
  if (!resolveFlag("promotion", policy).enabled) return allow();
  if (!isFileWrite(request)) return allow();

  const action =
    `promote the run with \`/nodd-promote ${signals.slug}\` so forge plans the rest, ` +
    "or keep going here if you judge the divergence is not real";

  if (signals.userRequested) {
    return refuse("promotion", `pediste promover ${signals.slug} a forge`, action);
  }

  if (signals.consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
    return refuse(
      "promotion",
      `task ${signals.failedTaskId ?? "(unnamed)"} has failed ${signals.consecutiveFailures} times in a row: ` +
        "the plan is not working, which is what escalation is for",
      action,
    );
  }

  // Zero declared means nothing was promised, so there is nothing to diverge
  // from — that is an undeclared task, which is `gate-track`'s business.
  if (signals.declaredFiles > 0 && signals.observedFiles > signals.declaredFiles) {
    return refuse(
      "promotion",
      `this task declared ${signals.declaredFiles} file(s) and has written ${signals.observedFiles}: ` +
        "the work is not the shape it was declared to be",
      action,
    );
  }

  return allow();
}
