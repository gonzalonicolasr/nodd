// gate-promotion — escalate on divergence, never on size.
//
// `REQ: escalation-divergence`. ODD escalates a route by predicted magnitude
// (`routing.go:68`); NODD keeps only the half of that decision it can observe.
// The two triggers are:
//
//   1. two consecutive non-`success` outcomes of the declared runner — the plan
//      is not working, which is a fact about observed results;
//   2. a task writing more distinct files than it declared — the work is not
//      the shape it was declared to be;
//
// ## The trigger that was removed
//
// A third trigger, "the user asked", was specified and then deleted, because it
// was not derivable. `/nodd-promote` lives in another extension with no path to
// kernel state, and it *performs* the promotion rather than requesting one —
// there is no moment at which a gate could observe the asking and still have
// something left to do about it. Round 1 shipped it as a hardcoded `false`,
// which is the failure this whole gate exists to refuse: a fabricated signal is
// worse than an absent one, so the condition is gone from the type, the gate,
// the requirement and the README rather than left there looking operational.
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
  /** Trailing non-`success` outcomes of the declared runner, derived by the caller. */
  consecutiveFailures: number;
  /** The command whose runs failed, quoted in the refusal. */
  failedTaskId: string | null;
  /** Distinct files the current task said it would touch. */
  declaredFiles: number;
  /** Distinct files it has actually written. */
  observedFiles: number;
};

const CONSECUTIVE_FAILURE_LIMIT = 2;

export function promotionGate(signals: PromotionSignals, request: GateRequest, policy: Policy): GateDecision {
  if (!resolveFlag("promotion", policy).enabled) return allow();
  if (!isFileWrite(request)) return allow();

  // Three paths, following D4's reachability invariant (T011).
  // `/nodd-promote` is a slash command, which a subagent cannot run, and
  // "keep going here" describes a state rather than a step — the call was
  // just blocked, so there is nothing for the refused actor to *do*.
  // Reporting upward needs no tool and is reachable by anyone.
  const action =
    "report the block to whoever delegated this work, " +
    `or promote the run with \`/nodd-promote ${signals.slug}\` so forge plans the rest, ` +
    "or ask the user to confirm the divergence is not real";

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
