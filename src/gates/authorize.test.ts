import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyCommitted, fold, type Committed } from "../state.ts";
import { observation } from "../observations.ts";
import { emptyPolicy } from "./policy.ts";
import { authorizeGate } from "./authorize.ts";

function declared(intent: "read-only" | "change"): Committed {
  return fold(emptyCommitted(), observation({
    toolCallId: "d1", toolName: "nodd_declare",
    input: { intent, route: "inline", slug: "demo" },
    isError: false, resultText: "", at: "t",
  }));
}

const write = { toolName: "write", input: { path: "src/a.ts" } };

test("read-only blocks a write and the reason names the declaration", () => {
  const decision = authorizeGate(declared("read-only"), write, emptyPolicy());
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && decision.reason.includes("read-only"));
  assert.ok(decision.allow === false && decision.remedy.escapeHatch === "/nodd-allow authorize");
});

test("read-only blocks edit, mutating bash and the subagent writer", () => {
  const state = declared("read-only");
  for (const request of [
    { toolName: "edit", input: { path: "a.ts" } },
    { toolName: "bash", input: { command: "echo x > f" } },
    { toolName: "subagent", input: { agent: "nodd-implement", prompt: "write the thing" } },
  ]) {
    assert.equal(authorizeGate(state, request, emptyPolicy()).allow, false, `${request.toolName} must block`);
  }
});

test("read-only allows reading, searching and non-mutating bash", () => {
  const state = declared("read-only");
  for (const request of [
    { toolName: "read", input: { path: "a.ts" } },
    { toolName: "grep", input: { pattern: "x" } },
    { toolName: "ls", input: { path: "." } },
    { toolName: "bash", input: { command: "npm test" } },
    { toolName: "bash", input: { command: "git status" } },
  ]) {
    assert.equal(authorizeGate(state, request, emptyPolicy()).allow, true, `${JSON.stringify(request.input)} must pass`);
  }
});

test("intent: change allows the write", () => {
  assert.equal(authorizeGate(declared("change"), write, emptyPolicy()).allow, true);
});

// The two gates are disjoint on purpose: `classify` owns the undeclared case,
// so a single call never collects two messages about the same missing thing.
test("an undeclared state returns allow — that is gate-classify's job", () => {
  assert.equal(authorizeGate(emptyCommitted(), write, emptyPolicy()).allow, true);
});

test("the flag off allows the read-only write", () => {
  const policy = { ...emptyPolicy(), config: { authorize: { enabled: false } } };
  assert.equal(authorizeGate(declared("read-only"), write, policy).allow, true);
});

// ---------------------------------------------------------------------------
// T006 -- read-only may delegate to a read-only worker
// ---------------------------------------------------------------------------
test("read-only may delegate to a target whose capability lookup says read-only", () => {
  const state = declared("read-only");
  const request = { toolName: "subagent", input: { agent: "mapper" } };
  const decision = authorizeGate(state, request, emptyPolicy(), () => true);
  assert.equal(decision.allow, true);
});

test("read-only refuses delegating to a target whose capability lookup says writer", () => {
  const state = declared("read-only");
  const request = { toolName: "subagent", input: { agent: "writer" } };
  const decision = authorizeGate(state, request, emptyPolicy(), () => false);
  assert.equal(decision.allow, false);
});

test("read-only refuses delegating to a target whose capability cannot be determined", () => {
  const state = declared("read-only");
  const request = { toolName: "subagent", input: { agent: "mystery" } };
  const decision = authorizeGate(state, request, emptyPolicy(), () => null);
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && /could not be determined/.test(decision.reason));
});

test("with no capability lookup injected, delegation defaults to refused (fail closed)", () => {
  const state = declared("read-only");
  const request = { toolName: "subagent", input: { agent: "mapper" } };
  assert.equal(authorizeGate(state, request, emptyPolicy()).allow, false);
});

test("write, edit and mutating bash still refuse under read-only regardless of any lookup", () => {
  const state = declared("read-only");
  const lookup = () => true;
  for (const request of [
    { toolName: "write", input: { path: "a.ts" } },
    { toolName: "edit", input: { path: "a.ts" } },
    { toolName: "bash", input: { command: "echo x > f" } },
  ]) {
    assert.equal(authorizeGate(state, request, emptyPolicy(), lookup).allow, false, `${request.toolName} must still refuse`);
  }
});

test("no literal NODD agent name appears in authorize.ts", () => {
  const src = readFileSync(new URL("./authorize.ts", import.meta.url), "utf8");
  for (const name of ["nodd-explore", "nodd-implement", "nodd-resolve-uncertainty"]) {
    assert.ok(!src.includes(name), `authorize.ts must not name ${name}`);
  }
});
