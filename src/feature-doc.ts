// `.nodd/<slug>/feature.md` — extension-owned, never authored freehand by the
// model. The schema follows gentle's `odd/tasks/<feature>.md`
// (`odd/tasks/odd-mandatory-delegation.md`): title, Objective, Problem, Scope,
// Constraints, Route, Tasks, Outcome, Progress.
//
// Two properties make this file evidence rather than prose: a checked task
// carries its evidence reference *by type*, so rendering a `[x]` without one
// does not compile; and a missing section returns a defect list instead of
// throwing, because a half-written doc must be reported, not crash a session.

export type Intent = "read-only" | "change";
export type Route = "inline" | "tracked" | "forge";

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
  tasks: Task[];
  outcome: string;
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
    tasks: [],
    outcome: "",
    progress: "",
  };
}

const SECTIONS = ["Objective", "Problem", "Scope", "Constraints", "Route", "Tasks", "Outcome", "Progress"] as const;

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

export function renderFeatureDoc(doc: FeatureDoc): string {
  const body = [
    `# Feature: ${doc.title}`,
    "",
    `<!-- nodd:slug ${doc.slug} -->`,
    "",
    "## Objective",
    "",
    doc.objective,
    "",
    "## Problem",
    "",
    doc.problem,
    "",
    "## Scope",
    "",
    doc.scope,
    "",
    "## Constraints",
    "",
    doc.constraints,
    "",
    "## Route",
    "",
    `- intent: ${doc.route.intent}`,
    `- route: ${doc.route.route}`,
    "",
    "## Tasks",
    "",
    doc.tasks.map(renderTask).join("\n"),
    "",
    "## Outcome",
    "",
    doc.outcome,
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
      tasks: parseTasks(sections.get("Tasks") ?? "", defects),
      outcome: sections.get("Outcome") ?? "",
      progress: sections.get("Progress") ?? "",
    },
    defects,
  };
}
