// The dynamic prompt: two blocks, both budgeted.
//
// Block A is the session's *state* — current step, enabled gates, what is
// missing, how to unblock. Block B is the forwarded prose for that step and
// nothing else (`src/odd-prose.ts`).
//
// ## Why there are hard budgets
//
// gentle's guidance surface reached **105,993 bytes** one defensible clause at a
// time. No single addition was wrong; the sum was. A budget is the only defence
// that does not depend on the next author's restraint, so these two numbers are
// enforced by truncation and pinned by a test that fails if a block grows past
// them. Adding a clause that does not fit is therefore a decision to remove or
// shorten another — which is exactly the conversation that never happened in
// gentle.
//
// ## Guidance survives the kill switch
//
// With every gate disabled, block A collapses to one line and block B still
// forwards the step's prose: turning enforcement off is not a request to stop
// being useful. And the disabled notice contains **no suggestion to re-enable**
// (`routing.go:116`) — "do not start it, do not retry, do not reactivate".

import { GATE_IDS, type GateId } from "./gates/registry.ts";
import { resolveFlag, type Policy } from "./gates/policy.ts";
import { proseForStep } from "./odd-prose.ts";
import type { CanonicalStep } from "./manifest.ts";
import type { Committed } from "./state.ts";

/** Hard ceilings. See the ratchet note above before raising either. */
export const BLOCK_A_BUDGET = 1500;
export const BLOCK_B_BUDGET = 2500;

export type Prompt = { blockA: string; blockB: string };

export type RenderOptions = {
  step?: CanonicalStep;
  blockABudget?: number;
  blockBBudget?: number;
};

/** Where the session is, derived from what it has actually done. */
function currentStep(committed: Committed): CanonicalStep {
  if (committed.declaration === null) return committed.toolCalls === 0 ? "authorize" : "classify";
  if (committed.declaration.intent === "read-only") return "explore";
  if (committed.filesWritten.size > 0) return "implement";
  return committed.declaration.route === "inline" ? "implement" : "track";
}

function enabledGates(policy: Policy): GateId[] {
  return GATE_IDS.filter((gate) => resolveFlag(gate, policy).enabled);
}

/** Cut to budget, visibly. A silently trimmed clause is worse than a short one. */
function fit(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(0, budget - 1)).trimEnd()}…`;
}

function renderBlockA(committed: Committed, policy: Policy, step: CanonicalStep): string {
  const enabled = enabledGates(policy);

  if (enabled.length === 0) {
    // One line, and not a word about turning anything back on.
    return "NODD: gates disabled. Working normally; no enforcement is applied.";
  }

  const lines = [`NODD · step: ${step} · gates activos: ${enabled.join(", ")}`];

  if (committed.declaration === null) {
    lines.push("Sin declaración: el primer write está bloqueado hasta que llames `nodd_declare` con intent y route.");
  } else {
    const { intent, route, slug } = committed.declaration;
    lines.push(`Declarado: intent ${intent} · route ${route} · slug ${slug}.`);
  }

  const disabled = GATE_IDS.filter((gate) => !resolveFlag(gate, policy).enabled);
  if (disabled.length > 0) lines.push(`Apagados por el usuario: ${disabled.join(", ")}.`);

  const hatches = Object.keys(policy.hatches);
  if (hatches.length > 0) lines.push(`Hatch de un uso pendiente: ${hatches.join(", ")}.`);

  lines.push("Para saltear un gate una vez: `/nodd-allow <gate>`.");
  return lines.join("\n");
}

function renderBlockB(step: CanonicalStep): string {
  const entries = proseForStep(step);
  if (entries.length === 0) return "";
  // Only the clause text: the row number and the not-mechanizable reason are
  // there for the reader of the corpus, and spending budget on them would push
  // the useful half out.
  return [`ODD · guía para ${step} (orientativa, no verificada):`, ...entries.map((entry) => `- ${entry.clause}`)].join("\n");
}

export function renderPrompt(committed: Committed, policy: Policy, options: RenderOptions = {}): Prompt {
  const step = options.step ?? currentStep(committed);
  return {
    blockA: fit(renderBlockA(committed, policy, step), options.blockABudget ?? BLOCK_A_BUDGET),
    blockB: fit(renderBlockB(step), options.blockBBudget ?? BLOCK_B_BUDGET),
  };
}
