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
  assert.deepEqual([...committed.filesWritten], ["c.ts", "d.ts"]);
  assert.equal(committed.delegations, 1);
  assert.equal(committed.toolCalls, 12);
  assert.deepEqual(committed.declaration, { intent: "change", route: "tracked", slug: "demo" });
  // Bash records are stored raw. Whether a command mutates is the classifier's
  // judgement (T014) and is derived at gate time, so the ledger never
  // pre-collapses an observation into a verdict.
  assert.deepEqual(committed.commandResults.map((r) => r.command), ["npm test", "echo hi > f.txt"]);
  assert.deepEqual(committed.commandResults[0], {
    toolCallId: "call_9", command: "npm test", isError: false, resultText: "ok",
    at: "2026-09-19T10:00:00.000Z",
  });
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

test("folding is total: an unknown tool advances only the call count", () => {
  const before = emptyCommitted();
  const after = fold(before, obs({ toolName: "some_other_extension_tool", input: { weird: true } }));
  assert.equal(after.toolCalls, 1);
  assert.equal(after.filesRead.size, 0);
  assert.equal(after.filesWritten.size, 0);
});

test("a later declaration replaces the earlier one", () => {
  const committed = foldAll(emptyCommitted(), [
    obs({ toolName: "nodd_declare", input: { intent: "read-only", route: "inline", slug: "a" } }),
    obs({ toolName: "nodd_declare", input: { intent: "change", route: "tracked", slug: "b" } }),
  ]);
  assert.deepEqual(committed.declaration, { intent: "change", route: "tracked", slug: "b" });
});

test("the reducer imports neither node:fs nor pi", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "state.ts"), "utf8");
  assert.ok(!src.includes("node:fs"), "state.ts must not touch the filesystem");
  assert.ok(!src.includes("@earendil-works/"), "state.ts must not import pi");
});
