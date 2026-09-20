import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { CANONICAL_STEPS } from "./manifest.ts";
import { GATE_IDS } from "./gates/registry.ts";
import { ODD_PROSE, proseForStep, type ProseEntry } from "./odd-prose.ts";
import { BLOCK_B_BUDGET, renderBlockB, renderPrompt } from "./prompt.ts";
import { emptyCommitted, type Committed } from "./state.ts";
import { emptyPolicy } from "./gates/policy.ts";

// The `(P)`-bearing rows of `REQ: odd-parity-matrix`. Listed here by number so
// that adding a row to the matrix without adding its clause fails loudly.
const P_ROWS = [4, 5, 6, 7, 11, 19, 28, 29, 32, 33, 34, 35, 36, 38, 39, 41, 44, 49];

// ---------------------------------------------------------------------------
// One entry per (P) row
// ---------------------------------------------------------------------------
test("the corpus has exactly one entry per (P) row of the parity matrix", () => {
  assert.deepEqual(ODD_PROSE.map((entry) => entry.row).sort((a, b) => a - b), P_ROWS);
  assert.equal(new Set(ODD_PROSE.map((entry) => entry.row)).size, ODD_PROSE.length, "no duplicated row");
});

test("every entry carries its routing.go line, a step tag, a clause and a reason", () => {
  for (const entry of ODD_PROSE) {
    assert.match(entry.line, /^:\d+/, `row ${entry.row} must cite a routing.go line`);
    assert.ok(CANONICAL_STEPS.includes(entry.step), `row ${entry.row} has step ${entry.step}`);
    assert.ok(entry.clause.length > 20, `row ${entry.row} needs a real clause`);
    assert.ok(entry.reason.length > 20, `row ${entry.row} needs a real reason`);
  }
});

test("no reason is the non-reason the matrix forbids", () => {
  for (const entry of ODD_PROSE) {
    assert.ok(
      !/did not get to|todo|later|not yet implemented/i.test(entry.reason),
      `row ${entry.row}: "we did not get to it" is not a reason`,
    );
  }
});

// ---------------------------------------------------------------------------
// The two clauses that must survive verbatim
// ---------------------------------------------------------------------------
test("the preparation trigger is carried under explore", () => {
  const entry = ODD_PROSE.find((e) => e.row === 28);
  assert.ok(entry, "row 28 must exist");
  assert.equal(entry!.step, "explore");
  assert.match(entry!.clause, /prepar/i);
  assert.equal(entry!.line, ":81");
});

test("the ~400-line advisory is carried under implement, marked as advisory only", () => {
  const entry = ODD_PROSE.find((e) => e.row === 38);
  assert.ok(entry);
  assert.equal(entry!.step, "implement");
  assert.match(entry!.clause, /400/);
  for (const negation of ["acceptance criterion", "hard cap", "automatic stop", "forced split"]) {
    assert.ok(entry!.clause.includes(negation), `the advisory must deny being a ${negation}`);
  }
});

test("the anti-gaming sentence is carried verbatim and names everything it forbids", () => {
  const entry = ODD_PROSE.find((e) => e.row === 39);
  assert.ok(entry);
  assert.equal(entry!.step, "implement");
  for (const forbidden of ["blank lines", "comments", "minify", "tests", "split"]) {
    assert.ok(entry!.clause.includes(forbidden), `the anti-gaming clause must name ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Selection by step
// ---------------------------------------------------------------------------
test("selecting a step returns that step's entries and nothing else", () => {
  for (const step of CANONICAL_STEPS) {
    for (const entry of proseForStep(step)) {
      assert.equal(entry.step, step, `${entry.row} leaked into ${step}`);
    }
  }
});

test("every entry is reachable through some step, so nothing is stranded", () => {
  const reachable = CANONICAL_STEPS.flatMap((step) => proseForStep(step).map((entry) => entry.row));
  assert.deepEqual(reachable.sort((a, b) => a - b), P_ROWS);
});

// A state whose currentStep() selects each step, built the same way
// prompt.test.ts's T004 cases are: from observed fields only, never from an
// options.step override, so this exercises the router itself.
const STATE_FOR_STEP: Record<(typeof CANONICAL_STEPS)[number], Committed> = {
  authorize: emptyCommitted(),
  explore: { ...emptyCommitted(), declaration: { intent: "read-only", route: "inline", slug: "audit", runner: null, tdd: "off", files: [] } },
  "resolve-uncertainty": { ...emptyCommitted(), delegations: 1 },
  classify: { ...emptyCommitted(), toolCalls: 1 },
  track: { ...emptyCommitted(), declaration: { intent: "change", route: "tracked", slug: "s", runner: null, tdd: "off", files: [] } },
  implement: {
    ...emptyCommitted(),
    declaration: { intent: "change", route: "tracked", slug: "s", runner: null, tdd: "off", files: [] },
    filesWritten: new Map([["/a.ts", { at: "t", seq: 1 }]]),
  },
  close: {
    ...emptyCommitted(),
    declaration: { intent: "change", route: "tracked", slug: "s", runner: null, tdd: "off", files: [] },
    filesWritten: new Map([["/a.ts", { at: "t", seq: 1 }]]),
    commandResults: [{ toolCallId: "c1", command: "npm test", isError: false, resultText: "ok", at: "t", seq: 2 }],
  },
};

// This is the test T004 exists for: the (P) rows passed while six of them were
// tagged with a step `currentStep()` could never select. Existence in the
// corpus is not enough -- the router has to actually land there, and
// `renderBlockB` for that step has to come out non-empty and inside budget.
test("every (P) row's step is reachable by the router, and its block B is non-empty and in budget", () => {
  for (const entry of ODD_PROSE) {
    const state = STATE_FOR_STEP[entry.step];
    assert.ok(state, `row ${entry.row}: no state fixture for step ${entry.step}`);
    const { blockA, blockB } = renderPrompt(state, emptyPolicy());
    assert.match(blockA, new RegExp(`step: ${entry.step}\\b`), `row ${entry.row}: currentStep() never selects ${entry.step} for this state`);
    assert.ok(blockB.length > 0, `row ${entry.row}: block B for ${entry.step} is empty`);
    assert.ok(renderBlockB(entry.step).length <= BLOCK_B_BUDGET, `row ${entry.row}: block B for ${entry.step} exceeds budget before truncation`);
  }
});

test("implement carries the two line-heuristic clauses together", () => {
  const rows = proseForStep("implement").map((entry) => entry.row);
  assert.ok(rows.includes(38) && rows.includes(39), "the advisory and its anti-gaming sentence travel together");
});

// ---------------------------------------------------------------------------
// The absent mechanisms are verified absent
// ---------------------------------------------------------------------------
test("no gate id contains `prepar`: the preparation trigger stayed prose", () => {
  const gates = readdirSync(new URL("./gates/", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const file of gates) {
    assert.ok(!/prepar/i.test(file), `${file} implies a preparation mechanism that must not exist`);
  }
  for (const id of GATE_IDS) assert.ok(!/prepar/i.test(id), `gate ${id} must not be a preparation trigger`);
});

test("no gate consults a line count: the 400-line figure stayed advisory", () => {
  const dir = new URL("./gates/", import.meta.url);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(new URL(file, dir), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const forbidden of ["countAuthoredLines", "lineCount", "linesChanged", "400"]) {
      assert.ok(!source.includes(forbidden), `${file} must not consult ${forbidden}`);
    }
  }
});

test("the corpus is data, not behaviour: it reads no file and imports no gate", () => {
  const source = readFileSync(new URL("./odd-prose.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!source.includes("node:fs"));
  assert.ok(!source.includes("./gates/"));
});

test("the corpus is frozen, so no caller can ratchet it at runtime", () => {
  assert.throws(() => (ODD_PROSE as ProseEntry[]).push({} as ProseEntry));
});
