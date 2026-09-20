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
// For that to be a defence rather than a story, two things have to hold, and
// round 1 of this build had neither:
//
//   - **the test measures the corpus, not the cut.** `renderBlockA`/`renderBlockB`
//     are exported *unbudgeted* so `prompt.test.ts` can assert on what the
//     corpus renders to. Asserting on `renderPrompt`'s output instead compares
//     the truncator's output to the truncator's own limit, which no corpus can
//     fail.
//   - **overflow is loud.** A cut still happens — the budget is the mechanism —
//     but the emitted block says it was cut and by how much, and `renderPrompt`
//     returns the overflows so the caller can surface them. A silently dropped
//     clause is the exact failure this budget exists to prevent, so it must not
//     be how the budget is enforced.
//
// ## Guidance survives the kill switch
//
// With every gate disabled, block A collapses to one line and block B still
// forwards the step's prose: turning enforcement off is not a request to stop
// being useful. And the disabled notice contains **no suggestion to re-enable**
// (`routing.go:116`) — "do not start it, do not retry, do not reactivate".

import { GATE_IDS, type GateId } from "./gates/registry.ts";
import { resolveFlag, type Policy } from "./gates/policy.ts";
import { proseForStep, type ProseEntry } from "./odd-prose.ts";
import type { CanonicalStep } from "./manifest.ts";
import type { Committed } from "./state.ts";

/** Hard ceilings. See the ratchet note above before raising either. */
export const BLOCK_A_BUDGET = 1500;
export const BLOCK_B_BUDGET = 2500;

export type Prompt = {
  blockA: string;
  blockB: string;
  /** One line per block that did not fit. Empty when everything fitted. */
  overBudget: string[];
};

export type RenderOptions = {
  step?: CanonicalStep;
  blockABudget?: number;
  blockBBudget?: number;
};

/**
 * Whether some command observed to succeed ran after the most recent write.
 *
 * `close`'s honest signal: `Committed` holds no feature-doc checkoff state (the
 * doc lives on disk, and this module stays pure), so "the declared work is
 * done" is narrowed to the simplest thing this reducer can actually see --
 * writes happened, and a run after the last one succeeded. It is a heuristic
 * over observed state, exactly like the other five branches, and it can be
 * wrong in both directions; it is not a substitute for the evidence gate.
 */
function hasSuccessAfterLastWrite(committed: Committed): boolean {
  let lastWriteSeq = 0;
  for (const record of committed.filesWritten.values()) {
    if (typeof record?.seq === "number" && record.seq > lastWriteSeq) lastWriteSeq = record.seq;
  }
  return committed.commandResults.some((run) => run.seq > lastWriteSeq && !run.isError);
}

/** Where the session is, derived from what it has actually done. */
function currentStep(committed: Committed): CanonicalStep {
  // Checked first: the shape of "research is in flight" -- delegated, with no
  // change intent declared yet -- would otherwise be absorbed by the
  // undeclared branch below or by the read-only `explore` branch, and its 740
  // characters of corpus prose would never reach a turn.
  if (committed.delegations > 0 && committed.declaration?.intent !== "change") return "resolve-uncertainty";
  if (committed.declaration === null) return committed.toolCalls === 0 ? "authorize" : "classify";
  if (committed.declaration.intent === "read-only") return "explore";
  if (committed.filesWritten.size > 0 && hasSuccessAfterLastWrite(committed)) return "close";
  if (committed.filesWritten.size > 0) return "implement";
  return committed.declaration.route === "inline" ? "implement" : "track";
}

function enabledGates(policy: Policy): GateId[] {
  return GATE_IDS.filter((gate) => resolveFlag(gate, policy).enabled);
}

/**
 * Cut to budget and say so, in the block and to the caller. The notice is part
 * of the budget: it is rendered inside the remaining room, so an over-budget
 * block is still an under-budget block, just a visibly damaged one.
 */
function fit(text: string, budget: number, label: string): { text: string; problem: string | null } {
  if (text.length <= budget) return { text, problem: null };

  const problem = `${label} is ${text.length} characters, over its ${budget}-character budget: ${text.length - budget} were cut. Shorten or remove a clause instead of raising the budget.`;
  const notice = `\n[NODD: ${label} over budget — ${text.length}/${budget} characters, cut]`;
  const room = Math.max(0, budget - notice.length);
  return { text: `${text.slice(0, room).trimEnd()}${notice}`, problem };
}

/** Block A at full length, unbudgeted. The budget is applied by `renderPrompt`. */
export function renderBlockA(committed: Committed, policy: Policy, step: CanonicalStep): string {
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

/**
 * Block B at full length, unbudgeted. `entries` is injectable so the anti-ratchet
 * test can render a grown corpus and prove the budget assertion is reachable.
 */
export function renderBlockB(step: CanonicalStep, entries: readonly ProseEntry[] = proseForStep(step)): string {
  if (entries.length === 0) return "";
  // Only the clause text: the row number and the not-mechanizable reason are
  // there for the reader of the corpus, and spending budget on them would push
  // the useful half out.
  return [`ODD · guía para ${step} (orientativa, no verificada):`, ...entries.map((entry) => `- ${entry.clause}`)].join("\n");
}

export function renderPrompt(committed: Committed, policy: Policy, options: RenderOptions = {}): Prompt {
  const step = options.step ?? currentStep(committed);
  const a = fit(renderBlockA(committed, policy, step), options.blockABudget ?? BLOCK_A_BUDGET, "block A");
  const b = fit(renderBlockB(step), options.blockBBudget ?? BLOCK_B_BUDGET, "block B");
  return {
    blockA: a.text,
    blockB: b.text,
    overBudget: [a.problem, b.problem].filter((problem): problem is string => problem !== null),
  };
}
