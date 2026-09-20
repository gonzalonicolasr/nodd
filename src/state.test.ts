import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { observation, type Observation } from "./observations.ts";
import { emptyCommitted, fold, foldAll } from "./state.ts";

let seq = 0;
function obs(fields: Partial<Observation> & { toolName: string }): Observation {
  return observation({
    toolCallId: fields.toolCallId ?? `call_${++seq}`,
    toolName: fields.toolName,
    input: fields.input ?? {},
    isError: fields.isError ?? false,
    resultText: fields.resultText ?? "",
    at: fields.at ?? "2026-09-19T10:00:00.000Z",
  });
}

test("a fixed sequence folds into an exact snapshot", () => {
  seq = 0;
  const events: Observation[] = [
    obs({ toolName: "read", input: { path: "a.ts" } }),
    obs({ toolName: "read", input: { path: "b.ts" } }),
    obs({ toolName: "read", input: { path: "a.ts" } }),
    obs({ toolName: "grep", input: { pattern: "x" } }),
    obs({ toolName: "ls", input: { path: "." } }),
    obs({ toolName: "write", input: { path: "c.ts" } }),
    obs({ toolName: "edit", input: { path: "c.ts" } }),
    obs({ toolName: "edit", input: { path: "d.ts" } }),
    obs({ toolName: "bash", input: { command: "npm test" }, resultText: "ok" }),
    obs({ toolName: "bash", input: { command: "echo hi > f.txt" } }),
    obs({ toolName: "subagent", input: { agent: "nodd-explore" } }),
    obs({ toolName: "nodd_declare", input: { intent: "change", route: "tracked", slug: "demo" } }),
  ];

  const committed = foldAll(emptyCommitted(), events);
  assert.deepEqual([...committed.filesRead], ["a.ts", "b.ts"]);
  assert.deepEqual([...committed.filesWritten.keys()], ["c.ts", "d.ts"]);
  assert.equal(committed.delegations, 1);
  assert.equal(committed.toolCalls, 12);
  assert.deepEqual(committed.declaration, {
    intent: "change", route: "tracked", slug: "demo", runner: null, tdd: "off", files: [],
  });
  // Bash records are stored raw. Whether a command mutates is the classifier's
  // judgement (T014) and is derived at gate time, so the ledger never
  // pre-collapses an observation into a verdict.
  assert.deepEqual(committed.commandResults.map((r) => r.command), ["npm test", "echo hi > f.txt"]);
  assert.deepEqual(committed.commandResults[0], {
    toolCallId: "call_9", command: "npm test", isError: false, resultText: "ok",
    at: "2026-09-19T10:00:00.000Z", seq: 9,
  });
});

test("a write naming file_path is recorded, like pi's own write tool sends it", () => {
  // pi's write tool sends `file_path` (`write.js:99`); edit accepts both
  // (`edit.js:92`). Reading only `path` left filesWritten empty on every real
  // write — and filesWritten is what evidence times a checkoff against and what
  // delegate counts, so both went blind against the actual tool.
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "write", input: { file_path: "c.ts" } }),
    obs({ toolName: "read", input: { file_path: "a.ts" } }),
  ]);

  assert.deepEqual([...committed.filesWritten.keys()], ["c.ts"]);
  assert.deepEqual([...committed.filesRead], ["a.ts"]);
});

test("distinct-path counting: one file read six times is one file", () => {
  const events = Array.from({ length: 6 }, () => obs({ toolName: "read", input: { path: "same.ts" } }));
  const committed = foldAll(emptyCommitted(), events);
  assert.equal(committed.filesRead.size, 1);
  assert.equal(committed.toolCalls, 6);
});

test("replay is idempotent by toolCallId", () => {
  const events = [
    obs({ toolCallId: "r1", toolName: "read", input: { path: "a.ts" } }),
    obs({ toolCallId: "w1", toolName: "write", input: { path: "b.ts" } }),
    obs({ toolCallId: "b1", toolName: "bash", input: { command: "rm -rf x" } }),
  ];
  const once = foldAll(emptyCommitted(), events);
  const twice = foldAll(emptyCommitted(), [...events, ...events]);
  assert.deepEqual(twice, once);
});

// Without this, "the evidence ran after the edit" is not computable at all: a
// Set of paths has no ordering against a command result, which is how a green
// run predating the edit certified the edit in round 1.
test("a written file records when it was written, so evidence can be ordered against it", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "write", input: { path: "c.ts" }, at: "2026-09-19T10:00:00.000Z" }),
    obs({ toolName: "edit", input: { path: "d.ts" }, at: "2026-09-19T11:00:00.000Z" }),
  ]);
  assert.deepEqual(committed.filesWritten.get("c.ts"), { at: "2026-09-19T10:00:00.000Z", seq: 1 });
  assert.deepEqual(committed.filesWritten.get("d.ts"), { at: "2026-09-19T11:00:00.000Z", seq: 2 });
});

// Wall clocks are not fine-grained enough to order two tool results that land in
// the same millisecond, and in a real session a write and the run that follows
// it routinely do. Observation order is what the kernel actually knows.
test("observation order, not the clock, decides what came after what", () => {
  const sameInstant = "2026-09-19T10:00:00.000Z";
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "bash", input: { command: "npm test" }, at: sameInstant }),
    obs({ toolName: "edit", input: { path: "c.ts" }, at: sameInstant }),
  ]);
  assert.equal(committed.commandResults[0].at, committed.filesWritten.get("c.ts")!.at, "the clock cannot tell them apart");
  assert.ok(
    committed.filesWritten.get("c.ts")!.seq > committed.commandResults[0].seq,
    "but the kernel saw the edit second, and that is what ordering must use",
  );
});

test("rewriting a file moves its timestamp forward: the latest edit is the one evidence must postdate", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "write", input: { path: "c.ts" }, at: "2026-09-19T10:00:00.000Z" }),
    obs({ toolName: "edit", input: { path: "c.ts" }, at: "2026-09-19T12:00:00.000Z" }),
  ]);
  assert.equal(committed.filesWritten.size, 1, "distinct paths, still");
  assert.equal(committed.filesWritten.get("c.ts")!.at, "2026-09-19T12:00:00.000Z");
});

test("a declaration records its runner, its TDD mode and the files it promised to touch", () => {
  const committed = foldAll(emptyCommitted(), [obs({
    toolName: "nodd_declare",
    input: { intent: "change", route: "tracked", slug: "demo", runner: "npm test", tdd: "strict", files: ["a.ts", "b.ts", "a.ts"] },
  })]);
  assert.equal(committed.declaration?.runner, "npm test");
  assert.equal(committed.declaration?.tdd, "strict");
  assert.deepEqual(committed.declaration?.files, ["a.ts", "b.ts"], "distinct paths, as gate-promotion counts them");
});

test("a declaration without a runner records none, and never invents one", () => {
  const committed = foldAll(emptyCommitted(), [obs({
    toolName: "nodd_declare", input: { intent: "change", route: "tracked", slug: "demo" },
  })]);
  assert.equal(committed.declaration?.runner, null);
  assert.equal(committed.declaration?.tdd, "off");
  assert.deepEqual(committed.declaration?.files, []);
});

test("folding is total: an unknown tool advances only the call count", () => {
  const before = emptyCommitted();
  const after = fold(before, obs({ toolName: "some_other_extension_tool", input: { weird: true } }));
  assert.equal(after.toolCalls, 1);
  assert.equal(after.filesRead.size, 0);
  assert.equal(after.filesWritten.size, 0);
  assert.equal(after.commandResults.length, 0);
});

test("a later declaration replaces the earlier one", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "nodd_declare", input: { intent: "read-only", route: "inline", slug: "a" } }),
    obs({ toolName: "nodd_declare", input: { intent: "change", route: "tracked", slug: "b" } }),
  ]);
  assert.deepEqual(committed.declaration, {
    intent: "change", route: "tracked", slug: "b", runner: null, tdd: "off", files: [],
  });
});

test("a refused write does not count as a write", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "write", input: { path: "jamas-existio.txt" }, isError: true }),
  ]);
  assert.deepEqual([...committed.filesWritten.keys()], [], "a refused write touched no disk");
  assert.equal(committed.toolCalls, 1, "the attempt still counts as activity");
});

test("a successful write still counts as a write", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "write", input: { path: "real.ts" }, isError: false }),
  ]);
  assert.deepEqual([...committed.filesWritten.keys()], ["real.ts"]);
});

test("a refused edit does not count as a write, a successful one does", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "edit", input: { path: "refused.ts" }, isError: true }),
    obs({ toolName: "edit", input: { path: "ok.ts" }, isError: false }),
  ]);
  assert.deepEqual([...committed.filesWritten.keys()], ["ok.ts"]);
});

test("a refused read does not count as read context", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "read", input: { path: "denied.ts" }, isError: true }),
  ]);
  assert.equal(committed.filesRead.size, 0);
  assert.equal(committed.toolCalls, 1);
});

test("a refused delegation does not count as a delegation", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "subagent", input: { agent: "nodd-explore" }, isError: true }),
  ]);
  assert.equal(committed.delegations, 0);
  assert.equal(committed.toolCalls, 1);
});

test("the reducer imports neither node:fs nor pi", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "state.ts"), "utf8");
  assert.ok(!src.includes("node:fs"), "state.ts must not touch the filesystem");
  assert.ok(!src.includes("@earendil-works/"), "state.ts must not import pi");
});
