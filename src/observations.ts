// What NODD saw, as it saw it.
//
// An `Observation` is a fact from a real pi `tool_result` event: the tool, its
// input, whether pi reported an error, and the rendered result text. Nothing
// here interprets that raw material — `src/outcome.ts` derives the five command
// outcomes from it, and it does so on demand. Storing the interpretation
// instead of the observation is how "Evidence: tests pass" became worthless in
// ODD: once collapsed, the evidence can no longer be re-checked.

export type Observation = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** pi's own error flag from the tool result. Not a verdict — an observation. */
  isError: boolean;
  /** The rendered result text, including the status line pi's bash appends. */
  resultText: string;
  /** ISO timestamp of when the result was observed. */
  at: string;
};

/**
 * A tool call preflighted in the current assistant batch whose result is not
 * known yet. It deliberately has no result fields: pi preflights siblings
 * sequentially and runs them concurrently, so a gate that read a result from
 * here would read evidence that does not exist.
 */
export type PendingCall = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type Committed = {
  observations: Observation[];
};

export type NoddState = {
  committed: Committed;
  pending: Map<string, PendingCall>;
};

export function observation(fields: Observation): Observation {
  if (!fields?.toolCallId) {
    throw new Error("an observation requires a toolCallId: it is what makes replay idempotent");
  }
  return {
    toolCallId: fields.toolCallId,
    toolName: fields.toolName,
    input: fields.input ?? {},
    isError: fields.isError,
    resultText: fields.resultText ?? "",
    at: fields.at,
  };
}

export function pendingCall(fields: PendingCall): PendingCall {
  if (!fields?.toolCallId) throw new Error("a pending call requires a toolCallId");
  return { toolCallId: fields.toolCallId, toolName: fields.toolName, input: fields.input ?? {} };
}

export function emptyState(): NoddState {
  return { committed: { observations: [] }, pending: new Map() };
}
