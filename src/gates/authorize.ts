// gate-authorize — read-only work stays read-only.
//
// `routing.go:43-44`: investigation, explanation, review, audit and planning
// requests are read-only unless the user explicitly asked for a change; such
// work "may inspect, explain, compare, and recommend, but must not write or
// edit files, delegate a writer, invoke apply, or create implementation
// artifacts". Delegating a writer counts, which is why `subagent` is blocked
// here too — otherwise read-only would mean "do not write it yourself".
//
// This gate is silent when nothing was declared. That case belongs to
// `gate-classify`, and the two never double-block the same call.

import type { Committed } from "../state.ts";
import { allow, refuse, resolveFlag, type GateDecision, type Policy } from "./policy.ts";
import { isDelegation, isMutation } from "./request.ts";
import type { GateRequest } from "./request.ts";

export function authorizeGate(committed: Committed, request: GateRequest, policy: Policy): GateDecision {
  if (!resolveFlag("authorize", policy).enabled) return allow();

  const declaration = committed.declaration;
  if (!declaration || declaration.intent !== "read-only") return allow();

  if (!isMutation(request) && !isDelegation(request)) return allow();

  const what = isDelegation(request) ? `delegating to a writer (${request.toolName})` : `${request.toolName}`;
  return refuse(
    "authorize",
    `this request was declared \`intent: read-only\`, and ${what} would change the workspace`,
    "if the user did authorize a change, call `nodd_declare` again with `intent: change`",
  );
}
