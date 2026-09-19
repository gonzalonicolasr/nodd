import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, parseFeatureDoc, renderFeatureDoc, renderOutcome, type FeatureDoc } from "./feature-doc.ts";

function docWithTasks(n: number): FeatureDoc {
  const doc = emptyDoc({ slug: "demo", title: "Demo feature" });
  doc.objective = "Make the thing work.";
  doc.problem = "The thing does not work.";
  doc.scope = "- src/thing.ts";
  doc.constraints = "- no new dependencies";
  doc.route = { intent: "change", route: "tracked" };
  doc.verification = { runner: "npm test", tdd: "off", source: "nodd_declare", files: ["src/thing.ts"] };
  doc.progress = "- started";
  for (let i = 1; i <= n; i++) {
    doc.tasks.push(
      i === 2
        ? {
            id: `T${i}`,
            title: `Task ${i}`,
            checked: true,
            evidence: { command: "npm test", outcome: "success" },
            candidate: "1a2b3c4",
          }
        : { id: `T${i}`, title: `Task ${i}`, checked: false },
    );
  }
  return doc;
}

for (const n of [0, 1, 3]) {
  test(`parse(render(doc)) round-trips with ${n} tasks`, () => {
    const doc = docWithTasks(n);
    const parsed = parseFeatureDoc(renderFeatureDoc(doc));
    assert.deepEqual(parsed.defects, []);
    assert.deepEqual(parsed.doc, doc);
  });
}

test("rendering is deterministic to the byte", () => {
  const doc = docWithTasks(3);
  assert.equal(renderFeatureDoc(doc), renderFeatureDoc(doc));
});

test("a checked task renders its observed evidence inline", () => {
  const rendered = renderFeatureDoc(docWithTasks(3));
  assert.match(rendered, /- \[x\] T2\. Task 2\n {2}- observed: `npm test` → success/);
  assert.match(rendered, /- \[ \] T1\. Task 1/);
});

test("a checked task renders its review candidate, never its checkbox", () => {
  const rendered = renderFeatureDoc(docWithTasks(3));
  assert.match(rendered, /- \[x\] T2\. Task 2\n {2}- observed: `npm test` → success\n {2}- candidate: 1a2b3c4/);
});

test("a checked task without a candidate parses as a defect, not as checked", () => {
  const text = renderFeatureDoc(docWithTasks(3)).replace("  - candidate: 1a2b3c4\n", "");
  const parsed = parseFeatureDoc(text);
  assert.ok(
    parsed.defects.some((d) => d.includes("T2") && d.includes("candidate")),
    `defects should name the missing candidate: ${JSON.stringify(parsed.defects)}`,
  );
  assert.equal(parsed.doc.tasks[1].checked, false, "a checkoff NODD cannot attribute is not a checkoff");
});

test("a missing section returns a typed defect list, never a throw", () => {
  const broken = "# Feature: Demo\n\n## Objective\n\nx\n";
  const parsed = parseFeatureDoc(broken);
  assert.ok(parsed.defects.length > 0);
  for (const missing of ["## Problem", "## Scope", "## Constraints", "## Route", "## Tasks"]) {
    assert.ok(
      parsed.defects.some((d) => d.includes(missing)),
      `defects should name ${missing}: ${JSON.stringify(parsed.defects)}`,
    );
  }
  assert.equal(parsed.doc.objective, "x");
});

test("the slug survives the round trip", () => {
  const parsed = parseFeatureDoc(renderFeatureDoc(docWithTasks(1)));
  assert.equal(parsed.doc.slug, "demo");
});

// ---------------------------------------------------------------------------
// The declared verification contract (`## Verification`)
// ---------------------------------------------------------------------------
test("the declared runner and TDD mode survive the round trip", () => {
  const parsed = parseFeatureDoc(renderFeatureDoc(docWithTasks(1)));
  assert.equal(parsed.doc.verification.runner, "npm test");
  assert.equal(parsed.doc.verification.source, "nodd_declare");
  assert.deepEqual(parsed.doc.verification.files, ["src/thing.ts"]);
});

test("an undeclared runner round-trips as null, never as an invented command", () => {
  const doc = emptyDoc({ slug: "bare", title: "Bare" });
  const parsed = parseFeatureDoc(renderFeatureDoc(doc));
  assert.equal(parsed.doc.verification.runner, null);
  assert.equal(parsed.doc.verification.tdd, "off");
  assert.deepEqual(parsed.doc.verification.files, []);
});

// ---------------------------------------------------------------------------
// Matrix row 13: a pending check cannot be dropped from the close report
// ---------------------------------------------------------------------------
test("the Outcome section is derived from the tasks, so a pending check cannot be omitted", () => {
  const rendered = renderFeatureDoc(docWithTasks(3));
  const outcome = rendered.split("## Outcome")[1].split("## Progress")[0];

  assert.match(outcome, /verified: 1 of 3/, "the count is reported, not asserted");
  assert.match(outcome, /\[x\] T2: `npm test` → success/, "a verified task carries its observed evidence");
  for (const pending of ["T1", "T3"]) {
    assert.match(outcome, new RegExp(`\\[ \\] ${pending}: no observed verification yet`), `${pending} must appear as pending`);
  }
});

test("no caller can author the Outcome section: it is a function of the task list", () => {
  const doc = docWithTasks(3);
  assert.ok(!("outcome" in doc), "there is no free-text outcome field to forge");
  assert.deepEqual(renderOutcome(doc), renderOutcome({ ...doc }));
  assert.deepEqual(renderOutcome(emptyDoc({ slug: "s", title: "T" })), ["No tasks declared yet."]);
});
