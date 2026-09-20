import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, fold } from "../state.ts";
import { observation, pendingCall } from "../observations.ts";
import { emptyPolicy } from "./policy.ts";
import { classifyGate } from "./classify.ts";

const write = { toolName: "write", input: { path: "src/a.ts" } };
const noPending = new Map();

test("an undeclared write is blocked with a nodd_declare remedy", () => {
  const decision = classifyGate(emptyCommitted(), write, emptyPolicy(), noPending);
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && decision.remedy.action.includes("nodd_declare"));
  assert.ok(decision.allow === false && decision.reason.includes("classify"));
});

test("edit and mutating bash block the same way; non-mutating bash does not", () => {
  const p = emptyPolicy();
  assert.equal(classifyGate(emptyCommitted(), { toolName: "edit", input: { path: "a.ts" } }, p, noPending).allow, false);
  assert.equal(classifyGate(emptyCommitted(), { toolName: "bash", input: { command: "rm -rf x" } }, p, noPending).allow, false);
  assert.equal(classifyGate(emptyCommitted(), { toolName: "bash", input: { command: "npm test" } }, p, noPending).allow, true);
  assert.equal(classifyGate(emptyCommitted(), { toolName: "read", input: { path: "a.ts" } }, p, noPending).allow, true);
});

test("a committed declaration allows the write", () => {
  const committed = fold(emptyCommitted(), observation({
    toolCallId: "d1", toolName: "nodd_declare",
    input: { intent: "change", route: "inline", slug: "demo" },
    isError: false, resultText: "", at: "t",
  }));
  assert.equal(classifyGate(committed, write, emptyPolicy(), noPending).allow, true);
});

// extensions.md:757-758 — siblings are preflighted sequentially and executed
// concurrently, so a declaration in the same batch has not happened yet.
test("a declaration seen only in pending does not unblock, and the reason cites the batch rule", () => {
  const pending = new Map([["d1", pendingCall({
    toolCallId: "d1", toolName: "nodd_declare",
    input: { intent: "change", route: "tracked", slug: "demo" },
  })]]);

  const decision = classifyGate(emptyCommitted(), write, emptyPolicy(), pending);
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && /same (assistant )?(message|batch)/i.test(decision.reason),
    `the reason must cite the batch rule: ${decision.allow === false ? decision.reason : ""}`);
  assert.ok(decision.allow === false && /next turn|reissue/i.test(decision.reason),
    "the reason must say how to resolve it");
});

test("the refusal offers a remedy reachable without nodd_declare or a slash command, for a subagent that has neither", () => {
  const decision = classifyGate(emptyCommitted(), write, emptyPolicy(), noPending);
  assert.equal(decision.allow, false);
  assert.ok(
    decision.allow === false && /nodd_declare/.test(decision.remedy.action),
    "the existing nodd_declare remedy must remain, since it is correct for a parent session",
  );
  assert.ok(
    decision.allow === false && /report (this|the refusal) (back )?to (whoever|the (caller|delegator|parent))/i.test(decision.remedy.action),
    `remedy must also offer a path reachable without any tool: ${decision.allow === false ? decision.remedy.action : ""}`,
  );
});

test("the flag off allows the undeclared write", () => {
  const policy = { ...emptyPolicy(), config: { classify: { enabled: false } } };
  assert.equal(classifyGate(emptyCommitted(), write, policy, noPending).allow, true);
});
