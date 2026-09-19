// gate-classify — no first write without a declared route.
//
// This is the gate aimed squarely at the hole gentle admits in its own task
// file: "ODD routing is pure model judgment: nothing requires the route
// decision to be stated, recorded, or checked, so non-delegation is invisible."
//
// NODD does not mechanize the *judgement* — whether work is "substantial" is
// not observable from tool events, and pretending otherwise would be inventing
// enforcement. It mechanizes the *declaration*: until a `nodd_declare` result
// is committed, the first write does not happen. A skipped classification stops
// being invisible, which is all a mechanism can honestly do here.

import type { Committed } from "../state.ts";
import type { PendingCall } from "../observations.ts";
import { allow, refuse, resolveFlag, type GateDecision, type Policy } from "./policy.ts";
import { isMutation, type GateRequest } from "./request.ts";

export function classifyGate(
  committed: Committed,
  request: GateRequest,
  policy: Policy,
  pending: Map<string, PendingCall>,
): GateDecision {
  if (!resolveFlag("classify", policy).enabled) return allow();
  if (committed.declaration) return allow();
  if (!isMutation(request)) return allow();

  // A declaration preflighted in this same batch has not run yet: pi does not
  // guarantee sibling results are visible here, so treating it as done would be
  // accepting evidence that does not exist. Say so, and say what to do.
  const declaringSibling = [...pending.values()].some((call) => call.toolName === "nodd_declare");
  if (declaringSibling) {
    return refuse(
      "classify",
      "a `nodd_declare` call is in this same assistant message, but sibling results are not observable yet, so no route is recorded",
      "let this batch finish, then reissue the write on the next turn",
    );
  }

  return refuse(
    "classify",
    `no route has been declared for this session, and ${request.toolName} would be the first change`,
    "call `nodd_declare` with an explicit intent and route (`inline`, `tracked` or `forge`)",
  );
}
