import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, foldAll, type Committed } from "../state.ts";
import { observation, pendingCall, type Observation } from "../observations.ts";
import { THRESHOLDS } from "../manifest.ts";
import { emptyPolicy } from "./policy.ts";
import { delegateGate } from "./delegate.ts";

let n = 0;
function obs(toolName: string, input: Record<string, unknown>, isError = false): Observation {
  return observation({ toolCallId: `c${++n}`, toolName, input, isError, resultText: "", at: "t" });
}

function reads(count: number): Committed {
  n = 0;
  return foldAll(emptyCommitted(), Array.from({ length: count }, (_, i) => obs("read", { path: `f${i}.ts` })));
}

const write = { toolName: "write", input: { path: "out.ts" } };
const noPending = new Map();

test("4 distinct reads with no delegation blocks, quoting count and threshold", () => {
  const decision = delegateGate(reads(4), write, emptyPolicy(), noPending);
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && decision.reason.includes("4"));
  assert.ok(decision.allow === false && decision.reason.includes(String(THRESHOLDS.mappingMinUnderstandingFiles)));
  assert.ok(decision.allow === false && decision.remedy.action.toLowerCase().includes("delegat"));
});

test("the mapping boundary is asserted at both 3 and 4", () => {
  assert.equal(delegateGate(reads(3), write, emptyPolicy(), noPending).allow, true, "3 files stays inline");
  assert.equal(delegateGate(reads(4), write, emptyPolicy(), noPending).allow, false, "4 files must delegate");
});

test("one file read six times does not trip the mapping trigger", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), Array.from({ length: 6 }, () => obs("read", { path: "same.ts" })));
  assert.equal(delegateGate(committed, write, emptyPolicy(), noPending).allow, true);
});

test("a committed subagent result clears the block", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), [
    ...Array.from({ length: 5 }, (_, i) => obs("read", { path: `f${i}.ts` })),
    obs("subagent", { agent: "nodd-explore" }),
  ]);
  assert.equal(delegateGate(committed, write, emptyPolicy(), noPending).allow, true);
});

test("the writer trigger fires at 2 distinct written files", () => {
  n = 0;
  const one = foldAll(emptyCommitted(), [obs("write", { path: "a.ts" })]);
  assert.equal(delegateGate(one, { toolName: "write", input: { path: "a.ts" } }, emptyPolicy(), noPending).allow, true,
    "rewriting the same file is still one file");
  assert.equal(delegateGate(one, { toolName: "write", input: { path: "b.ts" } }, emptyPolicy(), noPending).allow, false,
    "a second distinct file crosses the writer threshold");
});

// Intent is known at preflight, so counting a sibling's write *intent* is
// sound. Counting a sibling's *result* would not be, and is never done.
test("same-batch pending write intent counts toward the writer trigger", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), [obs("write", { path: "a.ts" })]);
  const pending = new Map([["p1", pendingCall({ toolCallId: "p1", toolName: "write", input: { path: "b.ts" } })]]);
  assert.equal(delegateGate(committed, { toolName: "write", input: { path: "c.ts" } }, emptyPolicy(), pending).allow, false);
});

// routing.go:70 — tests, builds, installs and review actors may use fresh
// workers without changing the route. They are not writer files, so they never
// reach the mapping or writer trigger. The long-session backstop is a separate
// clause (routing.go:82) and it counts every tool call, these included — see
// the test below it.
test("test, build and install commands never trip the mapping or writer trigger", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), [
    obs("bash", { command: "npm test" }),
    obs("bash", { command: "npm run build" }),
    obs("bash", { command: "npm install" }),
    obs("bash", { command: "git status" }),
  ]);
  assert.equal(delegateGate(committed, write, emptyPolicy(), noPending).allow, true);
});

// The claim "test/build/install never trip it" was covered by four commands,
// which is under the backstop threshold, so the case that contradicts it was
// never exercised. Run the declared runner past the threshold and the backstop
// does fire — as ODD specifies. That is the behaviour; the requirement text now
// says so.
test("repeated runs of the declared runner do reach the long-session backstop", () => {
  n = 0;
  const committed = foldAll(
    emptyCommitted(),
    Array.from({ length: 25 }, () => obs("bash", { command: "npm test" })),
  );
  const decision = delegateGate(committed, write, emptyPolicy(), noPending);
  assert.equal(decision.allow, false, "25 tool calls without delegating must reach the backstop");
});

test("the long-session backstop fires at 20 tool calls with no delegation", () => {
  n = 0;
  const under = foldAll(emptyCommitted(), Array.from({ length: 19 }, () => obs("bash", { command: "git status" })));
  assert.equal(under.toolCalls, 19);
  assert.equal(delegateGate(under, write, emptyPolicy(), noPending).allow, true);

  const at = foldAll(under, [obs("bash", { command: "git log" })]);
  assert.equal(at.toolCalls, THRESHOLDS.longSessionToolCalls);
  const decision = delegateGate(at, write, emptyPolicy(), noPending);
  assert.equal(decision.allow, false);
  assert.ok(decision.allow === false && decision.reason.includes("20"));
});

test("the flag off allows everything", () => {
  const policy = { ...emptyPolicy(), config: { delegate: { enabled: false } } };
  assert.equal(delegateGate(reads(40), write, policy, noPending).allow, true);
});

test("the gate only speaks on writes, not on reads", () => {
  assert.equal(delegateGate(reads(10), { toolName: "read", input: { path: "z.ts" } }, emptyPolicy(), noPending).allow, true);
});
