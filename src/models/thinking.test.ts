import { test } from "node:test";
import assert from "node:assert/strict";
import { THINKING_LEVELS, isThinkingLevel } from "./thinking.ts";

test("the six real pi effort levels are listed in ascending order", () => {
  assert.deepEqual([...THINKING_LEVELS], ["off", "minimal", "low", "medium", "high", "xhigh"]);
});

test("only a real level is a level: no max, no ultracode, no casing games", () => {
  for (const level of THINKING_LEVELS) assert.equal(isThinkingLevel(level), true);
  for (const bad of ["max", "ultracode", "HIGH", "", "extreme", 3, null, undefined, {}]) {
    assert.equal(isThinkingLevel(bad), false, `${JSON.stringify(bad)} is not a pi effort level`);
  }
});
