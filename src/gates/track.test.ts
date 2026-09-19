import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, fold, type Committed } from "../state.ts";
import { observation } from "../observations.ts";
import { emptyPolicy } from "./policy.ts";
import { trackGate } from "./track.ts";

function routed(route: "inline" | "tracked" | "forge", slug = "demo"): Committed {
  return fold(emptyCommitted(), observation({
    toolCallId: "d1", toolName: "nodd_declare",
    input: { intent: "change", route, slug },
    isError: false, resultText: "", at: "t",
  }));
}

const write = { toolName: "write", input: { path: "src/a.ts" } };
const absent = () => false;
const present = () => true;

test("a missing feature doc blocks the first write, naming the exact path", () => {
  const decision = trackGate(routed("tracked"), write, emptyPolicy(), absent);
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && decision.reason.includes(".nodd/demo/feature.md"));
  assert.ok(decision.allow === false && decision.remedy.action.includes("nodd_declare"));
  assert.ok(decision.allow === false && decision.remedy.escapeHatch === "/nodd-allow track");
});

test("a present feature doc allows the write", () => {
  assert.equal(trackGate(routed("tracked"), write, emptyPolicy(), present).allow, true);
});

test("route forge is tracked too", () => {
  assert.equal(trackGate(routed("forge"), write, emptyPolicy(), absent).allow, false);
});

// routing.go:94 — small, understood work creates no durable task artifacts.
test("route inline never blocks", () => {
  assert.equal(trackGate(routed("inline"), write, emptyPolicy(), absent).allow, true);
  assert.equal(trackGate(routed("inline"), { toolName: "bash", input: { command: "echo x > f" } }, emptyPolicy(), absent).allow, true);
});

test("mutating bash blocks while a test command does not", () => {
  const state = routed("tracked");
  assert.equal(trackGate(state, { toolName: "bash", input: { command: "echo x > f" } }, emptyPolicy(), absent).allow, false);
  assert.equal(trackGate(state, { toolName: "bash", input: { command: "npm test" } }, emptyPolicy(), absent).allow, true);
});

// A doc the model can rewrite is a doc the model can forge, and then evidence
// is prose again. This holds even when the doc exists and the route is inline.
test("a direct write to .nodd/** is always blocked, pointing at nodd_task", () => {
  for (const state of [routed("tracked"), routed("inline"), emptyCommitted()]) {
    for (const path of [".nodd/x/feature.md", ".nodd/demo/state.json", "/repo/.nodd/demo/feature.md"]) {
      const decision = trackGate(state, { toolName: "write", input: { path } }, emptyPolicy(), present);
      assert.equal(decision.allow, false, `${path} must be blocked`);
      assert.ok(decision.allow === false && decision.remedy.action.includes("nodd_task"));
    }
  }
  const edit = trackGate(routed("tracked"), { toolName: "edit", input: { path: ".nodd/demo/feature.md" } }, emptyPolicy(), present);
  assert.equal(edit.allow, false);
});

// design.md says `.nodd/**` writes are "always blocked", but REQ: gate-framework
// says flag semantics obey the kill switch "without exception", and
// REQ: gate-kill-switch-semantics 3 says obey immediately without working
// around it. The explicit "without exception" wins: a gate the user turned off
// is off, including its doc-integrity half. Turning `track` off is the
// documented way to hand-edit a feature doc.
test("the flag off disables the whole gate, doc protection included", () => {
  const policy = { ...emptyPolicy(), config: { track: { enabled: false } } };
  assert.equal(trackGate(routed("tracked"), write, policy, absent).allow, true);
  assert.equal(
    trackGate(routed("tracked"), { toolName: "write", input: { path: ".nodd/demo/feature.md" } }, policy, present).allow,
    true,
    "a disabled gate does not keep enforcing half of itself",
  );
});

test("an undeclared session does not block here — that is gate-classify's job", () => {
  assert.equal(trackGate(emptyCommitted(), write, emptyPolicy(), absent).allow, true);
});
