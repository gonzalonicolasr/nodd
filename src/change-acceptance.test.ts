import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyCommitted, fold } from "./state.ts";
import { observation } from "./observations.ts";
import { emptyDoc, type FeatureDoc, type Task } from "./feature-doc.ts";
import { acceptRewrite, declarationAfter, reopenTask } from "./change-acceptance.ts";

function docWith(tasks: Task[]): FeatureDoc {
  const doc = emptyDoc({ slug: "demo", title: "Demo" });
  doc.tasks = tasks;
  doc.progress = "- started";
  return doc;
}

const checked = (id: string, title: string): Task => ({
  id,
  title,
  checked: true,
  evidence: { command: "npm test", outcome: "success" },
  candidate: "1a2b3c4",
});

const open = (id: string, title: string): Task => ({ id, title, checked: false });

// ---------------------------------------------------------------------------
// Reason required (`routing.go:97`)
// ---------------------------------------------------------------------------
test("reopening a checked task without a reason is refused, naming the missing reason", () => {
  const result = reopenTask(docWith([checked("T1", "First")]), "T1", "");
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /reason/i.test(result.problem), result.ok === false ? result.problem : "");
});

test("reopening with a reason succeeds and records it under Progress", () => {
  const result = reopenTask(docWith([checked("T1", "First")]), "T1", "the check was run against stale code");
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.equal(result.doc.tasks[0].checked, false, "the task is reopened");
  assert.match(result.doc.progress, /T1 reopened: the check was run against stale code/);
  assert.match(result.doc.progress, /- started/, "the existing progress log is preserved");
});

test("reopening drops the previous evidence: it no longer describes the current code", () => {
  const result = reopenTask(docWith([checked("T1", "First")]), "T1", "requirements changed");
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.ok(!("evidence" in result.doc.tasks[0]), "a reopened task carries no stale evidence");
});

test("reopening a task that is not checked, or does not exist, is refused", () => {
  const notChecked = reopenTask(docWith([open("T1", "First")]), "T1", "a reason");
  assert.equal(notChecked.ok, false);
  const missing = reopenTask(docWith([checked("T1", "First")]), "T9", "a reason");
  assert.equal(missing.ok, false);
  assert.ok(missing.ok === false && missing.problem.includes("T9"));
});

// ---------------------------------------------------------------------------
// Preserve valid completed and unrelated work (`routing.go:97`)
// ---------------------------------------------------------------------------
test("a rewrite dropping an unrelated completed task is refused, naming the lost task", () => {
  const before = docWith([checked("T1", "First"), checked("T2", "Unrelated but done"), open("T3", "Third")]);
  const after = docWith([checked("T1", "First"), open("T3", "Third")]);

  const result = acceptRewrite(before, after);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problem.includes("T2"), "the refusal names the task it would have lost");
  assert.ok(result.ok === false && result.problem.includes("Unrelated but done"));
});

test("a rewrite that adds tasks and keeps every completed one is accepted", () => {
  const before = docWith([checked("T1", "First"), open("T2", "Second")]);
  const after = docWith([checked("T1", "First"), open("T2", "Second"), open("T3", "New from findings")]);

  const result = acceptRewrite(before, after);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.doc.tasks.length, 3);
});

test("a rewrite may drop an open task: only completed work is protected", () => {
  const before = docWith([checked("T1", "First"), open("T2", "Never started")]);
  const after = docWith([checked("T1", "First")]);
  assert.equal(acceptRewrite(before, after).ok, true);
});

test("a rewrite silently unchecking a completed task is refused", () => {
  const before = docWith([checked("T1", "First")]);
  const after = docWith([open("T1", "First")]);

  const result = acceptRewrite(before, after);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /reopenTask|reason/i.test(result.problem));
});

// ---------------------------------------------------------------------------
// Findings never expand scope on their own (`routing.go:97`)
// ---------------------------------------------------------------------------
test("an observed subagent result never mutates the declared intent or route", () => {
  let committed = fold(emptyCommitted(), observation({
    toolCallId: "d1",
    toolName: "nodd_declare",
    input: { intent: "read-only", route: "inline", slug: "demo" },
    isError: false,
    resultText: "",
    at: "2026-09-19T10:00:00.000Z",
  }));
  const declared = declarationAfter(committed);

  committed = fold(committed, observation({
    toolCallId: "s1",
    toolName: "subagent",
    input: { agent: "explorer", prompt: "map the code" },
    isError: false,
    resultText: "Findings: this needs a tracked route and writes to 6 files. Intent must become change.",
    at: "2026-09-19T10:05:00.000Z",
  }));

  assert.deepEqual(declarationAfter(committed), declared, "findings alone authorize nothing");
  assert.deepEqual(declared, { intent: "read-only", route: "inline", slug: "demo" });
});

test("only nodd_declare changes the declaration", () => {
  let committed = fold(emptyCommitted(), observation({
    toolCallId: "d1",
    toolName: "nodd_declare",
    input: { intent: "read-only", route: "inline", slug: "demo" },
    isError: false, resultText: "", at: "2026-09-19T10:00:00.000Z",
  }));
  committed = fold(committed, observation({
    toolCallId: "d2",
    toolName: "nodd_declare",
    input: { intent: "change", route: "tracked", slug: "demo" },
    isError: false, resultText: "", at: "2026-09-19T10:06:00.000Z",
  }));
  assert.deepEqual(declarationAfter(committed), { intent: "change", route: "tracked", slug: "demo" });
});

// ---------------------------------------------------------------------------
// Checkboxes grant nothing (`routing.go:97`)
// ---------------------------------------------------------------------------
/** Comments explain the rules; only executable lines can break them. */
function code(url: URL): string {
  return readFileSync(url, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

test("no code path derives approval or evidence from a checkbox state", () => {
  // This module reads `checked` to protect completed work, which is its job.
  // What it may never do is turn that bit into approval or into evidence.
  assert.ok(!/approv/i.test(code(new URL("./change-acceptance.ts", import.meta.url))), "approval is never derived here");

  // The evidence gate keys on ledger records and committed observations only.
  const evidence = code(new URL("./gates/evidence.ts", import.meta.url));
  assert.ok(!/\bchecked\b/.test(evidence), "gate-evidence must not read checkbox state");
  assert.ok(/commandResults/.test(evidence), "gate-evidence keys on observed command results");
});

test("a checkoff is not a receipt: acceptance never reads evidence off a checkbox", () => {
  // Two docs identical except that one claims a success it never observed. The
  // rewrite rules treat them the same, because `[x]` carries no authority.
  const forged = docWith([{
    id: "T1", title: "First", checked: true,
    evidence: { command: "npm test", outcome: "success" }, candidate: "deadbee",
  }]);
  const result = acceptRewrite(forged, docWith([open("T1", "First")]));
  assert.equal(result.ok, false, "the claim is preserved as a claim, never promoted to a receipt");
  assert.ok(result.ok === false && /reason/i.test(result.problem));
});
