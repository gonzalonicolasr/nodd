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
import { existsSync, readFileSync } from "node:fs";
import { observation, pendingCall, type Observation } from "../src/observations.ts";
import { emptyState, fold, type Committed, type NoddState } from "../src/state.ts";
import {
  emptyDoc,
  parseFeatureDoc,
  renderFeatureDoc,
  type FeatureDoc,
  type Intent,
  type Route,
} from "../src/feature-doc.ts";
import { writeVerified } from "../src/io.ts";
import { renderPrompt } from "../src/prompt.ts";
import { consumeHatch, emptyPolicy, type GateDecision, type Policy } from "../src/gates/policy.ts";
import { parseConfig, noddConfigPath } from "../src/config.ts";
import { GATE_IDS } from "../src/gates/registry.ts";
import { authorizeGate } from "../src/gates/authorize.ts";
import { classifyGate } from "../src/gates/classify.ts";
import { trackGate } from "../src/gates/track.ts";
import { delegateGate } from "../src/gates/delegate.ts";
import { evidenceGate } from "../src/gates/evidence.ts";
import { promotionGate } from "../src/gates/promotion.ts";
import { isFileWrite, targetPath, type GateRequest } from "../src/gates/request.ts";
import { appendRecord, readLedger } from "../src/ledger.ts";
import { isDeclaredRunner } from "../src/gates/evidence.ts";
import { isSuccess, parseOutcome } from "../src/outcome.ts";
import { candidateFor, candidateIdentity } from "../src/review-candidate.ts";
import { reopenTask } from "../src/change-acceptance.ts";

/** The NODD entry type appended to the session so a reload can rebuild state. */
export const OBSERVATION_ENTRY = "nodd:observation";

type ToolCallEvent = { toolName: string; toolCallId: string; input?: Record<string, unknown> };
type ToolResultEvent = ToolCallEvent & { isError?: boolean; content?: unknown };
/**
 * pi's `session_start` carries no entries (`types.d.ts:416-422`): the session log
 * is reached through the context, and custom entries arrive as
 * `{ type: "custom", customType, data }` (`session-manager.d.ts:69-73`).
 */
type SessionEntry = { type?: string; customType?: string; data?: unknown };
type SessionStartContext = { sessionManager?: { getEntries?(): SessionEntry[] } };
type AgentStartEvent = { systemPrompt?: unknown };

/** The slice of pi's API this extension uses. Declared locally: no pi import. */
type PiApi = {
  on(event: string, handler: (event: never) => unknown): void;
  appendEntry?(type: string, data?: unknown): void;
  registerTool?(name: string, options: unknown): void;
};

const INTENTS: readonly Intent[] = ["read-only", "change"];
const ROUTES: readonly Route[] = ["inline", "tracked", "forge"];

/** `.nodd/<slug>/feature.md` — the durable, extension-owned NODD artifact. */
export function featureDocPath(cwd: string, slug: string): string {
  return join(cwd, ".nodd", slug, "feature.md");
}

export type ToolReply = { ok: boolean; text: string };

export type DeclareArgs = {
  intent: Intent;
  route: Route;
  slug: string;
  summary: string;
  title?: string;
  /** The verification command. `gate-evidence` accepts runs of this and nothing else. */
  runner?: string;
  tdd?: "strict" | "off";
  /** The files this work says it will touch. `gate-promotion` compares against it. */
  files?: string[];
};

export type TaskArgs = {
  action: "add" | "check" | "reopen";
  id: string;
  title?: string;
  slug: string;
  /** Required to reopen a checked task (`routing.go:97`). */
  reason?: string;
};

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : String((part as { text?: string })?.text ?? ""))).join("\n");
  }
  return content === undefined || content === null ? "" : String(content);
}

export type Kernel = {
  state: NoddState;
  /**
   * Record a classification. On a `tracked`/`forge` route it creates the
   * feature doc and returns ODD's one-line report (`routing.go:49`). The model
   * supplies fields, never document text: a doc the model can author is a doc
   * the model can forge, and then evidence is prose again.
   */
  declare(args: DeclareArgs): ToolReply;
  /** Add or check off a task. The extension renders the doc. */
  task(args: TaskArgs): ToolReply;
  onToolCall(event: ToolCallEvent): void;
  onToolResult(event: ToolResultEvent): Observation;
  /**
   * Rebuild what a new process can legitimately know from a previous one.
   *
   * Everything a gate needs for *context* comes back: the declaration, the files
   * read and written, the delegation and tool-call counters. What deliberately
   * does **not** come back is evidence — `commandResults`, which is what
   * `gate-evidence` reads.
   *
   * Round 1 replayed those too, so a resumed process with zero commands run
   * checked tasks off while the README promised the opposite. The entries are
   * not forgeable by the model — the kernel writes them from real tool results,
   * and `gate-track` refuses model writes into `.nodd/` — but "not forged" is a
   * weaker claim than "observed here", and evidence is the one place NODD
   * insists on the stronger one. A run this process did not see is a report
   * about the past; the remedy is one command.
   */
  replay(entries: SessionEntry[] | undefined): void;
  /**
   * The evidence view. It returns `Committed` — not `NoddState` — so a gate
   * reading evidence physically cannot see a sibling call that has not
   * finished. The hazard is made unrepresentable rather than documented.
   */
  evidenceView(): Committed;
  /** Run the ordered registry against one call. `null` means let it run. */
  checkCall(request: GateRequest): { block: true; reason: string } | null;
  setPolicy(policy: Policy): void;
  policy(): Policy;
};

export function createKernel(
  now: () => string = () => new Date().toISOString(),
  cwd: string = process.cwd(),
): Kernel {
  const state = emptyState();
  // Mutable because `/nodd-allow` grants a hatch mid-session and a refusal
  // spends it. The policy is session state, not a constant.
  let policy: Policy = emptyPolicy();

  const readDoc = (slug: string): FeatureDoc | null => {
    const path = featureDocPath(cwd, slug);
    if (!existsSync(path)) return null;
    return parseFeatureDoc(readFileSync(path, "utf8")).doc;
  };

  const saveDoc = (doc: FeatureDoc): ToolReply => {
    const path = featureDocPath(cwd, doc.slug);
    const previous = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    const result = writeVerified(path, renderFeatureDoc(doc), { expectedPrevious: previous });
    if (!result.ok) return { ok: false, text: `nodd: ${result.limitation}` };
    const conflict = result.conflictPath ? ` (previous version preserved at ${result.conflictPath})` : "";
    return { ok: true, text: `.nodd/${doc.slug}/feature.md created with ${doc.tasks.length} tasks${conflict}` };
  };

  return {
    state,

    declare(args) {
      if (!INTENTS.includes(args.intent)) {
        return { ok: false, text: `nodd_declare: intent must be one of ${INTENTS.join(", ")}` };
      }
      if (!ROUTES.includes(args.route)) {
        return { ok: false, text: `nodd_declare: route must be one of ${ROUTES.join(", ")}` };
      }
      if (!args.slug) return { ok: false, text: "nodd_declare: slug is required" };

      // `inline` is small, understood work: it creates no durable artifact
      // (`routing.go:94`). Only tracked and forge routes get a feature doc.
      if (args.route === "inline") {
        return { ok: true, text: `route inline declared for ${args.slug}; no feature document created` };
      }

      const existing = readDoc(args.slug);
      const doc = existing ?? emptyDoc({ slug: args.slug, title: args.title || args.slug });
      doc.objective = args.summary;
      doc.route = { intent: args.intent, route: args.route };
      // Declared once and written by the extension, so the runner a checkoff is
      // measured against is not a string the model can pick per checkoff.
      doc.verification = {
        runner: args.runner && args.runner !== "" ? args.runner : null,
        tdd: args.tdd === "strict" ? "strict" : "off",
        source: "nodd_declare",
        files: [...new Set((args.files ?? []).filter((file) => typeof file === "string" && file !== ""))],
      };
      return saveDoc(doc);
    },

    task(args) {
      const doc = readDoc(args.slug);
      if (!doc) {
        return { ok: false, text: `nodd_task: no feature document for ${args.slug}; call nodd_declare first` };
      }

      if (args.action === "add") {
        if (doc.tasks.some((t) => t.id === args.id)) {
          return { ok: false, text: `nodd_task: ${args.id} already exists` };
        }
        doc.tasks.push({ id: args.id, title: args.title ?? args.id, checked: false });
        const saved = saveDoc(doc);
        return saved.ok ? { ok: true, text: `${args.id} added to .nodd/${doc.slug}/feature.md` } : saved;
      }

      if (args.action === "reopen") {
        const reopened = reopenTask(doc, args.id, args.reason ?? "");
        if (!reopened.ok) return { ok: false, text: `nodd_task: ${reopened.problem}` };
        const saved = saveDoc(reopened.doc);
        return saved.ok ? { ok: true, text: `${args.id} reopened in .nodd/${doc.slug}/feature.md` } : saved;
      }

      const index = doc.tasks.findIndex((t) => t.id === args.id);
      if (index < 0) return { ok: false, text: `nodd_task: ${args.id} is not in the document` };

      // A checkoff is gated like any other claim: the evidence gate answers
      // from observed command results, and what it returns is what gets
      // written. NODD never invents a command it did not see run.
      const ledger = ledgerPath(cwd, doc.slug);
      const { records } = readLedger(ledger);
      const verdict = evidenceGate(
        state.committed,
        records,
        {
          task: args.id,
          // The task's own files when it declared some, the whole session's
          // writes otherwise. Either way a real timestamp, not a bash proxy.
          ...lastWrite(state.committed, doc.verification.files),
          runner: doc.verification.runner,
          ...(doc.verification.tdd === "strict" && doc.verification.runner
            ? { tdd: { mode: "strict" as const, source: doc.verification.source, runner: doc.verification.runner } }
            : {}),
        },
        policy,
      );
      if (!verdict.allow) return { ok: false, text: verdict.reason };

      // Record the evidence this checkoff relied on. Without this call the
      // ledger never exists, `readLedger` always returns `[]`, and every
      // integrity rule the README documents is unreachable code.
      const used = state.committed.commandResults.find((run) => run.toolCallId === verdict.observed.toolCallId);
      if (used) {
        try {
          appendRecord(ledger, {
            toolCallId: used.toolCallId,
            tool: "bash",
            command: used.command,
            outcome: parseOutcome(used.isError, used.resultText),
            at: used.at,
          });
        } catch {
          // A ledger NODD cannot write is a reported limitation, not a reason to
          // discard a checkoff the gate already allowed on observed evidence.
        }
      }

      // The candidate is the observed commit SHA, or `pending-commit` when this
      // session has seen no commit. Never the checkbox (`routing.go:51`,`:102`).
      const task = doc.tasks[index];
      doc.tasks[index] = {
        id: task.id,
        title: task.title,
        checked: true,
        evidence: { command: verdict.observed.command, outcome: verdict.observed.outcome },
        candidate: candidateIdentity(candidateFor(state.committed)),
      };
      const saved = saveDoc(doc);
      return saved.ok ? { ok: true, text: `${args.id} checked in .nodd/${doc.slug}/feature.md` } : saved;
    },

    checkCall(request) {
      // Registry order, first refusal wins: one call never collects two
      // messages about the same missing declaration.
      const decisions: Array<[(typeof GATE_IDS)[number], () => GateDecision]> = [
        ["authorize", () => authorizeGate(state.committed, request, policy)],
        ["classify", () => classifyGate(state.committed, request, policy, state.pending)],
        ["track", () => trackGate(state.committed, request, policy, (slug) => existsSync(featureDocPath(cwd, slug)))],
        ["delegate", () => delegateGate(state.committed, request, policy, state.pending)],
        ["promotion", () => promotionGate(promotionSignals(state.committed, request), request, policy)],
      ];

      for (const [gate, evaluate] of decisions) {
        const decision = evaluate();
        if (decision.allow) continue;

        // A one-shot override is spent by the refusal it prevents — never
        // implicitly, never across gates, never twice.
        const hatch = consumeHatch(policy, gate);
        if (hatch) {
          policy = hatch.policy;
          return null;
        }
        // `terminate` is deliberately never set: a blocked call stops that
        // call, not the agent.
        return { block: true, reason: decision.reason };
      }
      return null;
    },

    setPolicy(next) {
      policy = next;
    },

    policy() {
      return policy;
    },

    onToolCall(event) {
      state.pending.set(event.toolCallId, pendingCall({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input ?? {},
      }));
    },
    onToolResult(event) {
      state.pending.delete(event.toolCallId);
      const obs = observation({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input ?? {},
        isError: event.isError === true,
        resultText: resultText(event.content),
        at: now(),
      });
      state.committed = fold(state.committed, obs);
      return obs;
    },
    replay(entries) {
      for (const entry of entries ?? []) {
        const isNodd = entry?.customType === OBSERVATION_ENTRY || entry?.type === OBSERVATION_ENTRY;
        if (!isNodd) continue;
        const data = entry.data as Observation | undefined;
        if (!data?.toolCallId) continue;

        state.committed = fold(state.committed, observation(data));
        // The context is rebuilt; the evidence is not. A command another process
        // observed is not a command this one observed.
        state.committed = { ...state.committed, commandResults: [] };
      }
    },
    evidenceView() {
      return state.committed;
    },
  };
}

const DECLARE_SCHEMA = {
  description:
    "Declare the authorized intent and implementation route for this request. On a tracked or forge route NODD creates .nodd/<slug>/feature.md and reports it in one line.",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string", enum: INTENTS, description: "read-only work never writes" },
      route: { type: "string", enum: ROUTES, description: "inline stays small; tracked and forge create a feature document" },
      slug: { type: "string", description: "filename-safe feature identity" },
      summary: { type: "string", description: "the objective, in one or two sentences" },
      title: { type: "string", description: "human-readable feature title" },
      runner: {
        type: "string",
        description:
          "the verification command for this feature, e.g. `npm test`. Only observed runs of this command can check a task off; declare it now, because you cannot choose it later.",
      },
      tdd: { type: "string", enum: ["strict", "off"], description: "strict requires an observed failing run before a checkoff" },
      files: {
        type: "array",
        items: { type: "string" },
        description: "the files this work will touch; writing more distinct files than declared escalates to promotion",
      },
    },
    required: ["intent", "route", "slug", "summary"],
  },
};

const TASK_SCHEMA = {
  description:
    "Add a task to the feature document, check one off, or reopen a checked one. NODD writes the document; you never edit it directly.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "check", "reopen"] },
      id: { type: "string", description: "stable task id, e.g. T1" },
      title: { type: "string", description: "required when adding" },
      slug: { type: "string", description: "the feature slug" },
      reason: { type: "string", description: "required when reopening: why the completed result no longer holds" },
    },
    required: ["action", "id", "slug"],
  },
};

/** pi's tool input, as a plain object a gate can read. */
function normalizeInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function ledgerPath(cwd: string, slug: string): string {
  return join(cwd, ".nodd", slug, "ledger.json");
}

/**
 * The most recent observed write that evidence must postdate.
 *
 * Reads `filesWritten`, which is where writes actually are. Round 1 read
 * `commandResults` — bash only — so a `write`/`edit` after a green run moved
 * nothing, and the stale run certified the edit it predated.
 *
 * Scoped to the declared files when there are any: a task is certified by a run
 * postdating *its* edits, not every edit in the session.
 */
function lastWrite(committed: Committed, declaredFiles: string[] = []): { lastWriteAt: string; lastWriteSeq: number } {
  const relevant = declaredFiles.length > 0
    ? [...committed.filesWritten].filter(([path]) => declaredFiles.includes(path))
    : [...committed.filesWritten];

  let latest = { at: new Date(0).toISOString(), seq: 0 };
  for (const [, write] of relevant) {
    if (write.seq > latest.seq) latest = write;
  }
  return { lastWriteAt: latest.at, lastWriteSeq: latest.seq };
}

/**
 * What `gate-promotion` may look at, derived from what this kernel observed.
 *
 * Round 1 returned zeroes here with a comment saying a fabricated signal is
 * worse than an absent one — which was right, and was then used to justify
 * shipping the gate wired to constants, so it could never fire. Both real
 * signals are derivable from state the kernel already holds:
 *
 *   - `declaredFiles` from the declaration's own file list;
 *   - `observedFiles` from `filesWritten`;
 *   - `consecutiveFailures` from the trailing non-success runs of the declared
 *     runner, which is the only command whose failures say the plan is wrong.
 *
 * The third specified signal, "the user asked", was not derivable and has been
 * removed from the product rather than faked (see `src/gates/promotion.ts`).
 */
function promotionSignals(committed: Committed, request: GateRequest) {
  const declaration = committed.declaration;
  const runner = declaration?.runner ?? null;

  // Only runs of the declared runner count, and only the trailing streak: a
  // failing `grep` is not a failing plan, and a success clears the streak.
  let consecutiveFailures = 0;
  if (runner !== null) {
    for (let i = committed.commandResults.length - 1; i >= 0; i--) {
      const run = committed.commandResults[i];
      if (!isDeclaredRunner(run.command, runner)) continue;
      if (isSuccess(parseOutcome(run.isError, run.resultText))) break;
      consecutiveFailures += 1;
    }
  }

  // The file this call is about to write counts too. Write intent is known at
  // preflight, and a gate that only saw finished writes would refuse the
  // divergence one file late — after the divergent write already happened.
  const files = new Set(committed.filesWritten.keys());
  const target = targetPath(request);
  if (target && isFileWrite(request)) files.add(target);

  return {
    slug: declaration?.slug ?? "",
    consecutiveFailures,
    failedTaskId: consecutiveFailures > 0 ? runner : null,
    declaredFiles: declaration?.files.length ?? 0,
    observedFiles: files.size,
  };
}

/** Gate flags as configured. An unreadable config means nobody chose. */
function readPolicy(): Policy {
  try {
    const { config } = parseConfig(readFileSync(noddConfigPath(), "utf8"));
    return { ...emptyPolicy(), config: config.gates };
  } catch {
    return emptyPolicy();
  }
}

export default function register(pi?: PiApi, cwd: string = process.cwd()): Kernel {
  const kernel = createKernel(undefined, cwd);
  if (!pi || typeof pi.on !== "function") return kernel;

  // Flags the user set persist into the session's policy. `/nodd-allow` adds
  // one-shot hatches on top of this at runtime.
  kernel.setPolicy(readPolicy());

  pi.registerTool?.("nodd_declare", {
    ...DECLARE_SCHEMA,
    handler: (args: DeclareArgs) => kernel.declare(args).text,
  });
  pi.registerTool?.("nodd_task", {
    ...TASK_SCHEMA,
    handler: (args: TaskArgs) => kernel.task(args).text,
  });

  // Enforcement. The gates are useless unless they run here: this is the only
  // point in a session where NODD can refuse a call before it happens.
  pi.on("tool_call", ((event: ToolCallEvent) => {
    let decision: { block: true; reason: string } | null = null;
    try {
      decision = kernel.checkCall({ toolName: event?.toolName ?? "", input: normalizeInput(event?.input) });
    } catch {
      // A gate that throws must not break the session. Failing open here is
      // deliberate: NODD refuses work it understands, never work it crashed on.
      decision = null;
    }
    // Record the call either way. A refused call still happened, and the
    // counters that decide the next refusal must see it.
    kernel.onToolCall(event);
    return decision ?? undefined;
  }) as never);

  pi.on("tool_result", ((event: ToolResultEvent) => {
    const obs = kernel.onToolResult(event);
    try {
      pi.appendEntry?.(OBSERVATION_ENTRY, obs);
    } catch {
      // Session persistence is best effort: the durable truth is on disk.
    }
  }) as never);

  pi.on("session_start", ((_event: unknown, ctx: SessionStartContext) => {
    kernel.replay(ctx?.sessionManager?.getEntries?.());
  }) as never);

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
