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
  // Asserting only `allow === false` let a combined mutation -- backstop off,
  // writer threshold at 1 -- keep this green through the wrong trigger. The
  // row is about the backstop, so the reason has to name it.
  assert.match(
    "reason" in decision ? decision.reason : "",
    /25 tool calls/,
    "the refusal must come from the backstop, not from another trigger firing by accident",
  );
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

// The self-amplifying lockout, observed live in this run: three refused
// writes to distinct paths, zero files ever landed on disk, and the writer
// trigger still reported "written 3 distinct files" and refused every
// further write forever -- a monotonic trap with no delegation able to clear
// it, because delegation itself is a `subagent` call and would have been
// refused too. This is the end-to-end shape a unit test of `fold` cannot
// show: it exercises `delegateGate` against state built the same way the
// kernel builds it, from raw observations.
test("refused writes do not advance the writer trigger -- the auto-amplifying lockout is closed", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), [
    obs("write", { path: "/tmp/jamas-existio-1.txt" }, true),
    obs("write", { path: "/tmp/jamas-existio-2.txt" }, true),
    obs("write", { path: "/tmp/jamas-existio-3.txt" }, true),
  ]);
  assert.equal(committed.filesWritten.size, 0, "none of the three refusals wrote a file");
  const decision = delegateGate(committed, write, emptyPolicy(), noPending);
  assert.equal(decision.allow, true, "a session with only refused writes must still be able to write");
});

test("refused writes followed by one real write leave the counter at 1, not 4", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), [
    obs("write", { path: "/tmp/jamas-existio-1.txt" }, true),
    obs("write", { path: "/tmp/jamas-existio-2.txt" }, true),
    obs("write", { path: "/tmp/jamas-existio-3.txt" }, true),
    obs("write", { path: "real.ts" }, false),
  ]);
  assert.equal(committed.filesWritten.size, 1, "only the real write counts");
  // A second distinct real write should still cross the threshold normally --
  // the fix must not have also broken the trigger for genuine writes.
  const decision = delegateGate(committed, { toolName: "write", input: { path: "other-real.ts" } }, emptyPolicy(), noPending);
  assert.equal(decision.allow, false, "two genuine distinct writes still trip the writer trigger");
});

// ---------------------------------------------------------------------------
// D4's reachability invariant, applied to this gate (T011).
//
// `nodd-implement` is a real generated agent whose frontmatter grants
// `read, grep, ls, write, edit, bash` — no `subagent`, no `nodd_declare`, and
// no slash commands. Both halves of the old remedy were therefore unreachable
// by the very actor this gate most often refuses: a writer, mid-write.
// ---------------------------------------------------------------------------
test("the remedy is reachable by a writer that cannot delegate or declare", () => {
  const committed = foldAll(emptyCommitted(), [
    obs("write", { path: "a.ts" }, false),
    obs("write", { path: "b.ts" }, false),
  ]);
  const decision = delegateGate(committed, { toolName: "write", input: { path: "c.ts" } }, emptyPolicy(), noPending);

  assert.equal(decision.allow, false);
  assert.ok(
    decision.allow === false && /report|delegator/i.test(decision.remedy.action),
    `a refusal whose every remedy needs a tool the actor lacks is a deadlock; got: ${decision.allow === false ? decision.remedy.action : ""}`,
  );
});

test("re-declaring the same feature does not reset the writer count", () => {
  // Scoping the count to the current declaration (so a new feature does not
  // inherit the previous one's total) handed the blocked actor a one-call
  // escape: declare the same slug again and the files it just wrote fall
  // before the new boundary. The threshold then never fires, no matter how
  // many files the task writes.
  //
  // A declaration that names a *different* feature is a real boundary. One
  // that repeats the current slug is the same task continuing.
  n = 0;
  const declare = () => obs("nodd_declare", { intent: "change", route: "inline", slug: "f" });
  const committed = foldAll(emptyCommitted(), [
    declare(),
    obs("write", { path: "a.ts" }),
    obs("write", { path: "b.ts" }),
  ]);
  assert.equal(delegateGate(committed, write, emptyPolicy(), noPending).allow, false,
    "two written files must trip the writer threshold");

  const afterRedeclaring = foldAll(committed, [declare()]);
  assert.equal(delegateGate(afterRedeclaring, write, emptyPolicy(), noPending).allow, false,
    "re-declaring the same slug must not clear what this task already wrote");
});

test("declaring a different feature does start a fresh count", () => {
  n = 0;
  const committed = foldAll(emptyCommitted(), [
    obs("nodd_declare", { intent: "change", route: "inline", slug: "first" }),
    obs("write", { path: "a.ts" }),
    obs("write", { path: "b.ts" }),
    obs("nodd_declare", { intent: "change", route: "inline", slug: "second" }),
  ]);
  assert.equal(delegateGate(committed, write, emptyPolicy(), noPending).allow, true,
    "a new feature must not inherit the previous one's file count");
});
