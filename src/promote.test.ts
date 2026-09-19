import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyDoc, type FeatureDoc } from "./feature-doc.ts";
import { promotedRequirements } from "./promote.ts";

function doc(overrides: Partial<FeatureDoc> = {}): FeatureDoc {
  return {
    ...emptyDoc({ slug: "cache-warmup", title: "Warm the cache on boot" }),
    objective: "Serve the first request from a warm cache.",
    problem: "Cold starts take 4s because the cache is empty until the first miss.",
    scope: "The boot path only. Not the eviction policy.",
    constraints: "No new dependencies. Boot must stay under 1s.",
    tasks: [
      {
        id: "T001",
        title: "Read the boot sequence",
        checked: true,
        evidence: { command: "node --test src/boot.test.ts", outcome: "success" },
        candidate: "a1b2c3d",
      },
      {
        id: "T002",
        title: "Preload the ten hottest keys",
        checked: true,
        evidence: { command: "node --test src/cache.test.ts", outcome: "success" },
        candidate: "pending-commit",
      },
      { id: "T003", title: "Measure the cold-start delta", checked: false },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The content that must survive the handoff
// ---------------------------------------------------------------------------
test("the objective, problem, scope and constraints all reach the requirements", () => {
  const out = promotedRequirements(doc());
  assert.ok(out.includes("Serve the first request from a warm cache."));
  assert.ok(out.includes("Cold starts take 4s"));
  assert.ok(out.includes("Not the eviction policy."));
  assert.ok(out.includes("Boot must stay under 1s."));
  assert.ok(out.includes("cache-warmup"), "the slug identifies the run");
  assert.ok(out.includes("Warm the cache on boot"));
});

test("completed tasks arrive with their evidence under an already-resolved heading", () => {
  const out = promotedRequirements(doc());
  const heading = out.split("\n").find((line) => /^##+ /.test(line) && /resolved|done|already/i.test(line));
  assert.ok(heading, `an already-resolved section must exist:\n${out}`);

  const section = out.slice(out.indexOf(heading!));
  for (const fragment of [
    "Read the boot sequence",
    "Preload the ten hottest keys",
    "node --test src/boot.test.ts",
    "node --test src/cache.test.ts",
    "a1b2c3d",
  ]) {
    assert.ok(section.includes(fragment), `the resolved section must carry ${fragment}`);
  }
});

test("the resolved section says in words that this work must not be redone", () => {
  const out = promotedRequirements(doc());
  assert.match(out, /not be redone|do not redo|already done/i);
});

test("unchecked tasks are carried as remaining work, not as resolved", () => {
  const out = promotedRequirements(doc());
  const resolvedAt = out.search(/^##+ .*(resolved|already)/im);
  assert.ok(out.includes("Measure the cold-start delta"));
  assert.ok(
    out.indexOf("Measure the cold-start delta") < resolvedAt || !out.slice(resolvedAt).includes("Measure the cold-start delta"),
    "an unchecked task must not appear as already-resolved",
  );
});

// ---------------------------------------------------------------------------
// The deliberate omission
// ---------------------------------------------------------------------------
test("the output is a requirements document and nothing else", () => {
  const out = promotedRequirements(doc());
  assert.equal(typeof out, "string");
  assert.ok(out.startsWith("#"), "it opens as a markdown document");
  assert.ok(out.endsWith("\n"));
});

test("nothing in this module emits a design or a tasks document", () => {
  // Deliberate: forge's resume lands on `no-plan` and restarts at `plan` only
  // when design.md and tasks.md are absent (orchestrator.md:102-105). A module
  // that could write either would defeat the whole point of promoting.
  const source = readFileSync(new URL("./promote.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!source.includes("design.md"), "no design.md may be produced");
  assert.ok(!source.includes("tasks.md"), "no tasks.md may be produced");
});

test("the module is pure: it opens no file and writes nothing", () => {
  const source = readFileSync(new URL("./promote.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!source.includes("node:fs"), "string in, string out");
  assert.ok(!/writeFile|mkdir/.test(source));
});

// ---------------------------------------------------------------------------
// Degenerate inputs
// ---------------------------------------------------------------------------
test("a doc with no completed tasks says so rather than emitting an empty section", () => {
  const out = promotedRequirements(doc({ tasks: [{ id: "T001", title: "Only task", checked: false }] }));
  assert.match(out, /Only task/);
  assert.match(out, /ning|none|no completed|nothing/i);
});

test("an empty doc still produces a well-formed document", () => {
  const out = promotedRequirements(emptyDoc({ slug: "empty", title: "Empty" }));
  assert.ok(out.startsWith("# "));
  assert.ok(out.includes("empty"));
  assert.doesNotThrow(() => promotedRequirements(emptyDoc({ slug: "x", title: "" })));
});

test("promotion is deterministic: the same doc yields the same bytes", () => {
  assert.equal(promotedRequirements(doc()), promotedRequirements(doc()));
});
