// Feature doc → forge requirements, as a pure string transform.
//
// Promotion is a handoff, not a migration: NODD's `.nodd/<slug>/feature.md` stays
// where it is, and forge receives a `requirements.md` it can plan from.
//
// **What this deliberately does not emit.** No `design.md` and no `tasks.md`.
// Forge's resume algorithm lands on `no-plan` and restarts at `plan` precisely
// when those two are absent (`orchestrator.md:102-105`); emitting a half-built
// plan would push the resume into `analyzing` or `building` and hand forge a
// plan nobody wrote. A source-scan test asserts neither filename appears here.
//
// Completed tasks travel with their observed evidence, under a heading that says
// in words they must not be redone — a plan phase that re-plans finished work is
// the expensive failure this section exists to prevent.

import type { FeatureDoc, Task } from "./feature-doc.ts";

function section(heading: string, body: string, fallback: string): string {
  return `## ${heading}\n\n${body.trim() === "" ? fallback : body.trim()}\n`;
}

function resolvedRow(task: Task): string {
  if (!task.checked) return "";
  return [
    `- **${task.id} — ${task.title}**`,
    `  - verified by: \`${task.evidence.command}\``,
    `  - observed: ${task.evidence.outcome}`,
    `  - review candidate: ${task.candidate}`,
  ].join("\n");
}

export function promotedRequirements(doc: FeatureDoc): string {
  const done = doc.tasks.filter((task): task is Extract<Task, { checked: true }> => task.checked);
  const remaining = doc.tasks.filter((task) => !task.checked);

  const resolved =
    done.length === 0
      ? "None. No task in this run reached a verified completion, so nothing here is already done."
      : [
          "The work below is **already done and verified**. It must not be redone, re-planned or",
          "re-implemented. Treat it as existing context; plan only what remains.",
          "",
          ...done.map(resolvedRow),
        ].join("\n");

  const remainingBody =
    remaining.length === 0
      ? "Everything recorded in the NODD run is complete; the remaining scope is whatever the objective still implies."
      : remaining.map((task) => `- ${task.id} — ${task.title}`).join("\n");

  return [
    `# ${doc.title || doc.slug}`,
    "",
    `Promoted from the NODD run \`${doc.slug}\`. NODD kept the inline route until the work`,
    "outgrew it; this document is the handoff, not a fresh start.",
    "",
    section("Objective", doc.objective, "_Not recorded in the NODD run._"),
    section("Problem", doc.problem, "_Not recorded in the NODD run._"),
    section("Scope", doc.scope, "_Not recorded in the NODD run._"),
    section("Constraints", doc.constraints, "_Not recorded in the NODD run._"),
    section("Remaining work", remainingBody, "_Nothing recorded._"),
    section("Already resolved — do not redo", resolved, "None."),
  ].join("\n");
}
