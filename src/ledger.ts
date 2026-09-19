// `.nodd/<slug>/state.json` — what the extension observed.
//
// Append-only, written atomically through `writeVerified`. Every record carries
// the `toolCallId` of the call it came from: the append API refuses a record
// without one, so model-authored text cannot enter the ledger by construction.
//
// A corrupt file is a reported defect treated as empty. It is never evidence.
//
// ## Observed, not merely written
//
// The feature doc belongs to the user — hand-editing it with `track` off is
// legitimate. The ledger does not: it is the record of what the kernel saw.
// Well-formed JSON on disk proves nothing about whether anything ran, and there
// are two ordinary ways wrong records get there: a human editing the file, and
// a delegated child rewriting it whole (the T010 probe child did exactly that,
// having `write` and no append tool).
//
// So a record counts as evidence only when its `toolCallId` is one this kernel
// committed this session, with the command and outcome it actually observed.
// Everything else is degraded to unverified and reported — never assumed valid,
// never silently dropped. Otherwise "observed" decays into "was written in a
// file", and that is the single thing NODD exists to prevent.
//
// Deliberately not cryptographic. An in-memory id set answers the only question
// worth asking here — did *this* process see it happen — and a signing scheme
// would add key management without changing that answer.

import { writeVerified, nodeFs, type Fs } from "./io.ts";
import { describeOutcome, type Outcome } from "./outcome.ts";

export type LedgerRecord = {
  toolCallId: string;
  tool: string;
  command: string;
  outcome: Outcome;
  at: string;
};

export type ReadResult = { records: LedgerRecord[]; defects: string[] };

export function readLedger(path: string, fs: Fs = nodeFs): ReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch {
    return { records: [], defects: [] };
  }

  try {
    const parsed = JSON.parse(raw) as { records?: unknown };
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    const usable = records.filter(
      (r): r is LedgerRecord => typeof (r as LedgerRecord)?.toolCallId === "string",
    );
    const defects = usable.length === records.length
      ? []
      : [`${path}: ${records.length - usable.length} record(s) without a toolCallId were ignored`];
    return { records: usable, defects };
  } catch {
    return { records: [], defects: [`${path}: not valid JSON, treated as empty (it is not evidence)`] };
  }
}

export function appendRecord(path: string, record: LedgerRecord, fs: Fs = nodeFs): void {
  if (typeof record?.toolCallId !== "string" || record.toolCallId === "") {
    throw new Error("nodd ledger: a record without a toolCallId is not an observation and cannot be appended");
  }

  const { records } = readLedger(path, fs);
  const next = JSON.stringify({ records: [...records, record] }, null, 2);

  const result = writeVerified(path, next, { fs });
  if (!result.ok) throw new Error(`nodd ledger: ${result.limitation}`);
}

export type Degraded = {
  record: LedgerRecord;
  reason: "unobserved" | "mismatch";
  detail: string;
};

/** What the kernel observed for a given call, for cross-checking the file. */
export type ObservedCall = { command: string; outcome: string };

/**
 * Split the ledger into what this kernel can vouch for and what it cannot.
 *
 * Honest limit: a fresh process has an empty observed set, so a pre-existing
 * ledger comes back entirely `unobserved`. That is "unverified", not "proven
 * forged" — the two read differently in a report, and neither counts as
 * success.
 */
export function classifyRecords(
  records: LedgerRecord[],
  observedIds: Set<string>,
  observedCalls: Map<string, ObservedCall> = new Map(),
): { trusted: LedgerRecord[]; degraded: Degraded[] } {
  const trusted: LedgerRecord[] = [];
  const degraded: Degraded[] = [];

  for (const record of records) {
    if (!observedIds.has(record.toolCallId)) {
      degraded.push({
        record,
        reason: "unobserved",
        detail: `${record.toolCallId} was not observed by this session, so it is unverified and does not count as evidence`,
      });
      continue;
    }

    const observed = observedCalls.get(record.toolCallId);
    if (observed) {
      const outcome = describeOutcome(record.outcome);
      if (observed.command !== record.command || observed.outcome !== outcome) {
        degraded.push({
          record,
          reason: "mismatch",
          detail: `${record.toolCallId} on disk says \`${record.command}\` → ${outcome}, but this session observed \`${observed.command}\` → ${observed.outcome}`,
        });
        continue;
      }
    }

    trusted.push(record);
  }

  return { trusted, degraded };
}

/** One line per degraded record, for a refusal message or a status report. */
export function describeDegraded(degraded: Degraded[]): string[] {
  return degraded.map((d) => `- ${d.detail}`);
}
