import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksOnFirstWrite } from "./agent-capability.ts";

/**
 * The toolsets below are the real ones, read from `~/.pi/agent/agents/` while
 * this run was blocked by the very defect they describe. Four delegated agents
 * carry `write` and `edit` and cannot declare a route, so `gate-classify`
 * refuses their first change and the only remedy they can reach is a
 * round-trip to whoever delegated the work.
 */
test("an agent that can write but cannot declare is blocked on its first change", () => {
  // The four `zero-*` agents that carry write: analyze, build, clarify, plan.
  assert.equal(blocksOnFirstWrite(["read", "bash", "write", "edit"]), true);
});

test("an agent that can declare its own route is not blocked", () => {
  assert.equal(
    blocksOnFirstWrite(["read", "grep", "ls", "write", "edit", "bash", "nodd_declare"]),
    false,
    "nodd-implement carries nodd_declare, so it clears gate-classify itself",
  );
});

test("an agent that cannot write is not blocked, declare or not", () => {
  // `zero-explore` and `zero-veredicto`: no write, no edit. They never reach
  // the gate, so reporting them as blockable would be a false alarm.
  assert.equal(blocksOnFirstWrite(["read", "bash"]), false);
  assert.equal(blocksOnFirstWrite(["read", "grep", "ls", "bash", "nodd_declare"]), false);
});

test("an empty toolset is not blocked", () => {
  assert.equal(blocksOnFirstWrite([]), false);
});

test("edit alone is enough to be blocked, without write", () => {
  // The predicate must not key on `write` alone: `gate-classify` refuses any
  // first change, and an edit is a change.
  assert.equal(blocksOnFirstWrite(["read", "edit"]), true);
});
