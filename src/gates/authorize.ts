// gate-authorize — read-only work stays read-only.
//
// `routing.go:43-44`: investigation, explanation, review, audit and planning
// requests are read-only unless the user explicitly asked for a change; such
// work "may inspect, explain, compare, and recommend, but must not write or
// edit files, delegate a writer, invoke apply, or create implementation
// artifacts". Delegating a *writer* counts as a mutation by proxy — but
// delegating a *read-only* worker does not: ODD `:70`/`:92` requires exactly
// that (a read-only worker doing the mapping a parent should not spend its own
// context on), so blocking every `subagent` call would forbid a delegation ODD
// itself asks for.
//
// The distinction is the target's **declared capability**, never its name — a
// name list misclassifies a user-defined agent and breaks on rename. The
// lookup is injected, following the `trackGate(…, docExists)` precedent: this
// module stays pure, and the kernel supplies the real answer by reading the
// target agent's `tools:` frontmatter. A target whose capability cannot be
// determined is refused: failing open here would let a rename silently reopen
// the writer path this gate exists to close.
//
// This gate is silent when nothing was declared. That case belongs to
// `gate-classify`, and the two never double-block the same call.

import type { Committed } from "../state.ts";
import { allow, refuse, resolveFlag, type GateDecision, type Policy } from "./policy.ts";
import { isDelegation, isMutation } from "./request.ts";
import type { GateRequest } from "./request.ts";

/**
 * `true` when the named target is known to be read-only, `false` when it is
 * known to be able to write, `null` when its capability cannot be determined.
 */
export type CapabilityLookup = (agentName: string) => boolean | null;

function targetAgentName(request: GateRequest): string | null {
  const agent = request.input?.agent;
  return typeof agent === "string" && agent !== "" ? agent : null;
}

export function authorizeGate(
  committed: Committed,
  request: GateRequest,
  policy: Policy,
  isReadOnlyAgent: CapabilityLookup = () => null,
): GateDecision {
  if (!resolveFlag("authorize", policy).enabled) return allow();

  const declaration = committed.declaration;
  if (!declaration || declaration.intent !== "read-only") return allow();

  if (isDelegation(request)) {
    const name = targetAgentName(request);
    const readOnly = name !== null ? isReadOnlyAgent(name) : null;
    if (readOnly === true) return allow();

    const what = readOnly === null
      ? `delegating to \`${name ?? "(unnamed)"}\`, whose capability could not be determined`
      : `delegating to \`${name}\`, a writer`;
    return refuse(
      "authorize",
      `this request was declared \`intent: read-only\`, and ${what}`,
      "delegate to a read-only agent, or call `nodd_declare` again with `intent: change` if the user did authorize one, " +
        "or report the block to whoever delegated this work",
    );
  }

  if (!isMutation(request)) return allow();

  return refuse(
    "authorize",
    `this request was declared \`intent: read-only\`, and ${request.toolName} would change the workspace`,
    // `nodd_declare` is the correct first remedy, but a subagent has neither
    // that tool nor slash commands. Today this branch needs a declaration to
    // fire, and a child kernel starts with none — but that is an argument
    // about reachability today, not a property of the gate. Naming a remedy
    // that needs no tool costs nothing and does not depend on it holding.
    "if the user did authorize a change, call `nodd_declare` again with `intent: change`, " +
      "or report the block to whoever delegated this work",
  );
}
