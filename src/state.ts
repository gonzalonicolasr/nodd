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
  /**
   * Position in this session's observation order. `at` is a wall clock and two
   * tool results can share a millisecond, so "did the run come after the edit?"
   * is answered by the order the kernel observed them in — which it knows
   * exactly — rather than by a timestamp's resolution. A rule that is only sound
   * when the clock happens to tick between two events is not a mechanism.
   */
  seq: number;
};

/** When a file was written, and where that write sits in observation order. */
export type WriteRecord = { at: string; seq: number };

export type Declaration = {
  intent: Intent;
  route: Route;
  slug: string;
  /**
   * The verification command this feature is checked with, as declared. Evidence
   * must come from it: without this, any exit-0 string the model chose certifies
   * any task, and `echo 'tests pass'` is a valid receipt.
   */
  runner: string | null;
  tdd: "strict" | "off";
  /** Distinct files the declaration promised to touch. `gate-promotion` reads it. */
  files: string[];
};

export type Committed = {
  seen: Set<string>;
  filesRead: Set<string>;
  /**
   * path -> the most recent write to it. A `Set` made "the evidence ran after
   * the edit" structurally uncomputable, which is how a green run predating an
   * edit certified that edit.
   */
  filesWritten: Map<string, WriteRecord>;
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
    filesWritten: new Map(),
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

/** Distinct declared paths. Counted the same way written files are. */
function declaredFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  return [...new Set(paths)];
}

export function fold(committed: Committed, obs: Observation): Committed {
  if (committed.seen.has(obs.toolCallId)) return committed;

  const next: Committed = {
    seen: new Set(committed.seen).add(obs.toolCallId),
    filesRead: new Set(committed.filesRead),
    filesWritten: new Map(committed.filesWritten),
    commandResults: [...committed.commandResults],
    delegations: committed.delegations,
    toolCalls: committed.toolCalls + 1,
    declaration: committed.declaration,
  };

  // `file_path ?? path`: pi's write tool sends the first, edit accepts both
  // (`write.js:99`, `edit.js:92`). Reading only `path` left filesWritten empty
  // on every real write, which is what evidence and delegate count.
  //
  // `toolCalls` above counts every *executed* call, failed or not: `fold` runs
  // on `tool_result`, and a gate-blocked call never produces one, so refusals
  // are invisible here. That is a real limit, not a design: the long-session
  // backstop in `delegate.ts` never sees a refused attempt. It is left that
  // way because the alternative — counting refusals — is what made defect #6
  // self-amplifying, and a session must not be locked out by a number it has
  // no way to lower.
  //
  // `filesRead`/`filesWritten`/`delegations` below model observed outcomes —
  // what the workspace and this session actually gained — so a failed call
  // must not advance them, the same rule `commandResults` already applies via
  // `isError`.
  const path = str(obs.input.file_path) || str(obs.input.path);
  if (!obs.isError) {
    if (READ_TOOLS.has(obs.toolName) && path) next.filesRead.add(path);
    if (WRITE_TOOLS.has(obs.toolName) && path) next.filesWritten.set(path, { at: obs.at, seq: next.toolCalls });
  }

  if (obs.toolName === "bash") {
    const command = str(obs.input.command);
    if (command) {
      next.commandResults.push({
        toolCallId: obs.toolCallId,
        command,
        isError: obs.isError,
        resultText: obs.resultText,
        at: obs.at,
        seq: next.toolCalls,
      });
    }
  }

  if (obs.toolName === "subagent" && !obs.isError) next.delegations += 1;

  if (obs.toolName === "nodd_declare") {
    const intent = str(obs.input.intent);
    const route = str(obs.input.route);
    const slug = str(obs.input.slug);
    if (intent && route && slug) {
      next.declaration = {
        intent: intent as Intent,
        route: route as Route,
        slug,
        runner: str(obs.input.runner),
        // Anything but the literal `strict` is off. A mode NODD cannot read is
        // not a mode it gets to assume.
        tdd: obs.input.tdd === "strict" ? "strict" : "off",
        files: declaredFiles(obs.input.files),
      };
    }
  }

  return next;
}

export function foldAll(committed: Committed, observations: Observation[]): Committed {
  return observations.reduce(fold, committed);
}
