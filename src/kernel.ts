import { observation, pendingCall, type Observation } from "./observations.ts";
import { emptyState, fold, type Committed, type NoddState } from "./state.ts";
import {
  emptyDoc,
  parseFeatureDoc,
  renderFeatureDoc,
  ROUTES,
  type FeatureDoc,
  type Intent,
  type Route,
} from "./feature-doc.ts";
import { writeVerified, type Fs } from "./io-core.ts";
import { consumeHatch, emptyPolicy, type GateDecision, type Policy } from "./gates/policy.ts";
import { hatchPath, parseConfig, noddConfigPath } from "./config-core.ts";
import { GATE_IDS } from "./gates/registry.ts";
import { authorizeGate, type CapabilityLookup } from "./gates/authorize.ts";
import { classifyGate } from "./gates/classify.ts";
import { trackGate } from "./gates/track.ts";
import { delegateGate } from "./gates/delegate.ts";
import { evidenceGate, isDeclaredRunner } from "./gates/evidence.ts";
import { promotionGate } from "./gates/promotion.ts";
import { isFileWrite, targetPath, type GateRequest } from "./gates/request.ts";
import { appendRecord, readLedger } from "./ledger-core.ts";
import { isSuccess, parseOutcome } from "./outcome.ts";
import { candidateFor, candidateIdentity } from "./review-candidate.ts";
import { reopenTask } from "./change-acceptance.ts";
import type { TaskProgress } from "./status.ts";
import { joinPath } from "./path.ts";

/** The NODD entry type appended to the session so a reload can rebuild state. */
export const OBSERVATION_ENTRY = "nodd:observation";

export type ToolCallEvent = { toolName: string; toolCallId: string; input?: Record<string, unknown> };
export type ToolResultEvent = ToolCallEvent & { isError?: boolean; content?: unknown };
/**
 * pi's `session_start` carries no entries (`types.d.ts:416-422`): the session log
 * is reached through the context, and custom entries arrive as
 * `{ type: "custom", customType, data }` (`session-manager.d.ts:69-73`).
 */
export type SessionEntry = { type?: string; customType?: string; data?: unknown };

const INTENTS: readonly Intent[] = ["read-only", "change"];

/** `.nodd/<slug>/feature.md` — the durable, extension-owned NODD artifact. */
export function featureDocPath(cwd: string, slug: string): string {
  return joinPath(cwd, ".nodd", slug, "feature.md");
}

export type ToolReply = { ok: boolean; text: string };

export type DeclareArgs = {
  intent: Intent;
  route: Route;
  slug: string;
  summary: string;
  title?: string;
  /** Read by `/nodd-promote` into the forge handoff. Optional: a small fix owes no problem statement. */
  problem?: string;
  scope?: string;
  constraints?: string;
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
  /** Drop a call that produced no effect, because pi reports no result for it. */
  forgetPending(toolCallId: string): void;
  /** Drop every in-flight call at a turn boundary, where none can still report. */
  forgetAllPending(): void;
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
  /** Checked-vs-total for the declared slug, or null when there is no task list. */
  taskProgress(): TaskProgress | null;
  /** Run the ordered registry against one call. `null` means let it run. */
  checkCall(request: GateRequest): { block: true; reason: string } | null;
  setPolicy(policy: Policy): void;
  /** Re-read the configured flags, keeping runtime flags and hatches. */
  reloadPolicy(): Policy;
  policy(): Policy;
};


export type KernelOptions = {
  fs: Fs;
  cwd: string;
  now?: () => string;
  loadPolicy?: () => Policy;
  isReadOnlyAgent?: CapabilityLookup;
  // Injected like `docExists` and `isReadOnlyAgent`: the kernel decides a hatch
  // was spent, the caller owns where that fact is persisted.
  spendHatch?: (gate: string) => void;
};

export function createKernel(options: KernelOptions): Kernel {
  const { fs, cwd } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const loadPolicy = options.loadPolicy ?? emptyPolicy;
  const isReadOnlyAgent = options.isReadOnlyAgent ?? (() => null);
  const spendHatch = options.spendHatch ?? (() => {});
  const state = emptyState();
  // Mutable because `/nodd-allow` grants a hatch mid-session and a refusal
  // spends it. The policy is session state, not a constant.
  let policy: Policy = emptyPolicy();
  // Set by `setPolicy`: the caller owns the whole policy from then on, and
  // `reloadPolicy` stops re-reading the file over their choice.
  let policyIsPinned = false;

  const readDoc = (slug: string): FeatureDoc | null => {
    const path = featureDocPath(cwd, slug);
    if (!fs.existsSync(path)) return null;
    return parseFeatureDoc(fs.readFileSync(path, "utf8")).doc;
  };

  const saveDoc = (doc: FeatureDoc): ToolReply => {
    const path = featureDocPath(cwd, doc.slug);
    const previous = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : undefined;
    const result = writeVerified(path, renderFeatureDoc(doc), { fs, expectedPrevious: previous });
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

      // "Declared up front" is only a property if it cannot be re-declared
      // afterwards. Re-declaring rewrote `## Verification` wholesale, so a
      // refused checkoff was repaired by naming the command that did pass as
      // the runner -- the round-1 echo attack with one extra step. A runner is
      // pinned once; changing it means a new feature, or `/nodd-allow`.
      const requested = args.runner && args.runner !== "" ? args.runner : null;

      // Strict TDD is "a RED run of the declared runner before the GREEN". With
      // no runner there is no such run to require, and the gate silently
      // skipped the check while the document still read `- tdd: strict`. A doc
      // asserting a discipline nothing enforces is the exact failure NODD
      // exists to prevent, so the declaration is refused instead.
      if (args.tdd === "strict" && (requested ?? doc.verification.runner) === null) {
        return {
          ok: false,
          text: "nodd_declare: tdd: strict requires a runner, because a RED run is a failing run of the declared runner. Declare one, or declare tdd: off.",
        };
      }

      // The runner is pinned once; the discipline it is run under has to be
      // pinned the same way. Omitting `tdd` on a re-declaration rewrote the doc
      // to `- tdd: off` silently, and a GREEN with no RED then checked the task
      // off -- the re-pinning attack with one word removed instead of one added.
      if (doc.verification.tdd === "strict" && args.tdd !== "strict") {
        return {
          ok: false,
          text: `nodd_declare: ${args.slug} is pinned to tdd: strict, and dropping the discipline after the work changes what the checkoff means. Re-declare with tdd: strict, or declare a new feature.`,
        };
      }

      if (doc.verification.runner !== null && requested !== null && requested !== doc.verification.runner) {
        return {
          ok: false,
          text: `nodd_declare: ${args.slug} already pinned \`${doc.verification.runner}\` as its verification runner, and a runner chosen after the work is a runner chosen to fit it. To verify differently, declare a new feature.`,
        };
      }

      doc.objective = args.summary;
      // `/nodd-promote` reads these three into the forge handoff
      // (`src/promote.ts:58-60`), where they read "Not recorded in the NODD
      // run" for every feature ever declared, because nothing could fill
      // them. Optional: a small inline fix owes no problem statement, and a
      // document that demands one it cannot get teaches people to ignore it.
      if (args.problem) doc.problem = args.problem;
      if (args.scope) doc.scope = args.scope;
      if (args.constraints) doc.constraints = args.constraints;
      doc.route = { intent: args.intent, route: args.route };
      // Declared once and written by the extension, so the runner a checkoff is
      // measured against is not a string the model can pick per checkoff.
      doc.verification = {
        runner: requested ?? doc.verification.runner,
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
      const { records } = readLedger(ledger, fs);
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
          }, fs);
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
        ["authorize", () => authorizeGate(state.committed, request, policy, isReadOnlyAgent)],
        ["classify", () => classifyGate(state.committed, request, policy, state.pending)],
        ["track", () => trackGate(state.committed, request, policy, (slug) => fs.existsSync(featureDocPath(cwd, slug)))],
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
          spendHatch(gate);
          return null;
        }
        // `terminate` is deliberately never set: a blocked call stops that
        // call, not the agent.
        return { block: true, reason: decision.reason };
      }
      return null;
    },

    reloadPolicy() {
      // Re-read rather than cache: `/nodd-gates off` writes the file, and a
      // policy only read at startup leaves the gate blocking while disk already
      // says it is off — a kill switch the user watches fail.
      //
      // An explicit `setPolicy` wins: it is the caller stating the whole policy,
      // and re-reading over it would silently undo what they just set.
      if (policyIsPinned) return policy;
      // Everything comes from `loadPolicy`: hatches because `/nodd-allow` runs
      // in another module and persists them, CLI flags because they are fixed
      // for the session. Preserving the in-memory copies here would discard an
      // override the moment it was granted, and drop `--nodd-off` on the first
      // reload after startup.
      policy = loadPolicy();
      return policy;
    },

    setPolicy(next) {
      policyIsPinned = true;
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
    forgetPending(toolCallId) {
      state.pending.delete(toolCallId);
    },
    forgetAllPending() {
      state.pending.clear();
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
    taskProgress() {
      // The doc on disk is the source of truth, as everywhere else in NODD:
      // a counter read from memory could disagree with the file the user sees.
      const slug = state.committed.declaration?.slug;
      if (!slug) return null;
      const doc = readDoc(slug);
      if (!doc || doc.tasks.length === 0) return null;
      return { done: doc.tasks.filter((t) => t.checked).length, total: doc.tasks.length };
    },
    evidenceView() {
      return state.committed;
    },
  };
}

export const DECLARE_SCHEMA = {
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
      problem: { type: "string", description: "what is wrong today; read by /nodd-promote into the forge handoff" },
      scope: { type: "string", description: "what this work covers and what it deliberately leaves out" },
      constraints: { type: "string", description: "limits the work must respect: no new dependency, no API change" },
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

export const TASK_SCHEMA = {
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

export function ledgerPath(cwd: string, slug: string): string {
  return joinPath(cwd, ".nodd", slug, "ledger.json");
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

/**
 * Gate flags as configured. An unreadable config means nobody chose.
 *
 * `home` is a parameter, not `homedir()` inside: the tests call `register()`
 * directly, and reading the real `~/.pi/nodd.json` made the suite's verdict
 * depend on the machine running it.
 */
export function readPolicy(fs: Fs, home: string): Policy {
  try {
    const { config } = parseConfig(fs.readFileSync(noddConfigPath(home), "utf8"));
    return { ...emptyPolicy(), config: config.gates, hatches: readHatches(fs, home) };
  } catch {
    return { ...emptyPolicy(), hatches: readHatches(fs, home) };
  }
}

/**
 * Why the config could not be used, if it could not be used.
 *
 * A file that fails to parse resets every gate to its default, which quietly
 * re-enables whatever the user turned off. `parseConfig` already computes the
 * diagnosis; dropping it left the user with gates they had disabled and no
 * reason given.
 */
export function configComplaint(fs: Fs, home: string): string | null {
  const path = noddConfigPath(home);
  if (!fs.existsSync(path)) return null;
  try {
    const { defects } = parseConfig(fs.readFileSync(path, "utf8"));
    if (defects.length === 0) return null;
    return `nodd: ${defects.join("; ")}. Every gate is at its default until this is fixed (${path}).`;
  } catch (err) {
    return `nodd: could not read ${path} (${err instanceof Error ? err.message : String(err)}). Every gate is at its default until this is fixed.`;
  }
}

/**
 * One-shot overrides granted by `/nodd-allow`, which runs in another module.
 * Disk is the only channel between the two, and it is the same channel the
 * gate config already uses.
 */
export function readHatches(fs: Fs, home: string): Policy["hatches"] {
  try {
    const raw = JSON.parse(fs.readFileSync(hatchPath(home), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as Policy["hatches"];
  } catch {
    return {};
  }
}

/** Spend a hatch on disk, so one grant can never excuse two refusals. */
export function clearHatch(fs: Fs, gate: string, home: string): void {
  try {
    const remaining = readHatches(fs, home);
    delete remaining[gate];
    fs.writeFileSync(hatchPath(home), `${JSON.stringify(remaining)}\n`, "utf8");
  } catch {
    // Best effort; the in-memory policy has already dropped it either way.
  }
}
