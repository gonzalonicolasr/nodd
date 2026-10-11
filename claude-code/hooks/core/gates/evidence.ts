// gate-evidence — the one that makes the rest worth having.
//
// ODD says "evidence is what you observed, not what you expect" and then lets
// the model write `Evidence: tests pass` with nothing behind it. Here a checkoff
// is refused unless a `success` outcome was observed, from a real command, after
// the task's last write.
//
// Four independent facts must line up, and each is checked against observation
// rather than assertion:
//
//   1. a command ran           — a `tool_result`, not an assistant sentence
//   2. it succeeded            — `isError === false`, i.e. exit 0 by pi's
//                                construction; `exit`/`aborted`/`timeout`/
//                                `unknown` never qualify (T019)
//   3. it ran after the edit   — a green run predating the change proves
//                                nothing about the change
//   4. it was *the declared check* — the runner recorded at declaration time,
//                                not whatever string the model picked
//
// Fact 4 is what makes the other three worth having. pi's bash tool exits 0 for
// `echo 'I have verified that all tests pass'` just as it does for `npm test`,
// so a gate that accepts any exit-0 accepts the model's own sentence wearing a
// command's clothes — `Evidence: tests pass` again, now in NODD's format. The
// model does not choose the runner: it is declared once, lands in the feature
// doc's `## Verification` section, and the gate compares against it.
//
// Honest limit: when no runner was declared, fact 4 cannot be checked and is
// skipped rather than faked. The artifact says so in the evidence line itself —
// `success (runner not pinned)` — because a reader auditing a checkoff has to
// be able to tell a run certified by the declared runner from one certified by
// whatever exit-0 string was handy. Saying it only in `## Verification` leaves
// the line that is actually read indistinguishable from a pinned one.
//
// Plus a fourth, per the ledger integrity rule: the record must be one this
// kernel observed. A record on disk is a claim about the past; only the
// committed observation set makes it evidence.
//
// With the gate off the checkoff proceeds but the artifact says
// `observed: none (gate disabled)`. A disabled gate may stop enforcing; it may
// not make the document assert something that was never verified.

import type { Committed } from "../state.ts";
import { classifyBash } from "../bash-classifier.ts";
import { classifyRecords, describeDegraded, type LedgerRecord } from "../ledger-core.ts";
import { describeOutcome, isSuccess, parseOutcome } from "../outcome.ts";
import { refuse, resolveFlag, type Policy, type Remedy } from "./policy.ts";

export type TddContext = { mode: "strict" | "off"; source: string; runner: string };

export type CheckRequest = {
  task: string;
  /** When the task's last observed write happened. Evidence must postdate it. */
  lastWriteAt: string;
  /**
   * That write's position in observation order. Two tool results can share a
   * millisecond, so the ordering is decided here and `lastWriteAt` is what the
   * refusal quotes. `0` means nothing has been written yet.
   */
  lastWriteSeq?: number;
  /** The declared verification command. `null` when the declaration pinned none. */
  runner: string | null;
  tdd?: TddContext;
};

export type ObservedEvidence = {
  command: string;
  outcome: string;
  at?: string;
  /** The call this evidence came from, so the caller can record exactly it. */
  toolCallId?: string;
  tdd?: TddContext;
};

export type EvidenceDecision =
  | { allow: true; observed: ObservedEvidence }
  | { allow: false; gate: "evidence"; reason: string; remedy: Remedy };

const REMEDY = "run the verification command, then check the task off once it is observed to succeed";

/**
 * Whether an observed command *is* the declared runner. Prefix match on whole
 * tokens, so `npm test -- src/login.test.ts` counts and `echo npm test` does
 * not: a runner narrowed to one file is the ordinary way a task verifies
 * itself, while the runner quoted inside another command is not a run of it.
 *
 * Exported because `gate-promotion`'s failure streak counts runs of the same
 * declared runner, and the two gates must agree on what "a run of it" means.
 */
export function splitCd(command: string): { dir: string | null; rest: string } {
  let rest = command.trimStart();
  let dir: string | null = null;
  for (let m = /^cd\s+(\S+)\s*&&\s*/.exec(rest); m; m = /^cd\s+(\S+)\s*&&\s*/.exec(rest)) {
    dir = m[1].replace(/^["']|["']$/g, "");
    rest = rest.slice(m[0].length);
  }
  return { dir, rest };
}

function sameDir(a: string, b: string): boolean {
  const clean = (d: string) => d.replace(/^\$HOME(?=\/|$)/, "~").replace(/\/+$/, "");
  const x = clean(a);
  const y = clean(b);
  if (x === y) return true;
  const tilde = x.startsWith("~") ? x : y.startsWith("~") ? y : null;
  const other = tilde === x ? y : x;
  return tilde !== null && other.startsWith("/") && other.endsWith(tilde.slice(1)) && /^\/home\/[^/]+$|^\/root$/.test(other.slice(0, other.length - tilde.length + 1));
}

export function isDeclaredRunner(command: string, runner: string): boolean {
  const run = splitCd(command);
  const want = splitCd(runner);
  if (run.dir !== null && want.dir !== null && !sameDir(run.dir, want.dir)) return false;
  const actual = run.rest.trim().split(/\s+/);
  const declared = want.rest.trim().split(/\s+/);
  if (declared.length === 0 || actual.length < declared.length) return false;
  const last = declared.length - 1;
  return declared.every((token, i) => actual[i] === token || (i === last && actual[i].startsWith(token) && /^[;|&]/.test(actual[i].slice(token.length))));
}

export function writesByBash(command: string, runner: string | null): boolean {
  if (runner !== null && isDeclaredRunner(command, runner)) return false;
  const rest = command
    .split(/&&|\|\||;|\n/)
    .filter((segment) => !/^\s*git\s+(commit|push|tag|add)\b/.test(segment))
    .join("\n");
  return classifyBash(rest) === "mutating";
}

export function masksExitStatus(command: string, runner: string): boolean {
  let rest = splitCd(command).rest;
  for (const token of splitCd(runner).rest.trim().split(/\s+/)) rest = rest.slice(token.length).replace(/^[ \t]+/, "");
  let quote: string | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "|" || ch === ";" || ch === "\n") return true;
    else if (ch === "&") {
      if (rest[i + 1] === "&") i += 1;
      else if (rest[i - 1] !== ">" && rest[i + 1] !== ">") return true;
    }
  }
  return false;
}

function deny(reason: string, remedy: string = REMEDY): EvidenceDecision {
  const refusal = refuse("evidence", reason, remedy);
  return { allow: false, gate: "evidence", reason: refusal.reason, remedy: refusal.remedy };
}

/**
 * What runs before the declared runner, when the runner is there but not first.
 *
 * `grep -rn "npm test" README.md` contains the runner as *data*, not as a
 * command, so it gets no explanation — the near miss worth naming is the one
 * where the runner really would have run had nothing preceded it.
 */
function prefixBeforeRunner(command: string, runner: string): string | null {
  const at = command.indexOf(runner);
  if (at <= 0) return null;
  const before = command.slice(0, at);
  // The runner is an argument, not a command, when a quote or a flag precedes
  // it (`git commit -m "…npm test…"`) or when a quote is still open anywhere
  // before it. Only a prefix that ends where a command can start counts.
  if (/["'=]\s*$/.test(before)) return null;
  const quotes = (before.match(/"/g) ?? []).length + (before.match(/'/g) ?? []).length;
  if (quotes % 2 === 1) return null;
  const trimmed = before.trim();
  if (trimmed === "") return null;
  // `echo npm test` prints it; nothing ran. A prefix that only writes its
  // arguments out is not a wrapper, and telling the reader to remove it would
  // be advice about a command they never meant as a run.
  if (/^(echo|printf|cat|grep|rg|git commit)\b/.test(trimmed)) return null;
  return trimmed;
}

export function evidenceGate(
  committed: Committed,
  ledger: LedgerRecord[],
  request: CheckRequest,
  policy: Policy,
): EvidenceDecision {
  if (!resolveFlag("evidence", policy).enabled) {
    return { allow: true, observed: { command: "none", outcome: "none (gate disabled)" } };
  }

  const runs = committed.commandResults.map((result) => ({
    ...result,
    outcome: parseOutcome(result.isError, result.resultText),
  }));

  // A ledger record this kernel did not observe is unverified, not evidence; one
  // it *did* observe and that says something else is a mismatch, which is a
  // different and more serious failure. Passing the observed calls is what makes
  // the second branch reachable at all.
  const observedIds = new Set(runs.map((run) => run.toolCallId));
  const observedCalls = new Map(runs.map((run) => [
    run.toolCallId,
    { command: run.command, outcome: describeOutcome(run.outcome) },
  ]));
  const { degraded } = classifyRecords(ledger, observedIds, observedCalls);

  const contradicted = degraded.filter((entry) => entry.reason === "mismatch");
  if (contradicted.length > 0) {
    // Fail closed and say which way: the ledger on disk disagrees with what this
    // process watched happen, so neither can be trusted to back a checkoff.
    return deny(
      `the ledger contradicts this session's observations: ${describeDegraded(contradicted).join(" ")}`,
      "re-run the verification command so a fresh, observed result replaces the contradicted record",
    );
  }

  if (runs.length === 0 && degraded.length > 0) {
    // Resuming in a new process lands here every time, by design: evidence
    // means "observed by this kernel", and a fresh process has observed
    // nothing yet. Correct, but a bare "insufficient evidence" would read as a
    // bug and get the gate switched off, so the refusal says what happened and
    // what to do about it.
    return deny(
      `the ledger holds ${degraded.length} record(s) from a previous session, which this kernel did not observe, so they are unverified and cannot support a checkoff`,
      "re-run the verification command in this session so the result is observed, then check the task off",
    );
  }

  if (runs.length === 0) {
    return deny(`no command has been observed running for ${request.task}, so there is nothing to record as evidence`);
  }

  // The declared check, before success is even considered: a green `echo` is
  // not a failing test run, it is not a test run at all.
  const relevant = request.runner === null
    ? runs
    : runs.filter((run) => isDeclaredRunner(run.command, request.runner!));
  if (relevant.length === 0) {
    const recent = runs.slice(-3).map((run) => `\`${brief(run.command)}\``).join(", ");
    const observed = runs.length > 3 ? `${recent} and ${runs.length - 3} earlier` : recent;
    // Naming what was observed is not the same as saying why it did not
    // count. A real session lost two cycles to `timeout 120 npm test | tail`:
    // the message held the evidence and made the reader derive the rule.
    //
    // The rule has to be the true one. `isDeclaredRunner` matches a prefix, so
    // this branch is about what comes *before* the runner; what hides its exit
    // status after it is refused further down, by `masksExitStatus`. An earlier version of this message
    // blamed the pipe, which would send the reader to strip the pipe, land on
    // `timeout 120 npm test`, and be refused again.
    const prefixed = runs
      .map((run) => prefixBeforeRunner(run.command, request.runner!))
      .find((prefix): prefix is string => prefix !== null);
    return deny(
      `this feature declared \`${request.runner}\` as its verification runner, and no observed command was a run of it (observed: ${observed})` +
        (prefixed
          ? `. \`${prefixed}\` runs before it, and a runner reached through another command is not the runner: NODD reads the command it was given, not what the shell eventually resolved`
          : ""),
      prefixed
        ? `run \`${request.runner}\` with nothing before it and nothing after it that hides its exit status (a redirect or \`&&\` is fine; \`|\`, \`;\` and \`||\` are not), then check ${request.task} off once it is observed to succeed`
        : `run \`${request.runner}\`, then check ${request.task} off once it is observed to succeed`,
    );
  }

  const trusted = request.runner === null ? relevant : relevant.filter((run) => !masksExitStatus(run.command, request.runner!));
  if (trusted.length === 0) {
    const last = relevant[relevant.length - 1];
    return deny(
      `every observed run of \`${request.runner}\` hid its exit status (last: \`${brief(last.command)}\`): after \`|\`, \`;\`, \`||\` or \`&\` the status NODD sees belongs to another command, so a failing run can look like a success`,
      `run \`${request.runner}\` with only redirects or \`&&\` after it; to keep the output short, redirect it to a file and read the file with a second command, then check ${request.task} off`,
    );
  }

  const green = trusted.filter((run) => isSuccess(run.outcome));
  if (green.length === 0) {
    const last = trusted[trusted.length - 1];
    return deny(`the last observed run of \`${brief(last.command)}\` ended ${describeOutcome(last.outcome)}, which is not success`);
  }

  const afterWrite = green.filter((run) => run.seq > (request.lastWriteSeq ?? 0) && run.at >= request.lastWriteAt);
  if (afterWrite.length === 0) {
    const last = green[green.length - 1];
    return deny(
      `the only observed success (\`${brief(last.command)}\`) ran before the last write to ${request.task}, so it says nothing about the current code`,
    );
  }

  if (request.tdd?.mode === "strict") {
    const chosen = afterWrite[afterWrite.length - 1];
    const red = trusted.find((run) => !isSuccess(run.outcome) && run.at <= chosen.at);
    if (!red) {
      return deny(
        `TDD mode is strict (${request.tdd.source}) but no failing (RED) run was observed before this success, so the test was never seen to fail first`,
      );
    }
  }

  const chosen = afterWrite[afterWrite.length - 1];
  return {
    allow: true,
    observed: {
      command: chosen.command,
      outcome: request.runner === null
        ? `${describeOutcome(chosen.outcome)} (runner not pinned)`
        : describeOutcome(chosen.outcome),
      at: chosen.at,
      toolCallId: chosen.toolCallId,
      ...(request.tdd?.mode === "strict" ? { tdd: request.tdd } : {}),
    },
  };
}

export function brief(command: string): string {
  const line = command.split("\n")[0];
  if (line.length > 120) return `${line.slice(0, 120)}…`;
  return line === command ? command : `${line}…`;
}

/** The feature doc's evidence line. Never rendered from anything but a decision. */
export function renderObserved(observed: ObservedEvidence | null): string {
  if (!observed) return "observed: none";
  if (observed.outcome === "none (gate disabled)") return "observed: none (gate disabled)";
  return `observed: \`${observed.command}\` → ${observed.outcome}`;
}
