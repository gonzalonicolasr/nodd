// SPIKE probe — NOT production code, and not listed in `pi.extensions`.
//
// The question: when a parent pi session loads an extension, does that same
// extension load inside a pi-subagents child process?
//
// The probe answers it with two observables:
//   1. a load marker written to `$NODD_PROBE_DIR/loaded-<pid>.txt` on register,
//      carrying the child-process env markers pi-subagents sets;
//   2. a `tool_call` gate that blocks any `write` whose path contains
//      `PROBE-BLOCK-ME`, appending to `$NODD_PROBE_DIR/blocks.txt`.
//
// If the marker appears once (parent only) and the child's write succeeds, the
// gates do not load in children and NODD must say so.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.NODD_PROBE_DIR ?? "/tmp/nodd-probe";

type ToolCallEvent = { toolName: string; toolCallId?: string; input?: Record<string, unknown> };
type PiApi = { on(event: string, handler: (event: never) => unknown): void };

export default function register(pi?: PiApi): void {
  mkdirSync(dir, { recursive: true });

  const isChild = process.env.PI_SUBAGENT_CHILD ?? "(unset)";
  const agent = process.env.PI_SUBAGENT_CHILD_AGENT ?? "(unset)";
  writeFileSync(
    join(dir, `loaded-${process.pid}.txt`),
    [
      `pid=${process.pid}`,
      `ppid=${process.ppid}`,
      `PI_SUBAGENT_CHILD=${isChild}`,
      `PI_SUBAGENT_CHILD_AGENT=${agent}`,
      `argv=${process.argv.join(" ")}`,
      "",
    ].join("\n"),
    "utf8",
  );

  if (!pi || typeof pi.on !== "function") return;

  pi.on("tool_call", ((event: ToolCallEvent) => {
    const path = String(event?.input?.path ?? "");
    if (event?.toolName === "write" && path.includes("PROBE-BLOCK-ME")) {
      appendFileSync(join(dir, "blocks.txt"), `pid=${process.pid} blocked write to ${path}\n`, "utf8");
      return { block: true, reason: "nodd probe: this write is blocked by the probe extension" };
    }
    return undefined;
  }) as never);
}
