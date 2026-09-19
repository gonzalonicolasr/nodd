import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_IDS } from "../src/gates/registry.ts";
import { consumeHatch, emptyPolicy, refuse } from "../src/gates/policy.ts";
import { runAllowCommand } from "./nodd-allow.ts";

function session() {
  const entries: Array<{ type: string; data: any }> = [];
  return {
    entries,
    policy: emptyPolicy(),
    appendEntry(type: string, data: unknown) { entries.push({ type, data: data as any }); },
  };
}

/** A gate that always refuses, wrapped so a granted hatch can clear it once. */
function attempt(policy: ReturnType<typeof emptyPolicy>, gate: (typeof GATE_IDS)[number]) {
  const consumed = consumeHatch(policy, gate);
  if (consumed) return { blocked: false, policy: consumed.policy };
  refuse(gate, "observed", "do the thing");
  return { blocked: true, policy };
}

test("after /nodd-allow track the next track refusal passes and the one after blocks", () => {
  const s = session();
  const granted = runAllowCommand("track I know what I am doing", s.policy, s);
  assert.equal(granted.ok, true);

  const first = attempt(granted.policy, "track");
  assert.equal(first.blocked, false, "the override clears the next refusal");

  const second = attempt(first.policy, "track");
  assert.equal(second.blocked, true, "the override was one-shot");
});

test("an override for one gate does not affect another", () => {
  const s = session();
  const granted = runAllowCommand("track", s.policy, s);
  assert.equal(attempt(granted.policy, "classify").blocked, true, "classify is untouched");
  assert.equal(attempt(granted.policy, "track").blocked, false);
});

test("one audit entry is appended with gate, timestamp and reason", () => {
  const s = session();
  runAllowCommand("delegate the count is wrong here", s.policy, s, () => "2026-09-19T10:00:00.000Z");
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].type, "nodd:allow");
  assert.deepEqual(s.entries[0].data, {
    gate: "delegate",
    reason: "the count is wrong here",
    at: "2026-09-19T10:00:00.000Z",
  });
});

test("a reason is optional and recorded as empty, never invented", () => {
  const s = session();
  runAllowCommand("track", s.policy, s, () => "t");
  assert.equal(s.entries[0].data.reason, "");
});

test("an unknown gate id lists the valid ids and grants nothing", () => {
  const s = session();
  const result = runAllowCommand("nonsense", s.policy, s);
  assert.equal(result.ok, false);
  for (const id of GATE_IDS) assert.ok(result.text.includes(id), `must list ${id}`);
  assert.deepEqual(result.policy.hatches, {}, "nothing was granted");
  assert.deepEqual(s.entries, [], "a rejected request is not audited as a grant");
});

test("an empty invocation explains itself instead of granting silently", () => {
  const s = session();
  const result = runAllowCommand("", s.policy, s);
  assert.equal(result.ok, false);
  assert.deepEqual(result.policy.hatches, {});
});
