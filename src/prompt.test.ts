import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, type Committed } from "./state.ts";
import { emptyPolicy, type Policy } from "./gates/policy.ts";
import { CANONICAL_STEPS } from "./manifest.ts";
import { ODD_PROSE, type ProseEntry } from "./odd-prose.ts";
import { BLOCK_A_BUDGET, BLOCK_B_BUDGET, renderBlockA, renderBlockB, renderPrompt } from "./prompt.ts";

function committed(overrides: Partial<Committed> = {}): Committed {
  return { ...emptyCommitted(), ...overrides };
}

const undeclared = committed();

const tracked = committed({
  declaration: { intent: "change", route: "tracked", slug: "cache-warmup" },
  filesRead: new Set(["/repo/a.ts", "/repo/b.ts"]),
  filesWritten: new Set(["/repo/a.ts"]),
  toolCalls: 12,
});

const allOff: Policy = { ...emptyPolicy(), flags: { all: false } };

// ---------------------------------------------------------------------------
// Block A — the state
// ---------------------------------------------------------------------------
test("an undeclared session is told what is missing and how to declare it", () => {
  const { blockA } = renderPrompt(undeclared, emptyPolicy());
  assert.match(blockA, /nodd_declare/, "the unblocking action is named");
  assert.match(blockA, /authorize/, "the current step is named");
});

test("a tracked session names its slug, its route and the enabled gates", () => {
  const { blockA } = renderPrompt(tracked, emptyPolicy());
  assert.ok(blockA.includes("cache-warmup"));
  assert.ok(blockA.includes("tracked"));
  assert.ok(blockA.includes("evidence"), "the evidence gate is listed as enabled");
});

test("the escape-hatch syntax is always available in block A", () => {
  assert.match(renderPrompt(tracked, emptyPolicy()).blockA, /\/nodd-allow/);
});

test("a used hatch is reported, so a one-shot override is not silently spent", () => {
  const policy: Policy = { ...emptyPolicy(), hatches: { track: { reason: "hand-edit" } } };
  const { blockA } = renderPrompt(tracked, policy);
  assert.match(blockA, /track/);
  assert.match(blockA, /hatch|habilitad|override/i);
});

// ---------------------------------------------------------------------------
// Disabled gates
// ---------------------------------------------------------------------------
test("with every gate off block A is a single line", () => {
  const { blockA } = renderPrompt(tracked, allOff);
  assert.equal(blockA.trim().split("\n").length, 1, `expected one line, got:\n${blockA}`);
});

test("the disabled notice never suggests re-enabling anything", () => {
  const policies: Policy[] = [allOff, { ...emptyPolicy(), config: { track: { enabled: false } } }];
  for (const policy of policies) {
    const { blockA } = renderPrompt(tracked, policy);
    for (const forbidden of ["re-enable", "reenable", "volvé a activar", "turn it back on", "reactivar", "nodd-gates on"]) {
      assert.ok(!blockA.toLowerCase().includes(forbidden.toLowerCase()), `block A must not say "${forbidden}"`);
    }
  }
});

test("a gate turned off is not listed as enabled", () => {
  const policy: Policy = { ...emptyPolicy(), config: { track: { enabled: false } } };
  const { blockA } = renderPrompt(tracked, policy);
  const enabledLine = blockA.split("\n").find((line) => /activ|enabled/i.test(line)) ?? "";
  assert.ok(!enabledLine.includes("track"), `track must not appear as enabled: ${enabledLine}`);
});

// ---------------------------------------------------------------------------
// Block B — forwarded prose, scoped to the step
// ---------------------------------------------------------------------------
test("block B still forwards step prose even with every gate off", () => {
  const { blockB } = renderPrompt(tracked, allOff);
  assert.ok(blockB.length > 0, "guidance survives the kill switch; only enforcement stops");
});

test("block B for implement carries the line advisory and no explore-only clause", () => {
  const state = committed({ declaration: { intent: "change", route: "tracked", slug: "s" }, filesWritten: new Set(["/a.ts"]) });
  const { blockB } = renderPrompt(state, emptyPolicy(), { step: "implement" });
  assert.match(blockB, /400/, "the implement step carries the advisory");
  assert.ok(!blockB.includes("Proportionality"), "an explore-only reason must not leak in");
  assert.ok(!blockB.includes("proportionate to the request"), "an explore-only clause must not leak in");
});

test("block B for explore carries the preparation trigger and not the line advisory", () => {
  const { blockB } = renderPrompt(tracked, emptyPolicy(), { step: "explore" });
  assert.match(blockB, /prepar/i);
  assert.ok(!blockB.includes("400"), "the line figure belongs to implement");
});

// ---------------------------------------------------------------------------
// The budgets — this is the anti-ratchet mechanism
// ---------------------------------------------------------------------------
test("the budgets are the documented numbers", () => {
  assert.equal(BLOCK_A_BUDGET, 1500);
  assert.equal(BLOCK_B_BUDGET, 2500);
});

// This is the anti-ratchet assertion, and it is deliberately made on the text
// *before* `renderPrompt` cuts it. Asserting on the emitted block would be
// `min(len, budget) <= budget` — an assertion no corpus on earth can fail,
// which is exactly the shape the round-1 verdict caught. Here, one clause too
// many turns this red.
test("every step, every policy, stays inside both budgets BEFORE any truncation", () => {
  const states = [undeclared, tracked];
  const policies = [emptyPolicy(), allOff, { ...emptyPolicy(), hatches: { track: { reason: "x" } } }];

  for (const step of CANONICAL_STEPS) {
    const blockB = renderBlockB(step);
    assert.ok(blockB.length <= BLOCK_B_BUDGET, `block B at ${step} is ${blockB.length} > ${BLOCK_B_BUDGET} before truncation`);
    for (const state of states) {
      for (const policy of policies) {
        const blockA = renderBlockA(state, policy, step);
        assert.ok(blockA.length <= BLOCK_A_BUDGET, `block A at ${step} is ${blockA.length} > ${BLOCK_A_BUDGET} before truncation`);
      }
    }
  }
});

// The test above is only a defence if it can fail. This one proves it can, by
// doing to the corpus exactly what the verdict did: growing it. If this ever
// stops throwing, the assertion above has gone tautological again.
test("growing the corpus past the budget makes the anti-ratchet assertion fail", () => {
  const padding: ProseEntry[] = Array.from({ length: 40 }, (_, i) => ({
    row: 1000 + i,
    line: ":999",
    step: "implement" as const,
    clause: `Filler clause ${i}: individually defensible, collectively a wall of prose.`,
    reason: "a padding entry, here only to prove the budget assertion is reachable",
  }));
  const grown = [...ODD_PROSE.filter((entry) => entry.step === "implement"), ...padding];

  const rendered = renderBlockB("implement", grown);
  assert.ok(
    rendered.length > BLOCK_B_BUDGET,
    "40 extra clauses must overflow the budget; if they do not, the budget is not measuring the corpus",
  );
  assert.throws(
    () => assert.ok(rendered.length <= BLOCK_B_BUDGET),
    "the anti-ratchet assertion must reject a grown corpus",
  );
});

test("a real ODD clause is never silently dropped to make room", () => {
  // The verdict's worst finding: with padding injected first, all four real
  // `implement` clauses fell out of the emitted block and nothing said so.
  const real = ODD_PROSE.filter((entry) => entry.step === "implement");
  const blockB = renderBlockB("implement");
  for (const entry of real) {
    assert.ok(blockB.includes(entry.clause), `row ${entry.row} must survive into block B whole`);
  }
});

test("a mid-implementation prompt stays under 4000 characters combined", () => {
  const { blockA, blockB } = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  assert.ok(blockA.length + blockB.length <= 4000, `combined ${blockA.length + blockB.length}`);
});

test("an over-budget block is cut, and the cut is announced in the block itself", () => {
  // Production must not lose characters quietly. The cut stays — the budget is
  // the point — but the block says it happened and by how much, so the next
  // author meets the decision instead of the loss.
  const { blockB, overBudget } = renderPrompt(tracked, emptyPolicy(), { step: "implement", blockBBudget: 200 });
  assert.ok(blockB.length <= 200, `truncated block is ${blockB.length}`);
  assert.match(blockB, /NODD/, "the notice names who cut it");
  assert.match(blockB, /over budget|cut/i, "a truncated block says it was truncated");
  assert.match(blockB, new RegExp(String(renderBlockB("implement").length)), "and reports the real pre-cut size");
  assert.deepEqual(
    overBudget.length,
    1,
    "an overflow is reported to the caller, not only buried in the text",
  );
  assert.match(overBudget[0], /block B/, overBudget[0]);
});

test("a block inside its budget reports no overflow and carries no notice", () => {
  const { blockA, blockB, overBudget } = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  assert.deepEqual(overBudget, [], "the shipped corpus fits, so nothing is announced");
  assert.ok(!blockA.includes("over budget") && !blockB.includes("over budget"));
});

test("the renderer is pure: same inputs, same bytes, no file access", () => {
  const first = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  const second = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  assert.deepEqual(first, second);
});
