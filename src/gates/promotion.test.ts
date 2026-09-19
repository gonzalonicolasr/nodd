import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyPolicy } from "./policy.ts";
import { promotionGate, type PromotionSignals } from "./promotion.ts";

const noSignals: PromotionSignals = {
  slug: "cache-warmup",
  consecutiveFailures: 0,
  failedTaskId: null,
  declaredFiles: 0,
  observedFiles: 0,
};

const request = { toolName: "write", input: { file_path: "/repo/src/cache.ts" } };

function decide(signals: Partial<PromotionSignals>) {
  return promotionGate({ ...noSignals, ...signals }, request, emptyPolicy());
}

// ---------------------------------------------------------------------------
// Trigger 1 — two consecutive non-success outcomes on one task
// ---------------------------------------------------------------------------
test("two consecutive failures on one task block, naming the task and both attempts", () => {
  const decision = decide({ consecutiveFailures: 2, failedTaskId: "T007" });
  assert.equal(decision.allow, false);
  if (decision.allow) return;
  assert.ok(decision.reason.includes("T007"), "the blocked task is named");
  assert.match(decision.reason, /2|dos/, "both attempts are counted");
});

test("one failure does not block: a first failure is normal work", () => {
  assert.equal(decide({ consecutiveFailures: 1, failedTaskId: "T007" }).allow, true);
});

test("failure then success does not block: the streak is consecutive, not cumulative", () => {
  // The caller resets the counter on success; the gate must not carry history
  // of its own that could keep a resolved task blocked forever.
  assert.equal(decide({ consecutiveFailures: 0, failedTaskId: "T007" }).allow, true);
});

// ---------------------------------------------------------------------------
// Trigger 2 — mismatch between declared and observed files
// ---------------------------------------------------------------------------
test("3 files observed against 2 declared blocks with both counts", () => {
  const decision = decide({ declaredFiles: 2, observedFiles: 3 });
  assert.equal(decision.allow, false);
  if (decision.allow) return;
  assert.ok(decision.reason.includes("3") && decision.reason.includes("2"), decision.reason);
});

test("40 observed against 40 declared does not block: mismatch, not magnitude", () => {
  assert.equal(decide({ declaredFiles: 40, observedFiles: 40 }).allow, true);
});

test("fewer files than declared does not block: doing less than planned is not divergence upward", () => {
  assert.equal(decide({ declaredFiles: 9, observedFiles: 2 }).allow, true);
});

test("zero declared is not a mismatch: nothing was promised to diverge from", () => {
  assert.equal(decide({ declaredFiles: 0, observedFiles: 12 }).allow, true);
});

// ---------------------------------------------------------------------------
// The trigger that was specified and then removed
// ---------------------------------------------------------------------------
test("there is no user-request trigger: it was not derivable and is gone, not faked", () => {
  // `/nodd-promote` lives in another extension with no path to kernel state and
  // performs the promotion itself, so no gate could ever observe the asking.
  // Round 1 shipped it as a hardcoded `false`, which is the exact failure this
  // gate exists to refuse. It is absent from the type and from the source.
  assert.ok(!("userRequested" in noSignals), "the signal is gone from the type");
  const source = readFileSync(new URL("./promotion.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!source.includes("userRequested"), "and gone from the executable code");
});

// ---------------------------------------------------------------------------
// The two ways forward
// ---------------------------------------------------------------------------
test("a block offers exactly the promote command and the escape hatch", () => {
  const decision = decide({ declaredFiles: 2, observedFiles: 3 });
  assert.equal(decision.allow, false);
  if (decision.allow) return;
  assert.ok(decision.remedy.action.includes("/nodd-promote cache-warmup"), decision.remedy.action);
  assert.equal(decision.remedy.escapeHatch, "/nodd-allow promotion");
});

test("no trigger at all allows", () => {
  assert.equal(decide({}).allow, true);
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------
test("disabling the gate turns it off entirely, even with every trigger firing", () => {
  const policy = { ...emptyPolicy(), config: { promotion: { enabled: false } } };
  const decision = promotionGate(
    { slug: "x", consecutiveFailures: 5, failedTaskId: "npm test", declaredFiles: 1, observedFiles: 99 },
    request,
    policy,
  );
  assert.equal(decision.allow, true, "a user-owned kill switch is not advisory");
});

// ---------------------------------------------------------------------------
// The part of routing.go:68 NODD keeps
// ---------------------------------------------------------------------------
test("no promotion path reads a line count, a byte size or a risk score", () => {
  const source = readFileSync(new URL("./promotion.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

  for (const forbidden of ["lineCount", "linesChanged", "byteSize", "risk", "complexity", "estimate", "forecast"]) {
    assert.ok(!source.includes(forbidden), `promotion must not read ${forbidden}`);
  }
  assert.ok(!source.includes("countAuthoredLines"), "the delivery counter is off limits to gates");
  assert.ok(!/from "\.\.\/delivery\.ts"/.test(source), "promotion must not import delivery");
});

test("the signals type exposes no size field at all", () => {
  const signals: PromotionSignals = { ...noSignals };
  assert.deepEqual(Object.keys(signals).sort(), [
    "consecutiveFailures",
    "declaredFiles",
    "failedTaskId",
    "observedFiles",
    "slug",
  ]);
});
