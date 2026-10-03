// nodd-kernel — the pi-facing half of NODD.
//
// This is the only place pi events are registered. Everything it learns is
// translated into `Observation` values and folded by the pure reducer in
// `src/state.ts`, so every rule stays testable without a pi runtime.
//
// In this capability the kernel is an observer: it blocks nothing. The gates
// land in later tasks, and when they do, a refusal returns `{ block, reason }`
// and never `terminate` — pi stops the agent early only when *every* finalized
// result in a batch is terminating (`types.d.ts:781-786`), so aborting one
// sibling would take its innocent siblings with it.

import { join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { renderPrompt } from "../src/prompt.ts";
import { type Policy, emptyPolicy } from "../src/gates/policy.ts";
import { flagsFromCli } from "./nodd-gates.ts";
import type { CapabilityLookup } from "../src/gates/authorize.ts";
import { nodeFs } from "../src/io.ts";
import { statusLine } from "../src/status.ts";
import {
  clearHatch,
  configComplaint,
  createKernel as createKernelWith,
  DECLARE_SCHEMA,
  OBSERVATION_ENTRY,
  readPolicy,
  TASK_SCHEMA,
  type DeclareArgs,
  type Kernel,
  type SessionEntry,
  type TaskArgs,
  type ToolCallEvent,
  type ToolResultEvent,
} from "../src/kernel.ts";

export {
  featureDocPath,
  OBSERVATION_ENTRY,
  type DeclareArgs,
  type Kernel,
  type TaskArgs,
  type ToolReply,
} from "../src/kernel.ts";

type Ui = { ui?: { setStatus?(key: string, text?: string): void } };
type SessionStartContext = { sessionManager?: { getEntries?(): SessionEntry[] } } & Ui;
type AgentStartEvent = { systemPrompt?: unknown };

/** The slice of pi's API this extension uses. Declared locally: no pi import. */
type PiApi = {
  on(event: string, handler: (event: never) => unknown): void;
  appendEntry?(type: string, data?: unknown): void;
  // Un solo objeto, con el nombre adentro. pi hace `tools.set(tool.name, …)`:
  // pasarle (name, options) como a registerCommand deja el nombre en undefined
  // y el provider rechaza el request entero con "tools[N].name is required".
  registerTool?(tool: { name: string } & Record<string, unknown>): void;
  getFlag?(name: string): boolean | string | undefined;
};

export function createKernel(
  now: () => string = () => new Date().toISOString(),
  cwd: string = process.cwd(),
  loadPolicy: () => Policy = emptyPolicy,
  isReadOnlyAgent: CapabilityLookup = readOnlyAgentLookup(homedir()),
  spendHatch: (gate: string) => void = () => {},
): Kernel {
  return createKernelWith({ fs: nodeFs, now, cwd, loadPolicy, isReadOnlyAgent, spendHatch });
}

/**
 * A kernel result in the shape pi renders.
 *
 * pi expects `content` blocks, not a string (`dynamic-tools.ts:41-44`), and
 * reads `isError` to mark the call as failed — so a refusal the kernel reports
 * as `ok: false` is shown as an error instead of quietly reading as success.
 */
function toolResult(result: { ok: boolean; text: string }) {
  return { content: [{ type: "text" as const, text: result.text }], isError: result.ok === false };
}

/** pi's tool input, as a plain object a gate can read. */
function normalizeInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

/** `~/.pi/agent/agents`, where every agent definition (NODD's and the user's) lives. */
function agentsRoot(home: string): string {
  return join(home, ".pi", "agent", "agents");
}

/**
 * `gate-authorize`'s capability lookup: read the target agent's own `tools:`
 * frontmatter rather than trusting its name. Searches one level of
 * subdirectory under `agentsRoot` (`nodd/`, `zero/`, any user namespace) for a
 * file whose `name:` field matches, and answers whether `write`/`edit` is
 * absent from its declared `tools:`.
 *
 * Best effort: any filesystem error, or a target that cannot be found, answers
 * `null` -- "cannot be determined" -- which `authorizeGate` refuses, exactly as
 * an unresolvable target should.
 */
function readOnlyAgentLookup(home: string): CapabilityLookup {
  return (agentName: string): boolean | null => {
    try {
      const root = agentsRoot(home);
      const dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const dir of dirs) {
        const dirPath = join(root, dir.name);
        for (const file of readdirSync(dirPath)) {
          if (!file.endsWith(".md")) continue;
          const path = join(dirPath, file);
          if (!statSync(path).isFile()) continue;
          const text = readFileSync(path, "utf8");
          const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
          if (!frontmatter) continue;
          const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
          if (name !== agentName) continue;
          const toolsLine = /^tools:\s*(.+)$/m.exec(frontmatter)?.[1] ?? "";
          const tools = toolsLine.split(",").map((t) => t.trim());
          return !tools.includes("write") && !tools.includes("edit");
        }
      }
      return null;
    } catch {
      return null;
    }
  };
}

export default function register(pi?: PiApi, cwd: string = process.cwd(), home?: string): Kernel {
  // `--nodd-off` is declared by `nodd-gates.ts` so pi accepts it; reading it
  // back is the kernel's job, because the kernel owns the policy. Without this
  // the flag parsed cleanly into a value nobody consulted, and the documented
  // total kill switch did nothing at all.
  const cliFlags = flagsFromCli(
    typeof pi?.getFlag?.("nodd-off") === "string" ? (pi.getFlag("nodd-off") as string) : undefined,
  );

  const kernel = createKernel(
    undefined,
    cwd,
    () => ({ ...readPolicy(nodeFs, home ?? homedir()), flags: cliFlags }),
    readOnlyAgentLookup(home ?? homedir()),
    (gate) => clearHatch(nodeFs, gate, home ?? homedir()),
  );
  if (!pi || typeof pi.on !== "function") {
    kernel.reloadPolicy();
    return kernel;
  }

  // Flags the user set persist into the session's policy. `/nodd-allow` adds
  // one-shot hatches on top of this at runtime.
  kernel.reloadPolicy();

  // pi calls `definition.execute` (`tool-definition-wrapper.js:11`) and renders
  // `label` in the UI (`types.d.ts:344-372`). Registering a `handler` returning
  // a bare string type-checked and did nothing: both tools threw
  // `definition.execute is not a function` on every call, which made the
  // `tracked` route unusable in every published version up to 0.5.0.
  pi.registerTool?.({
    name: "nodd_declare",
    label: "NODD Declare",
    ...DECLARE_SCHEMA,
    execute: async (_toolCallId: string, params: DeclareArgs) => toolResult(kernel.declare(params)),
  });
  pi.registerTool?.({
    name: "nodd_task",
    label: "NODD Task",
    ...TASK_SCHEMA,
    execute: async (_toolCallId: string, params: TaskArgs) => toolResult(kernel.task(params)),
  });

  // Enforcement. The gates are useless unless they run here: this is the only
  // point in a session where NODD can refuse a call before it happens.
  pi.on("tool_call", ((event: ToolCallEvent, ctx?: Ui) => {
    let decision: { block: true; reason: string } | null = null;
    try {
      // Re-read the flags before deciding. `/nodd-gates disable` writes the
      // config from another extension, and a policy read only at startup would
      // keep blocking while disk already said the gate was off.
      kernel.reloadPolicy();
      decision = kernel.checkCall({ toolName: event?.toolName ?? "", input: normalizeInput(event?.input) });
    } catch {
      // A gate that throws must not break the session. Failing open here is
      // deliberate: NODD refuses work it understands, never work it crashed on.
      decision = null;
    }
    // Record the call either way: within this turn the entry is what lets
    // `gate-classify` and `gate-delegate` see intent that shares one assistant
    // message, before any result exists. (It does not reach `toolCalls`, which
    // only advances on `tool_result` — see the note in `src/state.ts`.)
    kernel.onToolCall(event);
    // But a blocked call produces no effect, and pi will never report a result
    // for it: `agent-loop.js:419-428` returns `{ kind: "immediate" }`, which
    // skips `finalizeExecutedToolCall` and therefore the `afterToolCall` that
    // raises `tool_result` (:487). Left pending forever, the refusal would
    // inflate the very count that caused it -- D1's monotonic trap, relocated
    // from `filesWritten` to `pending`. `onToolCall` still ran, so activity is
    // counted; only the phantom effect is dropped.
    if (decision) kernel.forgetPending(event.toolCallId);
    showStatus(ctx);
    return decision ?? undefined;
  }) as never);

  pi.on("tool_result", ((event: ToolResultEvent, ctx?: Ui) => {
    const obs = kernel.onToolResult(event);
    try {
      pi.appendEntry?.(OBSERVATION_ENTRY, obs);
    } catch {
      // Session persistence is best effort: the durable truth is on disk.
    }
    showStatus(ctx);
  }) as never);

  // A turn cannot end with a call still in flight, so anything left pending is
  // a call that will never report: aborted by the user, or dropped on one of
  // the `{kind:"immediate"}` returns that fire after `beforeToolCall`
  // (`agent-loop.js:411-416`, `:426-430`). Those were *allowed*, so the
  // block-path cleanup never saw them, and a leaked entry inflates the writer
  // count for the rest of the session — defect #6, reached by pressing Esc.
  //
  // Clearing at the turn boundary rather than per event is what keeps
  // same-batch intent intact: within a turn the entries are load-bearing,
  // because `gate-delegate` reads them to see writes that share one assistant
  // message before any result exists.
  pi.on("turn_end", (() => {
    kernel.forgetAllPending();
  }) as never);

  pi.on("session_start", ((_event: unknown, ctx: SessionStartContext) => {
    kernel.replay(ctx?.sessionManager?.getEntries?.());
    const complaint = configComplaint(nodeFs, home ?? homedir());
    if (complaint) (ctx as { ui?: { notify?(m: string, t?: string): void } })?.ui?.notify?.(complaint, "warning");
    showStatus(ctx);
  }) as never);

  /**
   * Publish the kernel's state to pi's footer.
   *
   * Gates are invisible until one blocks, so a session where everything is fine
   * looks exactly like one where the extension never loaded. This is the only
   * standing answer to "is it on?".
   *
   * Entirely best effort: `ctx.ui` is absent in print mode
   * (`extensions.md:947`), and a footer we cannot draw must never cost a tool
   * call.
   */
  function showStatus(ctx?: Ui): void {
    try {
      const gates = kernel.policy();
      const enabled = gates.flags.all !== false;
      ctx?.ui?.setStatus?.(
        "nodd",
        statusLine(kernel.state.committed, enabled, kernel.taskProgress() ?? undefined),
      );
    } catch {
      // Decoration, never enforcement.
    }
  }

  // Chained, never replaced (`types.d.ts:806-810`): the incoming prompt is
  // returned byte-for-byte with NODD's two blocks appended, so another
  // extension's contribution survives ours. Rebuilt from current state each
  // turn rather than accumulated, and budgeted in `src/prompt.ts`.
  pi.on("before_agent_start", ((event: AgentStartEvent) => {
    try {
      const incoming = typeof event?.systemPrompt === "string" ? event.systemPrompt : "";
      const { blockA, blockB } = renderPrompt(kernel.evidenceView(), kernel.policy());
      const appended = [blockA, blockB].filter((block) => block !== "").join("\n\n");
      return { systemPrompt: incoming === "" ? appended : `${incoming}\n\n${appended}` };
    } catch {
      // A prompt NODD cannot render must not stop the turn: leaving the
      // incoming prompt untouched loses guidance, never the session.
      return undefined;
    }
  }) as never);

  return kernel;
}
