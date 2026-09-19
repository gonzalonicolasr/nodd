// The shape a gate sees: one tool call, before it runs.
//
// This is the extension's translation of pi's `ToolCallEvent`
// (`types.d.ts:649-691`) into something pure. Gates never touch pi types.

import { classifyBash } from "../bash-classifier.ts";

export type GateRequest = {
  toolName: string;
  input: Record<string, unknown>;
};

export function targetPath(request: GateRequest): string | null {
  const path = request.input?.path;
  return typeof path === "string" && path !== "" ? path : null;
}

/** A direct, typed file write: `write` or `edit`. Exactly gateable. */
export function isFileWrite(request: GateRequest): boolean {
  return request.toolName === "write" || request.toolName === "edit";
}

/** A bash call whose command matches the documented mutation denylist. */
export function isMutatingBash(request: GateRequest): boolean {
  if (request.toolName !== "bash") return false;
  const command = request.input?.command;
  return typeof command === "string" && classifyBash(command) === "mutating";
}

/**
 * Any observable attempt to change the workspace: a typed write, or a bash
 * command the classifier recognises as mutating.
 */
export function isMutation(request: GateRequest): boolean {
  return isFileWrite(request) || isMutatingBash(request);
}

/** Delegating to a writer is a mutation by proxy (`routing.go:44`). */
export function isDelegation(request: GateRequest): boolean {
  return request.toolName === "subagent";
}
