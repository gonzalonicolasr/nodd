// gate-delegate — the clause ODD states and cannot enforce.
//
// ODD's non-delegation is invisible: the manifest triggers
// (`manifest.go:203-216`) and the long-session backstop (`routing.go:82`) are
// prose the model may simply not follow. Here they are counted from observed
// tool results and the write is refused.
//
// Three triggers, in ODD's own numbers (`src/manifest.ts`):
//   - mapping:      >= 4 distinct files read with no delegation yet
//   - writer:       >= 2 distinct files written
//   - long session: >= 20 tool calls with no delegation yet
//
// Distinct *files*, never call counts: reading one file six times is one file
// in context, and a gate that could not tell those apart would fire on a
// careful re-read of the same module.
//
// The counters are per process. That is the intended semantics, not a gap: the
// triggers exist to keep *this* agent's context thin enough to orchestrate, and
// a delegated child has its own context window. There is no aggregate
// whole-session total across parent and children, and NODD does not claim one.

import type { Committed } from "../state.ts";
import type { PendingCall } from "../observations.ts";
import { THRESHOLDS } from "../manifest.ts";
import { classifyBash } from "../bash-classifier.ts";
import { allow, refuse, resolveFlag, type GateDecision, type Policy } from "./policy.ts";
import { isFileWrite, targetPath, type GateRequest } from "./request.ts";

/**
 * Files this session wrote, plus the ones it is about to. Write *intent* is
 * known at preflight, so counting a sibling's intent is sound; a sibling's
 * result is not observable yet and is never counted.
 */
function writtenFiles(committed: Committed, request: GateRequest, pending: Map<string, PendingCall>): Set<string> {
  const files = new Set(committed.filesWritten.keys());
  for (const call of pending.values()) {
    if (isFileWrite(call)) {
      const path = targetPath(call);
      if (path) files.add(path);
    }
  }
  const path = targetPath(request);
  if (path) files.add(path);
  return files;
}

export function delegateGate(
  committed: Committed,
  request: GateRequest,
  policy: Policy,
  pending: Map<string, PendingCall>,
): GateDecision {
  if (!resolveFlag("delegate", policy).enabled) return allow();
  if (!isFileWrite(request) && classifyBash(String(request.input?.command ?? "")) !== "mutating") return allow();
  if (committed.delegations > 0) return allow();

  const remedy = "delegate the work with the `subagent` tool, or declare this as small inline work";

  const written = writtenFiles(committed, request, pending);
  if (written.size >= THRESHOLDS.writerMinNonTrivialFiles) {
    return refuse(
      "delegate",
      `this session has written ${written.size} distinct files (threshold ${THRESHOLDS.writerMinNonTrivialFiles}) without delegating`,
      remedy,
    );
  }

  if (committed.filesRead.size >= THRESHOLDS.mappingMinUnderstandingFiles) {
    return refuse(
      "delegate",
      `this session has read ${committed.filesRead.size} distinct files (threshold ${THRESHOLDS.mappingMinUnderstandingFiles}) without delegating`,
      remedy,
    );
  }

  if (committed.toolCalls >= THRESHOLDS.longSessionToolCalls) {
    return refuse(
      "delegate",
      `this session has run ${committed.toolCalls} tool calls (threshold ${THRESHOLDS.longSessionToolCalls}) without delegating`,
      remedy,
    );
  }

  return allow();
}
