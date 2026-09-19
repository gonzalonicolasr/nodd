// Generating NODD's own pi-subagents agent files.
//
// Pattern from `sdd-agents.ts:94-130,220-270`. Three agents, one per model-backed
// canonical step; the four mechanism steps get none, because they run no model.
// They land under `~/.pi/agent/agents/nodd/` and never under `agents/zero/` —
// forge's namespace is forge's.
//
// ## Why this is safe to ship (the spike's answer)
//
// `spike/subagent-enforcement/RESULT.md` measured it on pi 0.84.2: an extension
// loaded as an **installed package** does load inside pi-subagent children, and
// the child's `write` was blocked by the child's own copy of the gate. So
// delegating through these agents does not route work around NODD's enforcement,
// which was the open question that gated this task.
//
// Two consequences are built into the renderer rather than left to documentation:
//
//  1. **No `extensions:` line.** An agent definition that declares one makes
//     pi-subagents launch the child with `--no-extensions`
//     (`pi-args.ts:472-474`), which would strip NODD out of NODD's own
//     sub-agent. A test asserts the line is absent.
//  2. **The advisory travels.** `routing.go:95`'s ~400-line figure is a planning
//     heuristic, and its anti-gaming sentence is forwarded verbatim into every
//     body, so a child does not optimize for a number the parent is only
//     estimating with.
//
// Provisioning is best-effort per file: one failure never blocks the others and
// never breaks a pi session.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { noddConfigPath } from "../src/config.ts";

/** Forwarded verbatim into every generated body (`routing.go:95`). */
export const ANTI_GAMING =
  "Never delete blank lines or comments for cosmetic savings, never minify, " +
  "never omit tests, never add gratuitous abstractions, and never split work " +
  "artificially to fit the number.";

export type NoddAgent = {
  /** The configurable slot this agent's model comes from. */
  slot: "explore" | "resolve-uncertainty" | "implement";
  description: string;
  tools: string[];
  purpose: string;
};

export const NODD_AGENTS: readonly NoddAgent[] = Object.freeze([
  {
    slot: "explore",
    description: "NODD explore step: map existing code and requirements, read-only",
    tools: ["read", "grep", "ls", "bash"],
    purpose:
      "Map the existing code and requirements for the task you are given. You are read-only: " +
      "report what is there, where it is, and what it implies. Do not write, edit or delegate a writer.",
  },
  {
    slot: "resolve-uncertainty",
    description: "NODD resolve-uncertainty step: research one named uncertainty, read-only",
    tools: ["read", "grep", "ls", "bash"],
    purpose:
      "Research the one named uncertainty you were given. Prefer primary sources, attribute every claim " +
      "to a URL or a code location, and distinguish verified facts from assumptions. Research is read-only " +
      "and does not authorize implementation.",
  },
  {
    slot: "implement",
    description: "NODD implement step: change the code for one task and verify it",
    tools: ["read", "grep", "ls", "write", "edit", "bash"],
    purpose:
      "Implement the one task you were given and verify it by running the project's own checks. " +
      "Report the observed result of those checks verbatim, including failures — never a summary that " +
      "claims a pass you did not see.",
  },
]);

export function agentsDir(home: string = homedir()): string {
  return join(home, ".pi", "agent", "agents", "nodd");
}

/** The advisory block every generated body carries. */
function advisory(): string {
  return [
    "## Scale advisory (not a rule)",
    "",
    "About 400 authored changed lines per task is a **planning heuristic, advisory only**.",
    "It is not an acceptance criterion, not a hard cap, not a counter-trigger, not an",
    "automatic stop, not a forced split and not a review trigger. If the correct solution",
    "naturally exceeds it, say so briefly and continue.",
    "",
    ANTI_GAMING,
  ].join("\n");
}

/** The enforcement note, from the spike's measured result. */
function enforcementNote(): string {
  return [
    "## NODD gates apply here",
    "",
    "NODD is installed as a pi package, so its gates load in this child process too and",
    "will block a write that violates one. A refusal names what was observed, the action",
    "that unblocks it, and a one-shot `/nodd-allow <gate>` override. Treat a block as",
    "information, not as an obstacle to work around.",
  ].join("\n");
}

/** Pure: agent definition plus model in, file text out. */
export function buildAgentFile(
  agent: NoddAgent,
  model: string | undefined,
  thinking?: string | undefined,
): string {
  const front = ["---", `name: nodd-${agent.slot}`, `description: ${agent.description}`];
  // Omitted rather than emitted empty: a blank `model:` is a value pi cannot
  // resolve, and an unresolvable model fails at the moment it is needed.
  if (model) front.push(`model: ${model}`);
  // The level `/nodd-models` stored. Without this line the picker would be
  // writing a setting nothing reads.
  if (thinking) front.push(`thinking: ${thinking}`);
  front.push(
    `tools: ${agent.tools.join(", ")}`,
    "systemPromptMode: replace",
    "inheritProjectContext: false",
    "inheritSkills: false",
    "defaultContext: fresh",
    "---",
  );

  const body = [
    `# NODD · ${agent.slot}`,
    "",
    agent.purpose,
    "",
    advisory(),
    "",
    enforcementNote(),
  ].join("\n");

  return `${front.join("\n")}\n\n${body}\n`;
}

/**
 * The level configured for a slot. Unlike the model there is no `default`
 * fallback: an unset level means pi's own default, which is the right answer.
 */
function thinkingFor(config: Record<string, unknown>, slot: string): string | undefined {
  const thinking = config.thinking;
  if (typeof thinking !== "object" || thinking === null) return undefined;
  const level = (thinking as Record<string, unknown>)[slot];
  return typeof level === "string" && level !== "" ? level : undefined;
}

function modelFor(config: Record<string, unknown>, slot: string): string | undefined {
  const models = config.models;
  if (typeof models !== "object" || models === null) return undefined;
  const map = models as Record<string, unknown>;
  const specific = map[slot];
  if (typeof specific === "string" && specific !== "") return specific;
  const fallback = map.default;
  return typeof fallback === "string" && fallback !== "" ? fallback : undefined;
}

export type ProvisionResult = { written: string[]; failed: string[] };

export function provisionAgents(home: string, config: Record<string, unknown>): ProvisionResult {
  const result: ProvisionResult = { written: [], failed: [] };
  const dir = agentsDir(home);

  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return { written: [], failed: NODD_AGENTS.map((agent) => `nodd-${agent.slot}`) };
  }

  for (const agent of NODD_AGENTS) {
    const name = `nodd-${agent.slot}`;
    try {
      writeFileSync(
        join(dir, `${name}.md`),
        buildAgentFile(agent, modelFor(config, agent.slot), thinkingFor(config, agent.slot)),
        "utf8",
      );
      result.written.push(name);
    } catch {
      // One agent failing must not block the other two.
      result.failed.push(name);
    }
  }

  return result;
}

export default function register(_pi?: unknown): void {
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(noddConfigPath(), "utf8")) as Record<string, unknown>;
    } catch {
      // No config, or an unreadable one: the agents are still worth having, just
      // without an explicit model.
    }
    provisionAgents(homedir(), config);
  } catch {
    // Provisioning must never break a pi session.
  }
}
