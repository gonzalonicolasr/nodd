/**
 * The ODD parity matrix, checked against the code.
 *
 * `REQ: odd-parity-matrix` is the contract for what NODD inherits from ODD, and
 * round 1 "verified" it with `assert.ok(README.includes("(M)"))` — which passes
 * on any document containing that substring and proved nothing. Three rows were
 * marked **(M)** with no mechanism behind them, which is the precise sin NODD
 * accuses ODD of: claiming more than the machinery delivers.
 *
 * The rule enforced here: a row may call itself mechanized only if its
 * justification names something that exists in this repository — a `REQ:` with
 * acceptance criteria, a registered gate id, a source file, a tool, or a
 * command. A (P) row must give a reason. Nothing may be unclassified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_IDS } from "../src/gates/registry.ts";
import { emptyDoc, parseFeatureDoc, renderFeatureDoc } from "../src/feature-doc.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requirements = readFileSync(join(root, ".sdd", "nodd", "requirements.md"), "utf8");

type Row = { n: number; line: string; clause: string; klass: string; how: string };

/** Every table row in the matrix section, which starts at the parity heading. */
function matrixRows(): Row[] {
  const start = requirements.indexOf("# ODD parity matrix");
  assert.ok(start > 0, "the matrix section must exist");

  const rows: Row[] = [];
  for (const raw of requirements.slice(start).split("\n")) {
    if (!raw.startsWith("|")) continue;
    // An escaped pipe inside a cell (route unions like `inline|tracked`) is not a
    // column separator. Splitting naively dropped those rows silently, which is
    // exactly how a matrix row could go unchecked.
    const cells = raw
      .replace(/\\\|/g, "\u0000")
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/\u0000/g, "|"));
    if (cells.length !== 5) continue;
    const n = Number(cells[0]);
    if (!Number.isInteger(n)) continue;
    rows.push({ n, line: cells[1], clause: cells[2], klass: cells[3], how: cells[4] });
  }
  return rows;
}

const rows = matrixRows();

test("the matrix is a complete, contiguous, uniquely numbered table", () => {
  assert.ok(rows.length >= 50, `expected the full ODD surface, parsed ${rows.length} rows`);
  const numbers = rows.map((row) => row.n);
  assert.deepEqual(numbers, [...new Set(numbers)], "a duplicated row number hides a clause");
  assert.deepEqual(
    numbers,
    Array.from({ length: rows.length }, (_, i) => i + 1),
    "row numbers must be contiguous from 1: a gap is an unclassified clause",
  );
});

test("every row is classified, and every row cites the ODD line it came from", () => {
  for (const row of rows) {
    assert.match(row.klass, /\*\*(M|P|F)\*\*/, `row ${row.n} is unclassified: ${row.klass}`);
    // One row may answer several ODD lines, or a range of them; each reference
    // still has to be an actual citation.
    for (const ref of row.line.split(",")) {
      assert.match(ref.trim(), /^`:\d+(-\d+)?`$/, `row ${row.n} must cite routing.go lines, got ${row.line}`);
    }
    assert.ok(row.clause.length > 10, `row ${row.n} has no clause text`);
  }
});

/**
 * What counts as naming a mechanism. Each entry is a pattern plus a check that
 * whatever it captured actually exists, so a row cannot satisfy this test by
 * inventing a plausible-looking requirement name or a file that was never
 * written.
 */
const MECHANISMS: Array<{ label: string; pattern: RegExp; exists: (name: string) => boolean }> = [
  {
    label: "a REQ with acceptance criteria",
    pattern: /`REQ: ([a-z-]+)`/g,
    exists: (name) => requirements.includes(`## REQ: ${name}`),
  },
  {
    label: "a registered gate id",
    pattern: /`gate-([a-z-]+)`/g,
    exists: (name) => (GATE_IDS as readonly string[]).includes(name),
  },
  {
    label: "a source file",
    pattern: /`((?:src|extensions|test)\/[\w./-]+\.ts)`/g,
    exists: (name) => fileExists(name),
  },
  {
    label: "a named exported function",
    pattern: /`([a-z][a-zA-Z]+)\(\)`/g,
    exists: (name) =>
      ["src/feature-doc.ts", "src/gates/evidence.ts", "src/ledger.ts", "extensions/nodd-kernel.ts"]
        .some((file) => sourceOf(file).includes(`function ${name}`)),
  },
  {
    label: "a nodd tool",
    pattern: /`(nodd_[a-z]+)/g,
    exists: (name) => sourceOf("extensions/nodd-kernel.ts").includes(`"${name}"`),
  },
  {
    label: "a slash command",
    pattern: /`(\/nodd-[a-z]+)/g,
    exists: (name) => fileExists(`extensions/${name.slice(1)}.ts`),
  },
];

const cache = new Map<string, string>();
function sourceOf(rel: string): string {
  if (!cache.has(rel)) {
    try {
      cache.set(rel, readFileSync(join(root, rel), "utf8"));
    } catch {
      cache.set(rel, "");
    }
  }
  return cache.get(rel)!;
}
function fileExists(rel: string): boolean {
  return sourceOf(rel) !== "";
}

/** The mechanisms a row's justification names, and the ones it names falsely. */
function citations(how: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  for (const { pattern, exists } of MECHANISMS) {
    for (const match of how.matchAll(pattern)) {
      (exists(match[1]) ? found : missing).push(match[1]);
    }
  }
  return { found, missing };
}

test("every (M) row names a mechanism that exists in this repository", () => {
  // The claim under test: "mechanized" means there is machinery, not that the
  // row's author intended some. Rows 13, 45 and 46 failed this in round 1.
  const unbacked: string[] = [];
  for (const row of rows) {
    if (!row.klass.includes("**M**")) continue;
    const { found, missing } = citations(row.how);
    assert.deepEqual(missing, [], `row ${row.n} cites something that does not exist: ${missing.join(", ")}`);
    if (found.length === 0) unbacked.push(`row ${row.n} (${row.line}): ${row.how.slice(0, 80)}`);
  }
  assert.deepEqual(
    unbacked,
    [],
    `these rows claim (M) without naming any mechanism:\n${unbacked.join("\n")}`,
  );
});

test("every (P) row gives a reason the clause is not mechanizable", () => {
  // `REQ: odd-parity-matrix`: "we did not get to it" is not a reason.
  for (const row of rows) {
    if (!row.klass.includes("**P**")) continue;
    assert.ok(row.how.length > 40, `row ${row.n} must say why, not just that: ${row.how}`);
    assert.match(
      row.how,
      /judge?ment|judgement|not observable|natural language|prose|cannot|wording|taste|intent|proportional/i,
      `row ${row.n} gives no reason the clause resists mechanization: ${row.how}`,
    );
    assert.ok(
      !/did not get|todo|later|future|not yet implemented/i.test(row.how),
      `row ${row.n} defers instead of giving a reason: ${row.how}`,
    );
  }
});

test("every (F) row points at the out-of-scope requirement that justifies it", () => {
  for (const row of rows) {
    if (!row.klass.includes("**F**")) continue;
    assert.ok(
      row.how.includes("odd-parity-out-of-scope") || row.how.length > 40,
      `row ${row.n} must justify being out of scope: ${row.how}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The three rows the round-1 verdict caught, pinned individually so a
// regression names the specific claim that broke.
// ---------------------------------------------------------------------------

function row(n: number): Row {
  const found = rows.find((r) => r.n === n);
  assert.ok(found, `row ${n} must exist`);
  return found!;
}

test("row 13: the Outcome section is derived, so a pending check cannot be dropped", () => {
  const doc = sourceOf("src/feature-doc.ts");
  assert.ok(doc.includes("export function renderOutcome"), "the renderer must exist");
  assert.ok(
    /"## Outcome",\s*\n\s*"",\s*\n\s*\.\.\.renderOutcome\(doc\)/.test(doc),
    "renderFeatureDoc must derive ## Outcome on every save, not accept a caller's text",
  );
  // `TaskEvidence.outcome` is legitimate: it holds one observed result. What must
  // not exist is a doc-level outcome string, which is what used to let a caller
  // write the closing report by hand and omit a failed check.
  assert.ok(
    !/^\s*outcome: string;/m.test(doc.slice(doc.indexOf("export type FeatureDoc"))),
    "a doc-level free-text outcome field would let a caller omit a failed check",
  );
  assert.ok(
    !/doc\.outcome/.test(sourceOf("extensions/nodd-kernel.ts")),
    "and no caller may supply one",
  );
  assert.match(row(13).how, /renderOutcome|derived|task list/i, "the row must name the real mechanism");
});

// `includes` over a whole source file is H2's shape: renaming the fields while
// leaving the words in a comment kept this green. The row claims the values are
// recorded and survive, so the test round-trips them through the real renderer
// and parser instead of reading the source for words.
test("row 45: TDD mode, source and runner are recorded and reach the gate", () => {
  const doc = emptyDoc({ slug: "row45", title: "Row 45" });
  doc.verification = { runner: "npm test", tdd: "strict", source: "nodd_declare", files: ["a.ts"] };

  const parsed = parseFeatureDoc(renderFeatureDoc(doc));
  assert.deepEqual(parsed.defects, [], "the rendered doc must parse cleanly");
  assert.deepEqual(
    parsed.doc.verification,
    { runner: "npm test", tdd: "strict", source: "nodd_declare", files: ["a.ts"] },
    "mode, source, runner and files must survive the round trip",
  );
  assert.ok(
    sourceOf("extensions/nodd-kernel.ts").includes("tdd:"),
    "the kernel must pass the recorded mode to the evidence gate, or the row's RED clause is unreachable",
  );
});

test("row 12: no NODD source issues a push, a PR or a merge", () => {
  // A negative guarantee needs a mechanism too, and for "NODD never does X" the
  // mechanism is a scan that fails when someone adds X.
  const files = [
    "src/gates/evidence.ts", "src/gates/track.ts", "src/gates/delegate.ts",
    "src/gates/promotion.ts", "src/gates/authorize.ts", "src/gates/classify.ts",
    "src/delivery.ts", "src/io.ts", "src/ledger.ts", "src/feature-doc.ts",
    "extensions/nodd-kernel.ts", "extensions/nodd-promote.ts",
  ];
  for (const file of files) {
    const executable = sourceOf(file)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    assert.ok(
      !/git\s+push|gh\s+pr|git\s+merge|pulls?\/create/.test(executable),
      `${file} issues a push, PR or merge, which row 12 promises NODD leaves to the user`,
    );
  }
});

test("row 46: evidence is keyed to the declared runner and the write, never to a checkbox", () => {
  const evidence = sourceOf("src/gates/evidence.ts");
  assert.ok(evidence.includes("isDeclaredRunner"), "the runner binding is the mechanism");
  assert.ok(evidence.includes("lastWriteSeq"), "and the write ordering is the other half");
  assert.match(
    row(46).how,
    /runner|declared|write/i,
    "the row must name what the evidence is actually keyed to, not merely deny the checkbox",
  );
});
