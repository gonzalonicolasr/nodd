import { test } from "node:test";
import assert from "node:assert/strict";
import { appendRecord, readLedger, classifyRecords, type LedgerRecord } from "./ledger.ts";
import type { Fs } from "./io.ts";

function memoryFs(seed: Record<string, string> = {}): Fs & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readFileSync: (p: string) => {
      const found = files.get(p);
      if (found === undefined) { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return found;
    },
    writeFileSync: (p: string, data: string) => { files.set(p, data); },
    renameSync: (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    existsSync: (p: string) => files.has(p),
    mkdirSync: () => {},
    unlinkSync: (p: string) => { files.delete(p); },
  };
}

const PATH = ".nodd/demo/state.json";

function rec(id: string, command = "npm test"): LedgerRecord {
  return { toolCallId: id, tool: "bash", command, outcome: { kind: "success" }, at: "2026-09-19T10:00:00.000Z" };
}

test("two appends re-read in order", () => {
  const fs = memoryFs();
  appendRecord(PATH, rec("c1", "npm test"), fs);
  appendRecord(PATH, rec("c2", "npm run build"), fs);

  const { records, defects } = readLedger(PATH, fs);
  assert.deepEqual(defects, []);
  assert.deepEqual(records.map((r) => r.toolCallId), ["c1", "c2"]);
  assert.equal(records[1].command, "npm run build");
});

test("a missing ledger is empty and is not a defect", () => {
  const { records, defects } = readLedger(PATH, memoryFs());
  assert.deepEqual(records, []);
  assert.deepEqual(defects, []);
});

test("a truncated file yields a defect and an empty ledger without throwing", () => {
  const { records, defects } = readLedger(PATH, memoryFs({ [PATH]: '{"records":[{"toolCallId":"c1"' }));
  assert.deepEqual(records, [], "corrupt content is never evidence");
  assert.equal(defects.length, 1);
  assert.match(defects[0], /state\.json/);
});

test("a record without a toolCallId is rejected by the append API", () => {
  const fs = memoryFs();
  assert.throws(() => appendRecord(PATH, { tool: "bash", command: "x", outcome: { kind: "success" }, at: "t" } as any, fs),
    /toolCallId/);
  assert.equal(fs.files.has(PATH), false, "nothing was written");
});

test("an interrupted write leaves no partial file visible at the real path", () => {
  const fs = memoryFs();
  appendRecord(PATH, rec("c1"), fs);
  const good = fs.files.get(PATH)!;

  const failing: Fs = { ...fs, renameSync: () => { throw new Error("boom"); } };
  assert.throws(() => appendRecord(PATH, rec("c2"), failing));
  assert.equal(fs.files.get(PATH), good, "the previous good content is intact");
  assert.deepEqual(readLedger(PATH, fs).records.map((r) => r.toolCallId), ["c1"]);
});

// --- integrity: a record is evidence only if THIS kernel observed it ---

test("records whose toolCallId this session observed are trusted", () => {
  const { trusted, degraded } = classifyRecords([rec("c1"), rec("c2")], new Set(["c1", "c2"]));
  assert.deepEqual(trusted.map((r) => r.toolCallId), ["c1", "c2"]);
  assert.deepEqual(degraded, []);
});

// The T010 probe child rewrote a whole .nodd file because it had `write` and no
// append tool. A forged record is well-formed JSON; what it cannot be is a
// toolCallId this process saw.
test("a record the kernel never observed is degraded, not trusted", () => {
  const forged = { ...rec("forged-1", "npm test"), outcome: { kind: "success" } as const };
  const { trusted, degraded } = classifyRecords([rec("c1"), forged], new Set(["c1"]));

  assert.deepEqual(trusted.map((r) => r.toolCallId), ["c1"]);
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].record.toolCallId, "forged-1");
  assert.equal(degraded[0].reason, "unobserved");
  assert.match(degraded[0].detail, /not observed/i);
});

test("a record whose command or outcome disagrees with what was observed is degraded", () => {
  const observed = new Map([["c1", { command: "npm test", outcome: "exit 1" }]]);

  const rewritten = { ...rec("c1", "npm test"), outcome: { kind: "success" } as const };
  const byOutcome = classifyRecords([rewritten], new Set(["c1"]), observed);
  assert.deepEqual(byOutcome.trusted, [], "a flipped outcome is not evidence");
  assert.equal(byOutcome.degraded[0].reason, "mismatch");
  assert.match(byOutcome.degraded[0].detail, /exit 1/);

  const byCommand = classifyRecords([rec("c1", "echo pretend")], new Set(["c1"]), observed);
  assert.deepEqual(byCommand.trusted, []);
  assert.equal(byCommand.degraded[0].reason, "mismatch");
});

// Honest limit: a fresh process saw nothing, so everything is unverified. That
// is reported as unverified, never as proven-forged and never as success.
test("with an empty observed set every record is degraded as unverified", () => {
  const { trusted, degraded } = classifyRecords([rec("c1"), rec("c2")], new Set());
  assert.deepEqual(trusted, []);
  assert.equal(degraded.length, 2);
  for (const d of degraded) assert.equal(d.reason, "unobserved");
});

test("degradation never throws away the record, it reports it", () => {
  const { degraded } = classifyRecords([rec("x")], new Set());
  assert.equal(degraded[0].record.toolCallId, "x", "the record survives for the report");
});
