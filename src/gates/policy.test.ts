import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_IDS } from "./registry.ts";
import {
  allow,
  consumeHatch,
  firstRefusal,
  grantHatch,
  refuse,
  resolveFlag,
  type Policy,
} from "./policy.ts";

function policy(over: Partial<Policy> = {}): Policy {
  return { config: {}, flags: {}, hatches: {}, ...over };
}

test("every gate id has a default flag entry and defaults to on", () => {
  for (const id of GATE_IDS) {
    const resolved = resolveFlag(id, policy());
    assert.equal(resolved.enabled, true, `${id} must default to enabled`);
    assert.equal(resolved.source, "default", `${id} with nothing chosen must report source default`);
  }
});

test("precedence is flag > config > default, and the source is retained", () => {
  assert.deepEqual(resolveFlag("track", policy()), { enabled: true, source: "default" });
  assert.deepEqual(
    resolveFlag("track", policy({ config: { track: { enabled: false } } })),
    { enabled: false, source: "config" },
  );
  assert.deepEqual(
    resolveFlag("track", policy({ config: { track: { enabled: true } }, flags: { track: false } })),
    { enabled: false, source: "flag" },
  );
  assert.deepEqual(
    resolveFlag("track", policy({ flags: { all: false } })),
    { enabled: false, source: "flag" },
  );
});

test("a refusal carries a remedy with a concrete action and the escape hatch", () => {
  const decision = refuse("track", "no feature doc at .nodd/x/feature.md", "call nodd_declare");
  assert.equal(decision.allow, false);
  assert.equal(decision.gate, "track");
  assert.equal(decision.remedy.action, "call nodd_declare");
  assert.equal(decision.remedy.escapeHatch, "/nodd-allow track");
});

test("every gate's refusal renders gate id, observation and both remedies", () => {
  for (const id of GATE_IDS) {
    const decision = refuse(id, `observed something for ${id}`, `do the ${id} thing`);
    assert.equal(decision.allow, false);
    assert.ok(decision.reason.includes(id), `${id}: reason names the gate`);
    assert.ok(decision.reason.includes("observed something"), `${id}: reason names the observation`);
    assert.ok(decision.reason.includes(`do the ${id} thing`), `${id}: reason names the action`);
    assert.ok(decision.reason.includes(`/nodd-allow ${id}`), `${id}: reason names the escape hatch`);
  }
});

test("the first refusal wins, so a call never gets two messages", () => {
  const decisions = [allow(), refuse("classify", "a", "b"), refuse("track", "c", "d")];
  const winner = firstRefusal(decisions);
  assert.equal(winner?.gate, "classify");
  assert.equal(firstRefusal([allow(), allow()]), null);
});

test("an escape hatch is one-shot and never crosses gates", () => {
  let p = grantHatch(policy(), "track", "I know what I am doing");
  assert.equal(consumeHatch(p, "classify"), null, "an override for track must not clear classify");

  const consumed = consumeHatch(p, "track");
  assert.ok(consumed);
  assert.equal(consumed.reason, "I know what I am doing");
  p = consumed.policy;
  assert.equal(consumeHatch(p, "track"), null, "the override is consumed, so the next refusal blocks");
});
