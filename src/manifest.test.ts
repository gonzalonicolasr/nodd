import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_STEPS,
  CONFIGURABLE_SLOTS,
  MECHANISM_STEPS,
  THRESHOLDS,
} from "./manifest.ts";

// Values carried from gentle's capabilitymanifest/manifest.go:203-216 plus the
// 20-tool-call backstop, which is prose in routing.go:82. A silent edit must
// fail here.
test("thresholds carry gentle's exact values", () => {
  assert.equal(THRESHOLDS.minUnderstandingFiles, 1);
  assert.equal(THRESHOLDS.maxUnderstandingFiles, 3);
  assert.equal(THRESHOLDS.maxMechanicalWriteFiles, 1);
  assert.equal(THRESHOLDS.mappingMinUnderstandingFiles, 4);
  assert.equal(THRESHOLDS.writerMinNonTrivialFiles, 2);
  assert.equal(THRESHOLDS.longSessionToolCalls, 20);
});

test("the canonical step list is the seven ODD steps in order", () => {
  assert.deepEqual(CANONICAL_STEPS, [
    "authorize",
    "explore",
    "resolve-uncertainty",
    "classify",
    "track",
    "implement",
    "close",
  ]);
  assert.ok(Object.isFrozen(CANONICAL_STEPS));
});

test("the four mechanism steps are absent from the configurable slot set", () => {
  assert.deepEqual([...MECHANISM_STEPS], ["authorize", "classify", "track", "close"]);
  for (const step of MECHANISM_STEPS) {
    assert.ok(!CONFIGURABLE_SLOTS.includes(step as never), `${step} must not be configurable`);
  }
  assert.deepEqual(CONFIGURABLE_SLOTS, [
    "default",
    "orchestrator",
    "explore",
    "resolve-uncertainty",
    "implement",
  ]);
});

test("every mechanism step is still displayed", () => {
  for (const step of MECHANISM_STEPS) {
    assert.ok(CANONICAL_STEPS.includes(step), `${step} must stay visible in the protocol`);
  }
});
