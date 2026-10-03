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
//
// The remedy names two paths, not one, following `track.ts:41-50`'s precedent:
// `nodd_declare` is correct and stays first, because it is the right answer for
// a parent session. But a subagent has neither `nodd_declare` in its toolset
// nor a slash command, so a refusal naming only that path was a dead end for
// it — this is D4. The second clause, reporting the refusal back to the
// delegator, needs no tool call at all and is reachable by any actor.

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
    // The remedy that needs no tool leads, because the refusal cannot know
    // what its reader holds. NODD's own generated agents now carry
    // `nodd_declare` and will take the second option; an agent from anywhere
    // else may not have it, and for that reader the first one always works.
    "report this back to the delegator so it can declare a route, " +
      "or call `nodd_declare` yourself with an explicit intent and route (`inline`, `tracked` or `forge`)",
  );
}
