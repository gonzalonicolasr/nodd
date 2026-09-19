import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyCommitted, fold, type Committed } from "./state.ts";
import { observation } from "./observations.ts";
import {
  candidateFor,
  chainBoundary,
  parseCommitSha,
  renderCandidate,
  sliceCandidate,
  type Boundary,
} from "./review-candidate.ts";

function afterCommands(runs: Array<{ command: string; text: string; isError?: boolean }>): Committed {
  let committed = emptyCommitted();
  runs.forEach((run, i) => {
    committed = fold(committed, observation({
      toolCallId: `c${i}`,
      toolName: "bash",
      input: { command: run.command },
      isError: run.isError === true,
      resultText: run.text,
      at: `2026-09-19T10:0${i}:00.000Z`,
    }));
  });
  return committed;
}

test("checking off with an observed commit records that SHA as the candidate", () => {
  const committed = afterCommands([
    { command: "git commit -m 'feat: thing'", text: "[main 1a2b3c4] feat: thing\n 2 files changed" },
  ]);
  const candidate = candidateFor(committed);
  assert.deepEqual(candidate, { kind: "commit", sha: "1a2b3c4" });
  assert.equal(renderCandidate(candidate), "candidate: 1a2b3c4");
});

test("a full SHA from git rev-parse is recorded too", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const committed = afterCommands([{ command: "git rev-parse HEAD", text: sha }]);
  assert.deepEqual(candidateFor(committed), { kind: "commit", sha });
});

test("the latest observed commit wins", () => {
  const committed = afterCommands([
    { command: "git commit -m 'one'", text: "[main aaaaaaa] one" },
    { command: "git commit -m 'two'", text: "[main bbbbbbb] two" },
  ]);
  assert.deepEqual(candidateFor(committed), { kind: "commit", sha: "bbbbbbb" });
});

test("checking off with no observed commit records pending-commit, never the checkbox", () => {
  const candidate = candidateFor(afterCommands([{ command: "npm test", text: "42 passing" }]));
  assert.deepEqual(candidate, { kind: "pending-commit" });
  assert.equal(renderCandidate(candidate), "candidate: pending-commit");
});

test("a failed commit is not a candidate: the SHA must come from a success", () => {
  const committed = afterCommands([
    { command: "git commit -m 'x'", text: "nothing to commit\n\nCommand exited with code 1", isError: true },
  ]);
  assert.deepEqual(candidateFor(committed), { kind: "pending-commit" });
});

test("prose that merely looks like commit output is not a candidate", () => {
  // The model may say anything; only a NODD-issued git command's observed
  // output is a source of SHAs.
  const claimed = fold(emptyCommitted(), observation({
    toolCallId: "a1",
    toolName: "assistant_message",
    input: { text: "I committed it as [main deadbee] feat: thing" },
    isError: false,
    resultText: "",
    at: "2026-09-19T10:00:00.000Z",
  }));
  assert.deepEqual(candidateFor(claimed), { kind: "pending-commit" });
});

test("boundary chaining: the first base is the branch point, each head becomes the next base", () => {
  const recorded: Boundary[] = [];
  const first = chainBoundary("origin/main", recorded, "slice1head");
  assert.deepEqual(first, { base: "origin/main", head: "slice1head" });

  recorded.push(first);
  const second = chainBoundary("origin/main", recorded, "slice2head");
  assert.deepEqual(second, { base: "slice1head", head: "slice2head" });

  const candidate = sliceCandidate(second);
  assert.deepEqual(candidate, { kind: "slice", base: "slice1head", head: "slice2head" });
  assert.equal(renderCandidate(candidate), "candidate: slice slice1head..slice2head");
});

test("parseCommitSha reads only the formats NODD issues", () => {
  assert.equal(parseCommitSha("git commit -m 'x'", "[feature/x 9f8e7d6] x"), "9f8e7d6");
  assert.equal(parseCommitSha("git commit --amend", "[main 1234567] x"), "1234567");
  assert.equal(parseCommitSha("git log --oneline", "1234567 some commit"), null, "log is not a commit event");
  assert.equal(parseCommitSha("npm test", "[main 1234567] looks like a commit"), null, "not a git command");
  assert.equal(parseCommitSha("git commit -m 'x'", "nothing to commit"), null);
});

// The rule is structural: no candidate identity may ever be a task id or a
// checkbox state. `routing.go:51`,`:102`.
test("no candidate identity is a task id or a checkbox state", () => {
  const identities = [
    renderCandidate({ kind: "commit", sha: "1a2b3c4" }),
    renderCandidate({ kind: "pending-commit" }),
    renderCandidate(sliceCandidate({ base: "a", head: "b" })),
  ];
  for (const rendered of identities) {
    assert.doesNotMatch(rendered, /\bT\d+\b/, `${rendered} must not carry a task id`);
    assert.doesNotMatch(rendered, /\b(true|false|\[x\]|\[ \])\b/, `${rendered} must not carry checkbox state`);
  }

  const source = readFileSync(new URL("./review-candidate.ts", import.meta.url), "utf8");
  assert.ok(!/\bchecked\b/.test(source), "the candidate module must not read checkbox state");
  assert.ok(!/\btaskId\b/.test(source), "the candidate module must not take a task id");
});
