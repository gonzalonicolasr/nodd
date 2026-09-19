// ODD's genuinely unmechanizable clauses — kept as guidance, labelled as guidance.
//
// One entry per `(P)` row of `REQ: odd-parity-matrix`, tagged with the canonical
// step it belongs to and carrying the reason it could not become a gate. That
// reason is load-bearing: the matrix forbids "we did not get to it", because a
// clause with no stated obstacle is a mechanism someone skipped, and a test here
// rejects that wording.
//
// **Why tag by step.** `src/prompt.ts` forwards only the current step's entries.
// Injecting all eighteen at every turn is how gentle's guidance wall reached
// 105,993 bytes: every clause was individually defensible. Scoping by step keeps
// the block inside its budget without anyone having to delete anything.
//
// This module is data, not behaviour. It reads no file, imports no gate, and is
// frozen so no caller can append to it at runtime.

import type { CanonicalStep } from "./manifest.ts";

export type ProseEntry = {
  /** Row number in `REQ: odd-parity-matrix`. */
  row: number;
  /** The `routing.go` line, as the matrix cites it. */
  line: string;
  step: CanonicalStep;
  /** The clause as forwarded to the model. */
  clause: string;
  /** Why it is not mechanizable. */
  reason: string;
};

export const ODD_PROSE: readonly ProseEntry[] = Object.freeze([
  {
    row: 4,
    line: ":45",
    step: "authorize",
    clause:
      "If change intent is ambiguous, ask one clarifying question and stay read-only until it is answered.",
    reason:
      "Whether a request is ambiguous is a judgement about natural language. NODD mechanizes the consequence — undeclared intent blocks the first write — but the asking itself cannot be derived from tool events.",
  },
  {
    row: 5,
    line: ":46",
    step: "explore",
    clause:
      "Explore the existing code and requirements first, proportionate to the request.",
    reason:
      "Proportionality is a judgement. The delegation counters mechanize the excess, never the sufficiency: NODD can see that too many files were read, never that enough were.",
  },
  {
    row: 6,
    line: ":47",
    step: "resolve-uncertainty",
    clause:
      "Research is optional and scoped to one named uncertainty: ask at most one focused question and make at most one assumption challenge.",
    reason:
      "Whether a premise is high-consequence and unproven is not observable from tool events; only the model reading the problem can tell.",
  },
  {
    row: 7,
    line: ":48",
    step: "classify",
    clause:
      "Substantial work means two or more meaningful steps, or progress worth recovering after an interruption. Small work stays small.",
    reason:
      "This is ODD's own admitted hole: the judgement is not mechanizable. NODD mechanizes only the declaration, so a skipped classification is observable instead of silent.",
  },
  {
    row: 11,
    line: ":50",
    step: "implement",
    clause:
      "Close every task with a work-unit commit using a Conventional Commit message, branching first when you are on the default branch.",
    reason:
      "NODD observes the commit and records its SHA, but the wording of a Conventional Commit message is prose, and branch/PR composition belongs to the delivery tools.",
  },
  {
    row: 19,
    line: ":63",
    step: "explore",
    clause:
      "Reading that prepares a write, and broad research, are delegated too — not only reading that stands on its own.",
    reason:
      "Intent-to-write is not visible in a read event. NODD cannot tell a read that prepares an edit from a read that answers a question, so the trigger stays advice.",
  },
  {
    row: 28,
    line: ":81",
    step: "explore",
    clause:
      "Preparation trigger: when reading is preparing a change rather than answering a question, delegate before the reading accumulates.",
    reason:
      "Same obstacle as row 19, and the reason NODD ships no `prepare` gate: a mechanism here would have to guess intent, and a gate that guesses is worse than prose that admits it.",
  },
  {
    row: 29,
    line: ":82",
    step: "implement",
    clause:
      "Two or more non-mechanical edits without delegating is a backstop trigger, alongside the tool-call and read counters.",
    reason:
      "Tool calls and distinct reads are counted exactly; whether an edit is non-mechanical is a judgement, so that third leg of the backstop is forwarded rather than counted.",
  },
  {
    row: 32,
    line: ":89",
    step: "resolve-uncertainty",
    clause:
      "If research is declined, continue only where it is safe to do so, and disclose the uncertainty that stayed unresolved.",
    reason:
      "Safety under missing evidence is a judgement about consequences, not an observable property of a session.",
  },
  {
    row: 33,
    line: ":90",
    step: "explore",
    clause:
      "Establish the problem, the outcome, the constraints and the evidence, adapting depth to consequence. The parent owns product decisions; workers return gaps instead of deciding.",
    reason:
      "The feature doc enforces the structure; how deep each section should go for a given consequence is prose.",
  },
  {
    row: 34,
    line: ":91",
    step: "resolve-uncertainty",
    clause:
      "Prefer primary sources, attribute every claim to a URL or a code location, and distinguish verified facts from assumptions.",
    reason:
      "Citation quality is not observable from tool events: NODD can see that a file was read, never whether the claim it supports is faithful to it.",
  },
  {
    row: 35,
    line: ":92",
    step: "resolve-uncertainty",
    clause:
      "Return findings, a recommendation, the tradeoffs and the open questions; forward research instructions to a fresh worker.",
    reason:
      "The report format is prose. The authority half is mechanized: an observed subagent result never sets intent — only an explicit declaration does.",
  },
  {
    row: 36,
    line: ":93",
    step: "resolve-uncertainty",
    clause:
      "Make at most one scoped assumption challenge, naming the premise, the evidence and the consequence. Do not open a debate loop.",
    reason:
      "Neither the scope of a challenge nor the onset of a debate loop is observable from tool events.",
  },
  {
    row: 38,
    line: ":95",
    step: "implement",
    clause:
      "About 400 authored changed lines per task is a planning heuristic only. It is not an acceptance criterion, not a hard cap, not a counter-trigger, not an automatic stop, not a forced split and not a review trigger. If the correct solution naturally exceeds it, say so briefly and continue.",
    reason:
      "A line count measures typing, not correctness. Mechanizing it would make the number an objective to optimize against, which is precisely what the clause forbids.",
  },
  {
    row: 39,
    line: ":95",
    step: "implement",
    clause:
      "Never delete blank lines or comments for cosmetic savings, never minify, never omit tests, never add gratuitous abstractions, and never split work artificially to fit the number. Forward this same advisory to every subagent.",
    reason:
      "This is the anti-gaming half of the heuristic, and it only works as prose: any mechanism enforcing it would itself become the thing to game.",
  },
  {
    row: 41,
    line: ":97",
    step: "track",
    clause:
      "Business scope changes still require the user's authorization, even when a finding makes the change look obviously correct.",
    reason:
      "Whether a change is a business scope change is a product judgement. The preservation, reason-required and checkbox halves of this clause are mechanized; this half is not.",
  },
  {
    row: 44,
    line: ":100",
    step: "track",
    clause:
      "Read the feature document and its observation, then pass the locator to every worker. Small work without a doc still receives its authorized scope and its checks.",
    reason:
      "Handoff discipline lives in the prompt the parent writes for the worker, which NODD does not author.",
  },
  {
    row: 49,
    line: ":103",
    step: "close",
    clause:
      "Ask once for the delivery strategy when the work is risky, rather than choosing chaining and slice boundaries silently.",
    reason:
      "The asking is the un-mechanized part: NODD records the strategy and measures the forecast, but deciding that a given change warrants asking is a judgement.",
  },
]);

export function proseForStep(step: CanonicalStep): readonly ProseEntry[] {
  return ODD_PROSE.filter((entry) => entry.step === step);
}
