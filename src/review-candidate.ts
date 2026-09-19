// What gets reviewed is a commit or a slice — never a checkbox.
//
// `routing.go:51`,`:102`: "the native review candidate is a work-unit commit or
// a PR slice, never a TODO checkbox and never the accumulated branch". A
// checkbox is a claim the model wrote down; a commit is a thing that exists.
// This module only ever hands out the second kind.
//
// The SHA comes from the observed output of a NODD-issued `git` command, on the
// same rule as command outcomes (T019): the model's prose is not an input. When
// no commit has been observed the candidate is `pending-commit` — an honest
// absence, not a substitute identity.
//
// Slices carry an explicit (base, head) pair. The accumulated branch is never a
// candidate: "everything since we started" is not reviewable, which is the
// failure mode the clause exists to prevent.

import type { Committed } from "./state.ts";
import { parseOutcome, isSuccess } from "./outcome.ts";

export type Boundary = { base: string; head: string };

export type Candidate =
  | { kind: "commit"; sha: string }
  | { kind: "slice"; base: string; head: string }
  | { kind: "pending-commit" };

/** `git commit` prints `[<branch> <sha>] <subject>`; `rev-parse` prints the sha alone. */
export function parseCommitSha(command: string, resultText: string): string | null {
  if (!/\bgit\s+(commit|rev-parse)\b/.test(command)) return null;

  const committed = /^\[[^\]\s]+ ([0-9a-f]{7,40})\]/m.exec(resultText);
  if (committed) return committed[1];

  if (/\bgit\s+rev-parse\b/.test(command)) {
    const bare = /^([0-9a-f]{40})$/m.exec(resultText.trim());
    if (bare) return bare[1];
  }

  return null;
}

/**
 * The candidate for a checkoff: the most recent SHA this session observed a
 * successful `git` command produce, or `pending-commit`.
 */
export function candidateFor(committed: Committed): Candidate {
  for (let i = committed.commandResults.length - 1; i >= 0; i--) {
    const run = committed.commandResults[i];
    if (!isSuccess(parseOutcome(run.isError, run.resultText))) continue;
    const sha = parseCommitSha(run.command, run.resultText);
    if (sha) return { kind: "commit", sha };
  }
  return { kind: "pending-commit" };
}

export function sliceCandidate(boundary: Boundary): Candidate {
  return { kind: "slice", base: boundary.base, head: boundary.head };
}

/**
 * The next boundary. The first base is the branch point; afterwards each
 * recorded head becomes the next base, so slices tile the work instead of each
 * one re-proposing the whole branch.
 */
export function chainBoundary(branchPoint: string, recorded: Boundary[], head: string): Boundary {
  const previous = recorded[recorded.length - 1];
  return { base: previous ? previous.head : branchPoint, head };
}

/** The identity alone, for the feature doc's `candidate:` field. */
export function candidateIdentity(candidate: Candidate): string {
  switch (candidate.kind) {
    case "commit": return candidate.sha;
    case "slice": return `slice ${candidate.base}..${candidate.head}`;
    case "pending-commit": return "pending-commit";
  }
}

export function renderCandidate(candidate: Candidate): string {
  return `candidate: ${candidateIdentity(candidate)}`;
}
