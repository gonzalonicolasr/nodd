// What happens to work already done when the plan changes.
//
// `routing.go:97`: accepted changes preserve valid completed and unrelated work;
// add new or reopen invalidated tasks **with a reason**; findings alone never
// authorize scope expansion; business scope changes still need the user;
// checkboxes grant no approval and no receipt.
//
// Three of those are mechanical and live here:
//
//   - **Preserve.** A rewrite that would lose a completed task is refused,
//     naming it. Losing finished work silently is the worst possible outcome of
//     a "helpful" replan, and it is invisible in a diff of a generated file.
//   - **Reason required.** Reopening a `[x]` needs a reason, which lands in
//     `## Progress`. An unexplained reopen is indistinguishable from erasing an
//     inconvenient result.
//   - **Findings authorize nothing.** The declaration comes from `nodd_declare`
//     observations and from nothing else, so a `subagent` result that says "this
//     really needs a tracked route" cannot make it one. That is the observable
//     half of "findings alone never authorize scope expansion".
//
// Whether a change is a *business*-scope change stays prose: the mechanism is
// only that intent and route move exclusively through an explicit declaration.

import type { Committed, Declaration } from "./state.ts";
import type { FeatureDoc, Task } from "./feature-doc.ts";

export type Acceptance =
  | { ok: true; doc: FeatureDoc }
  | { ok: false; problem: string };

/**
 * The declared intent and route, from observed `nodd_declare` calls only.
 * The reducer already enforces this; the function exists so the rule has a name
 * and a test, rather than being an emergent property nobody is watching.
 */
export function declarationAfter(committed: Committed): Declaration | null {
  return committed.declaration;
}

function describe(task: Task): string {
  return `${task.id} (${task.title})`;
}

/** Reopen a checked task. A reason is required and is recorded under Progress. */
export function reopenTask(doc: FeatureDoc, id: string, reason: string): Acceptance {
  const index = doc.tasks.findIndex((task) => task.id === id);
  if (index < 0) return { ok: false, problem: `${id} is not in the feature document` };

  const task = doc.tasks[index];
  if (!task.checked) return { ok: false, problem: `${id} is not checked, so there is nothing to reopen` };

  if (reason.trim() === "") {
    return {
      ok: false,
      problem: `reopening ${describe(task)} requires a reason: an unexplained reopen is indistinguishable from erasing a result`,
    };
  }

  const tasks = [...doc.tasks];
  // The old evidence described the old code. Keeping it on a reopened task would
  // let a stale success get re-checked without anything being observed again.
  tasks[index] = { id: task.id, title: task.title, checked: false };

  const progress = [doc.progress.trim(), `- ${id} reopened: ${reason.trim()}`]
    .filter((part) => part !== "")
    .join("\n");

  return { ok: true, doc: { ...doc, tasks, progress } };
}

/**
 * Accept a proposed replacement document. Completed tasks must survive it, and
 * they must survive it still completed — silently unchecking one is a reopen
 * wearing a rewrite's clothes, and reopens need a reason.
 */
export function acceptRewrite(before: FeatureDoc, after: FeatureDoc): Acceptance {
  const proposed = new Map(after.tasks.map((task) => [task.id, task]));

  for (const task of before.tasks) {
    if (!task.checked) continue;

    const replacement = proposed.get(task.id);
    if (!replacement) {
      return {
        ok: false,
        problem: `this rewrite would drop the completed task ${describe(task)}; valid completed work is preserved`,
      };
    }
    if (!replacement.checked) {
      return {
        ok: false,
        problem: `this rewrite would uncheck the completed task ${describe(task)}; use reopenTask with a reason instead`,
      };
    }
  }

  return { ok: true, doc: after };
}
