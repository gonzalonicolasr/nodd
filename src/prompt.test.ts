import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, type Committed } from "./state.ts";
import { emptyPolicy, type Policy } from "./gates/policy.ts";
import { CANONICAL_STEPS } from "./manifest.ts";
import { BLOCK_A_BUDGET, BLOCK_B_BUDGET, renderPrompt } from "./prompt.ts";

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

test("every step, every policy, stays inside both budgets", () => {
  const states = [undeclared, tracked];
  const policies = [emptyPolicy(), allOff, { ...emptyPolicy(), hatches: { track: { reason: "x" } } }];

  for (const step of CANONICAL_STEPS) {
    for (const state of states) {
      for (const policy of policies) {
        const { blockA, blockB } = renderPrompt(state, policy, { step });
        assert.ok(blockA.length <= BLOCK_A_BUDGET, `block A at ${step} is ${blockA.length} > ${BLOCK_A_BUDGET}`);
        assert.ok(blockB.length <= BLOCK_B_BUDGET, `block B at ${step} is ${blockB.length} > ${BLOCK_B_BUDGET}`);
      }
    }
  }
});

test("a mid-implementation prompt stays under 4000 characters combined", () => {
  const { blockA, blockB } = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  assert.ok(blockA.length + blockB.length <= 4000, `combined ${blockA.length + blockB.length}`);
});

test("the budget is enforced by truncation, not by hope", () => {
  // If a future clause pushes a step over budget, the renderer must cut rather
  // than emit an oversized block — and the cut must be visible.
  const { blockB } = renderPrompt(tracked, emptyPolicy(), { step: "implement", blockBBudget: 200 });
  assert.ok(blockB.length <= 200, `truncated block is ${blockB.length}`);
  assert.match(blockB, /…|\.\.\./, "a truncated block says it was truncated");
});

test("the renderer is pure: same inputs, same bytes, no file access", () => {
  const first = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  const second = renderPrompt(tracked, emptyPolicy(), { step: "implement" });
  assert.deepEqual(first, second);
});
