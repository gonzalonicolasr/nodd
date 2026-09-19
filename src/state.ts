// The read-only kernel: `Observation[]` folded into committed state.
//
// Total, deterministic and idempotent by `toolCallId` — replaying a session on
// reload must land on the same state, so a re-delivered event may never
// double-count a file or a tool call. Nothing here reads the filesystem and
// nothing imports pi: every rule downstream of this reducer is testable without
// a runtime.
//
// Bash commands are recorded raw. Whether one mutates the filesystem is the
// classifier's judgement (`src/bash-classifier.ts`) and is derived when a gate
// asks, never baked into the record.

import type { Observation, PendingCall } from "./observations.ts";
import type { Intent, Route } from "./feature-doc.ts";

export type CommandResult = {
  toolCallId: string;
  command: string;
  isError: boolean;
  resultText: string;
  at: string;
};

export type Declaration = { intent: Intent; route: Route; slug: string };

export type Committed = {
  seen: Set<string>;
  filesRead: Set<string>;
  filesWritten: Set<string>;
  commandResults: CommandResult[];
  delegations: number;
  toolCalls: number;
  declaration: Declaration | null;
};

/**
 * The whole session state. `committed` is advanced only by `tool_result`;
 * `pending` holds calls preflighted in the current assistant batch. pi does not
 * guarantee a `tool_call` handler sees its siblings' results
 * (`extensions.md:757-758`), so the two halves are different types on purpose:
 * evidence readers take `Committed` and therefore cannot reach a pending call.
 */
export type NoddState = {
  committed: Committed;
  pending: Map<string, PendingCall>;
};

export function emptyState(): NoddState {
  return { committed: emptyCommitted(), pending: new Map() };
}

export function emptyCommitted(): Committed {
  return {
    seen: new Set(),
    filesRead: new Set(),
    filesWritten: new Set(),
    commandResults: [],
    delegations: 0,
    toolCalls: 0,
    declaration: null,
  };
}

const READ_TOOLS = new Set(["read"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function fold(committed: Committed, obs: Observation): Committed {
  if (committed.seen.has(obs.toolCallId)) return committed;

  const next: Committed = {
    seen: new Set(committed.seen).add(obs.toolCallId),
    filesRead: new Set(committed.filesRead),
    filesWritten: new Set(committed.filesWritten),
    commandResults: [...committed.commandResults],
    delegations: committed.delegations,
    toolCalls: committed.toolCalls + 1,
    declaration: committed.declaration,
  };

  const path = str(obs.input.path);
  if (READ_TOOLS.has(obs.toolName) && path) next.filesRead.add(path);
  if (WRITE_TOOLS.has(obs.toolName) && path) next.filesWritten.add(path);

  if (obs.toolName === "bash") {
    const command = str(obs.input.command);
    if (command) {
      next.commandResults.push({
        toolCallId: obs.toolCallId,
        command,
        isError: obs.isError,
        resultText: obs.resultText,
        at: obs.at,
      });
    }
  }

  if (obs.toolName === "subagent") next.delegations += 1;

  if (obs.toolName === "nodd_declare") {
    const intent = str(obs.input.intent);
    const route = str(obs.input.route);
    const slug = str(obs.input.slug);
    if (intent && route && slug) {
      next.declaration = { intent: intent as Intent, route: route as Route, slug };
    }
  }

  return next;
}

export function foldAll(committed: Committed, observations: Observation[]): Committed {
  return observations.reduce(fold, committed);
}
