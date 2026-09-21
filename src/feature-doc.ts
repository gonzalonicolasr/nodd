// `.nodd/<slug>/feature.md` — extension-owned, never authored freehand by the
// model. The schema follows gentle's `odd/tasks/<feature>.md`
// (`odd/tasks/odd-mandatory-delegation.md`): title, Objective, Problem, Scope,
// Constraints, Route, Tasks, Outcome, Progress.
//
// Two properties make this file evidence rather than prose: a checked task
// carries its evidence reference *by type*, so rendering a `[x]` without one
// does not compile; and a missing section returns a defect list instead of
// throwing, because a half-written doc must be reported, not crash a session.

import { defaultDelivery, parseDelivery, renderDelivery, type Delivery } from "./delivery.ts";

export type Intent = "read-only" | "change";
export type Route = "inline" | "tracked" | "forge";

/**
 * How this feature is verified, fixed at declaration time. `gate-evidence` will
 * only accept a run of `runner`, so a checkoff cannot be satisfied by whatever
 * exit-0 string the model happens to produce. `source` records who decided, per
 * `routing.go:101`: the presence of a framework is not a choice.
 */
export type Verification = {
  runner: string | null;
  tdd: "strict" | "off";
  source: string;
  /** The distinct files the declaration promised to touch. */
  files: string[];
};

export type TaskEvidence = {
  command: string;
  /** Rendered verbatim. `src/outcome.ts` owns the vocabulary. */
  outcome: string;
};

/**
 * A checked task carries both its observed evidence and its review candidate,
 * by type. The candidate is a commit SHA or the literal `pending-commit`
 * (`src/review-candidate.ts`) — never the checkbox, per `routing.go:51`,`:102`.
 */
export type Task =
  | { id: string; title: string; checked: false }
  | { id: string; title: string; checked: true; evidence: TaskEvidence; candidate: string };

export type FeatureDoc = {
  slug: string;
  title: string;
  objective: string;
  problem: string;
  scope: string;
  constraints: string;
  route: { intent: Intent; route: Route };
  verification: Verification;
  /** Recorded and measured, never enforced (`src/delivery.ts`). */
  delivery: Delivery;
  tasks: Task[];
  progress: string;
};

export type ParsedFeatureDoc = { doc: FeatureDoc; defects: string[] };

export function emptyDoc(fields: { slug: string; title: string }): FeatureDoc {
  return {
    slug: fields.slug,
    title: fields.title,
    objective: "",
    problem: "",
    scope: "",
    constraints: "",
    route: { intent: "change", route: "inline" },
    verification: { runner: null, tdd: "off", source: "undeclared", files: [] },
    delivery: defaultDelivery(),
    tasks: [],
    progress: "",
  };
}

/**
 * `## Outcome`, rendered from the task list rather than stored.
 *
 * Matrix row 13 (`routing.go:51`) requires that a close report cannot drop a
 * failed or pending check. A free-text field can: in round 1 this was a string
 * nothing ever wrote, so the section was permanently empty while the matrix
 * claimed it was "rendered from the ledger". Deriving it makes the claim true —
 * a pending task is in this section because it is in the list, and no caller
 * can omit it.
 */
export function renderOutcome(doc: FeatureDoc): string[] {
  if (doc.tasks.length === 0) return ["No tasks declared yet."];

  const done = doc.tasks.filter((task) => task.checked);
  const pending = doc.tasks.filter((task) => !task.checked);
  const lines = [`- verified: ${done.length} of ${doc.tasks.length} task(s)`];

  for (const task of done) {
    if (task.checked) lines.push(`- [x] ${task.id}: \`${task.evidence.command}\` → ${task.evidence.outcome}`);
  }
  for (const task of pending) {
    lines.push(`- [ ] ${task.id}: no observed verification yet`);
  }
  return lines;
}

const SECTIONS = [
  "Objective",
  "Problem",
  "Scope",
  "Constraints",
  "Route",
  "Verification",
  "Delivery",
  "Tasks",
  "Outcome",
  "Progress",
] as const;

function renderVerification(v: Verification): string[] {
  return [
    `- runner: ${v.runner ?? "none declared"}`,
    `- tdd: ${v.tdd}`,
    `- source: ${v.source}`,
    `- files: ${v.files.length > 0 ? v.files.join(", ") : "none declared"}`,
  ];
}

function parseVerification(block: string): Verification {
  const field = (name: string): string | null => {
    const match = new RegExp(`^- ${name}: (.+)$`, "m").exec(block);
    const value = match ? match[1].trim() : null;
    return value === null || value === "none declared" ? null : value;
  };
  const files = field("files");
  return {
    runner: field("runner"),
    tdd: field("tdd") === "strict" ? "strict" : "off",
    source: field("source") ?? "undeclared",
    files: files === null ? [] : files.split(",").map((part) => part.trim()).filter((part) => part !== ""),
  };
}

function renderTask(task: Task): string {
  const box = task.checked ? "x" : " ";
  const head = `- [${box}] ${task.id}. ${task.title}`;
  if (!task.checked) return head;
  return [
    head,
    `  - observed: \`${task.evidence.command}\` → ${task.evidence.outcome}`,
    `  - candidate: ${task.candidate}`,
  ].join("\n");
}

/**
 * Prose that cannot open a section.
 *
 * `splitSections` resolves duplicate `## X` headings last-wins, and the free
 * prose fields render before Route and Verification — so a `problem`
 * containing `## Objective` silently rewrote the objective, and everything
 * after the forged heading vanished on the next parse/save cycle.
 *
 * Indenting keeps the author's text visible and readable while making it a
 * paragraph rather than a heading. Refusing the declaration instead would
 * punish a legitimate `## ` in a code sample the user meant to record.
 */
function asProse(text: string): string {
  return text.replace(/^(#+ )/gm, " $1");
}

export function renderFeatureDoc(doc: FeatureDoc): string {
  const body = [
    `# Feature: ${doc.title}`,
    "",
    `<!-- nodd:slug ${doc.slug} -->`,
    "",
    "## Objective",
    "",
    asProse(doc.objective),
    "",
    "## Problem",
    "",
    asProse(doc.problem),
    "",
    "## Scope",
    "",
    asProse(doc.scope),
    "",
    "## Constraints",
    "",
    asProse(doc.constraints),
    "",
    "## Route",
    "",
    `- intent: ${doc.route.intent}`,
    `- route: ${doc.route.route}`,
    "",
    "## Verification",
    "",
    ...renderVerification(doc.verification),
    "",
    "## Delivery",
    "",
    ...renderDelivery(doc.delivery),
    "",
    "## Tasks",
    "",
    doc.tasks.map(renderTask).join("\n"),
    "",
    "## Outcome",
    "",
    ...renderOutcome(doc),
    "",
    "## Progress",
    "",
    doc.progress,
    "",
  ];
  return body.join("\n");
}

/** Split the body into `## <name>` sections, preserving each block's text. */
function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of text.split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      if (current) out.set(current, buffer.join("\n").trim());
      current = heading[1].trim();
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) out.set(current, buffer.join("\n").trim());
  return out;
}

function parseTasks(block: string, defects: string[]): Task[] {
  const tasks: Task[] = [];
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const item = /^- \[( |x)\] (\S+)\. (.*)$/.exec(lines[i]);
    if (!item) continue;
    const [, box, id, title] = item;
    if (box !== "x") {
      tasks.push({ id, title, checked: false });
      continue;
    }
    const evidence = /^ {2}- observed: `(.*)` → (.+)$/.exec(lines[i + 1] ?? "");
    if (!evidence) {
      defects.push(`task ${id} is checked but carries no observed evidence line`);
      tasks.push({ id, title, checked: false });
      continue;
    }
    const candidate = /^ {2}- candidate: (.+)$/.exec(lines[i + 2] ?? "");
    if (!candidate) {
      defects.push(`task ${id} is checked but carries no review candidate line`);
      tasks.push({ id, title, checked: false });
      continue;
    }
    i += 2;
    tasks.push({
      id,
      title,
      checked: true,
      evidence: { command: evidence[1], outcome: evidence[2] },
      candidate: candidate[1].trim(),
    });
  }
  return tasks;
}

export function parseFeatureDoc(text: string): ParsedFeatureDoc {
  const defects: string[] = [];
  const title = /^# Feature: (.+)$/m.exec(text)?.[1]?.trim() ?? "";
  if (!title) defects.push("missing the `# Feature: <title>` heading");
  const slug = /<!-- nodd:slug (\S+) -->/.exec(text)?.[1] ?? "";
  if (!slug) defects.push("missing the `nodd:slug` marker");

  const sections = splitSections(text);
  for (const name of SECTIONS) {
    if (!sections.has(name)) defects.push(`missing section \`## ${name}\``);
  }

  const routeBlock = sections.get("Route") ?? "";
  const intent = /- intent: (\S+)/.exec(routeBlock)?.[1];
  const route = /- route: (\S+)/.exec(routeBlock)?.[1];

  return {
    doc: {
      slug,
      title,
      objective: sections.get("Objective") ?? "",
      problem: sections.get("Problem") ?? "",
      scope: sections.get("Scope") ?? "",
      constraints: sections.get("Constraints") ?? "",
      route: {
        intent: intent === "read-only" || intent === "change" ? intent : "change",
        route: route === "tracked" || route === "forge" ? route : "inline",
      },
      verification: parseVerification(sections.get("Verification") ?? ""),
      delivery: parseDelivery(sections.get("Delivery") ?? ""),
      tasks: parseTasks(sections.get("Tasks") ?? "", defects),
      progress: sections.get("Progress") ?? "",
    },
    defects,
  };
}
