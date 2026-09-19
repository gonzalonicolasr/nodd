// What actually happened when a command ran.
//
// Derived from the raw observation, never from a model claim. The source of
// truth is pi's own bash tool: it throws for every non-zero exit code
// (`bash.js:347`), so `isError === false` means exit 0 by construction — no
// wrapper, no `; echo $?`, no tool override. When it does throw, `bash.js:321`
// appends one marker line describing why.
//
// The union deliberately has no boolean. "Did it pass?" collapses `exit 1`,
// `aborted` and `timeout` into one shape, and that collapse is precisely how a
// timed-out suite gets written down as "tests pass". Callers must name the
// failure mode they are willing to accept; `unknown` is never one of them.

export type Outcome =
  | { kind: "success" }
  | { kind: "exit"; code: number }
  | { kind: "aborted" }
  | { kind: "timeout"; seconds: number }
  | { kind: "unknown" };

function lastNonEmptyLine(text: string): string {
  const lines = (text ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line !== "") return line;
  }
  return "";
}

export function parseOutcome(isError: boolean, resultText: string): Outcome {
  if (!isError) return { kind: "success" };

  // Only the last line. Anything earlier is stdout, and stdout is attacker-
  // controlled in the only sense that matters here: a runner can print the
  // marker text itself, and must not thereby rewrite its own verdict.
  const line = lastNonEmptyLine(resultText);

  const exited = /^Command exited with code (\d+)$/.exec(line);
  if (exited) return { kind: "exit", code: Number(exited[1]) };

  if (line === "Command aborted") return { kind: "aborted" };

  const timedOut = /^Command timed out after (\d+) seconds?$/.exec(line);
  if (timedOut) return { kind: "timeout", seconds: Number(timedOut[1]) };

  return { kind: "unknown" };
}

/** Only `success` satisfies evidence. Everything else, including `unknown`, does not. */
export function isSuccess(outcome: Outcome): boolean {
  return outcome.kind === "success";
}

/** A short human phrase for a feature doc or a refusal message. */
export function describeOutcome(outcome: Outcome): string {
  switch (outcome.kind) {
    case "success": return "success";
    case "exit": return `exit ${outcome.code}`;
    case "aborted": return "aborted";
    case "timeout": return `timed out after ${outcome.seconds}s`;
    case "unknown": return "unknown";
  }
}
