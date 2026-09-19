import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDoc, parseFeatureDoc, renderFeatureDoc, type FeatureDoc } from "./feature-doc.ts";

function docWithTasks(n: number): FeatureDoc {
  const doc = emptyDoc({ slug: "demo", title: "Demo feature" });
  doc.objective = "Make the thing work.";
  doc.problem = "The thing does not work.";
  doc.scope = "- src/thing.ts";
  doc.constraints = "- no new dependencies";
  doc.route = { intent: "change", route: "tracked" };
  doc.outcome = "Pending.";
  doc.progress = "- started";
  for (let i = 1; i <= n; i++) {
    doc.tasks.push(
      i === 2
        ? { id: `T${i}`, title: `Task ${i}`, checked: true, evidence: { command: "npm test", outcome: "success" } }
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
