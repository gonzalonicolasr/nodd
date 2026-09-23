import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GATE_IDS } from "../src/gates/registry.ts";
import { migrateOrchestratorSlot } from "../src/models/profiles.ts";
import { runGatesCommand } from "../extensions/nodd-gates.ts";
import { CANONICAL_STEPS } from "../src/manifest.ts";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const REFERENCE = readFileSync(new URL("../docs/reference.md", import.meta.url), "utf8");

/**
 * The documented surface, wherever it lives.
 *
 * The README is the entry point and the reference holds the operating detail,
 * but every limit this suite pins has to keep being stated somewhere a reader
 * reaches. Splitting the files must not be a way to drop a disclosure.
 */
const DOCS = `${README}\n${REFERENCE}`;

/** A section and everything under it, up to the next heading of the same level. */
function section(heading: RegExp): string {
  const lines = DOCS.split("\n");
  const start = lines.findIndex((line) => /^#{2,3} /.test(line) && heading.test(line));
  assert.ok(start >= 0, `missing section matching ${heading}`);
  const level = (/^#+/.exec(lines[start]) ?? ["##"])[0].length;
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

// ---------------------------------------------------------------------------
// Every mechanism named is a mechanism that exists
// ---------------------------------------------------------------------------
test("every registered gate id appears in the README", () => {
  // `README.includes("evidence")` is satisfied by the word "evidence" in
  // ordinary prose — it appears 15 times — so the old assertion would pass for
  // a gate the document never documents. A gate counts as mentioned only where
  // it is named as a gate, in the table that says when it fires and when it
  // refuses.
  const table = section(/gates/i);
  for (const gate of GATE_IDS) {
    assert.ok(
      new RegExp("\\bgate-" + gate + "\\b").test(table),
      `gate ${gate} is not documented in the gate table; a bare mention in prose is not documentation`,
    );
  }
});

test("every gate the README names is actually registered", () => {
  const claimed = [...DOCS.matchAll(/`gate-([a-z-]+)`/g)].map((m) => m[1]);
  for (const gate of new Set(claimed)) {
    assert.ok((GATE_IDS as readonly string[]).includes(gate), `README claims gate-${gate}, which does not exist`);
  }
});

test("every module the README cites exists on disk", () => {
  const cited = [...DOCS.matchAll(/`(src\/[a-z-]+(?:\/[a-z-]+)?\.ts)`/g)].map((m) => m[1]);
  const existing = new Set<string>();
  for (const dir of ["src", "src/gates", "src/models"]) {
    for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url))) existing.add(`${dir}/${file}`);
  }
  for (const path of new Set(cited)) {
    assert.ok(existing.has(path), `README cites ${path}, which does not exist`);
  }
});

// `README.includes(step)` is a substring match over the whole file, so five of
// the seven steps were held up by an unrelated word: `authorize` by
// `gate-authorize`, `classify` by `gate-classify`, `track` by `tracked`,
// `implement` by `implemented`, `close` by `fail-closed`. Deleting a step from
// the chain left the suite green. The claim is about the documented chain, so
// that is what this reads: scoped to its section, and by identity, not presence.
test("the seven canonical steps are documented, in order, in their section", () => {
  const steps = section(/The seven canonical steps/);
  // Taking the first match let a correct decoy above a corrupted chain pass, so
  // the section is allowed exactly one chain and that one is the one read.
  const chains = [...steps.matchAll(/(`[a-z-]+`(?:\s*→\s*`[a-z-]+`)+)\./g)];
  assert.equal(chains.length, 1, "the section must hold exactly one canonical chain");
  const named = chains[0][1].split("→").map((step) => step.trim().replaceAll("`", ""));
  assert.deepEqual(named, [...CANONICAL_STEPS], "the documented chain is not the canonical step list");
});

// ---------------------------------------------------------------------------
// The honest-scope sections
// ---------------------------------------------------------------------------
test("the enforcement scope section exists and is substantive", () => {
  const scope = section(/Enforcement scope/i);
  assert.ok(scope.length > 400, "the enforcement scope must be stated, not gestured at");
  assert.match(scope, /sub-?agent/i, "it must say what happens in sub-agents");
});

test("the sub-agent section names the four uncovered vectors from the spike", () => {
  const scope = section(/Enforcement scope/i);
  assert.match(scope, /--no-extensions|extensions:/, "an agent with its own extensions list");
  assert.match(scope, /denyExtensions|capability ceiling/i, "the capability ceiling");
  assert.match(scope, /grandchild|depth/i, "grandchildren beyond depth 1");
  assert.match(scope, /session state|not shared/i, "session state is not shared");
});

test("the bash coverage section claims no exhaustiveness", () => {
  const bash = section(/bash/i);
  for (const overclaim of ["guarantees", "garantiza", "exhaustive", "all writes", "every possible", "cannot be bypassed"]) {
    assert.ok(!bash.toLowerCase().includes(overclaim.toLowerCase()), `the bash section must not say "${overclaim}"`);
  }
  assert.match(bash, /not cover|no cubre|uncovered|bypass/i, "it must say what it misses");
});

test("the per-process counter limitation is stated, with no claim of a session total", () => {
  assert.match(DOCS, /per-process|por proceso/i);
  assert.match(DOCS, /no aggregate|sin total|does not claim/i);
});

test("the resume behaviour is documented as expected, with its reason", () => {
  const resume = section(/[Rr]esum/);
  assert.match(resume, /unverified/, "prior evidence returns as unverified");
  assert.match(resume, /re-?run/i, "the check must be re-run");
  assert.match(resume, /observed/i, "and the one-line reason is given");
});

test("unverified and mismatch are distinguished", () => {
  assert.ok(DOCS.includes("unverified") && DOCS.includes("mismatch"));
  const unverifiedLine = DOCS.split("\n").find((l) => l.includes("unverified") && l.includes("mismatch"))
    ?? section(/[Ll]edger|[Ee]vidence/);
  assert.match(unverifiedLine, /contradic|mismatch/i, "mismatch must be described as contradicting an observation");
});

test("the kill-switch semantics are stated without a re-enable suggestion", () => {
  const kill = section(/kill switch|apagar|flags/i);
  assert.match(kill, /nodd-off|enabled: false/, "the flags are named");
  for (const forbidden = "re-enable" as const; ;) {
    assert.ok(!/do not argue.{0,80}(then|but) re-?enable/i.test(kill), forbidden);
    break;
  }
  assert.match(kill, /entirely|completamente|do not argue|no discut/i);
});

test("the escalation-divergence divergence from ODD is declared, naming routing.go:68", () => {
  assert.ok(DOCS.includes("routing.go:68"), "the divergent clause must be cited by line");
  const around = DOCS.slice(Math.max(0, DOCS.indexOf("routing.go:68") - 600), DOCS.indexOf("routing.go:68") + 600);
  assert.match(around, /diverg/i, "and labelled as a deliberate divergence");
});

// This test used to be `assert.ok(README.includes("(M)"))` per marker, which
// passes on any document containing those three substrings and was the stated
// acceptance criterion for the whole matrix. The substance -- that every (M) row
// names a mechanism that exists -- is checked against the code in
// `test/parity-matrix.test.ts`. What belongs here is only that the README's
// summary does not contradict the matrix it summarizes.
test("the README's matrix summary agrees with the matrix itself", () => {
  const requirements = readFileSync(new URL("../.sdd/nodd/requirements.md", import.meta.url), "utf8");
  const matrix = requirements.slice(requirements.indexOf("# ODD parity matrix"));
  const rows = matrix.split("\n").filter((line) => /^\| \d+ \|/.test(line));
  assert.ok(rows.length >= 50, `the matrix must be present to be summarized, parsed ${rows.length}`);

  // Every class the matrix uses must be explained in the README, and the README
  // must not advertise a class the matrix never assigns.
  for (const marker of ["M", "P", "F"] as const) {
    assert.ok(
      rows.some((row) => row.includes(`**${marker}**`)),
      `the matrix assigns no (${marker}): fix the matrix or stop advertising the class`,
    );
    assert.ok(DOCS.includes(`(${marker})`), `the docs must explain what (${marker}) means`);
  }

  // A quoted total is how "fully classified" quietly stops being true as ODD's
  // surface grows, so if the README states one it must be the real one.
  const quoted = DOCS.match(/(\d+)\s+(?:clauses|rows)\b/i);
  if (quoted) {
    assert.equal(Number(quoted[1]), rows.length, `the README says ${quoted[1]}, the matrix has ${rows.length}`);
  }
});

// ---------------------------------------------------------------------------
// What NODD does not ship
// ---------------------------------------------------------------------------
test("no code path references the gentle-ai binary", () => {
  for (const dir of ["../src", "../src/gates", "../src/models", "../extensions"]) {
    const url = new URL(`${dir}/`, import.meta.url);
    for (const file of readdirSync(url)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(new URL(file, url), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      assert.ok(!/gentle-ai (review|assess)/.test(source), `${dir}/${file} invokes the gentle-ai binary`);
    }
  }
});

test("the README does not promise a command the package does not register", () => {
  const claimed = new Set([...DOCS.matchAll(/`\/(nodd-[a-z-]+)/g)].map((m) => m[1]));
  const registered = new Set<string>();
  const url = new URL("../extensions/", import.meta.url);
  for (const file of readdirSync(url)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    for (const match of readFileSync(new URL(file, url), "utf8").matchAll(/registerCommand\?\.\("([a-z-]+)"/g)) {
      registered.add(match[1]);
    }
  }
  for (const command of claimed) {
    assert.ok(registered.has(command), `README promises /${command}, which no extension registers`);
  }
});

// ---------------------------------------------------------------------------
// The contract above checks that every gate is *named*. The veredicto found
// three README claims that were false while all of it stayed green, because
// naming a gate says nothing about what the gate does. These pin behaviour.
// ---------------------------------------------------------------------------
test("the README does not claim authorize blocks all delegation", () => {
  // `a24b1cf` made read-only delegation legal, which is what ODD :70/:92
  // requires. A README that still promises a blanket block over-promises
  // enforcement that no longer exists.
  const row = /\|\s*`gate-authorize`\s*\|([^|]*)\|/.exec(DOCS);
  assert.ok(row, "expected a gate-authorize row in the gate table");
  assert.ok(
    !/delegation\s*(\||,|$)/.test(row[1]),
    `the row claims authorize fires on delegation as such; it only fires on delegation to a writer: "${row[1].trim()}"`,
  );
});

test("a user-config migration is documented where the config is explained", () => {
  // Rewriting `~/.pi/nodd.json` on load is exactly the kind of surprise NODD
  // exists to refuse, so it may not be silent.
  const migration = section(/orchestrator/i);
  assert.ok(/backup/i.test(migration), "a migration that edits user config must say that it takes a backup");

  // And it may not describe the opposite of what it does. The first version of
  // this section promised the migration left profiles "untouched" while
  // `migrateOrchestratorSlot` rewrote precisely those, and the check could not
  // tell, because it only looked for the word "backup" somewhere in the file.
  const before = { models: {}, profiles: { work: { models: { orchestrator: "m-b", explore: "m-c" } } } };
  const after = migrateOrchestratorSlot(structuredClone(before));
  const touchesProfiles =
    JSON.stringify(after.data?.profiles) !== JSON.stringify(before.profiles);
  assert.ok(touchesProfiles, "this test is pinned to a migration that rewrites profiles");
  assert.ok(
    !/profiles[^.]*untouched|untouched[^.]*profiles/i.test(migration),
    "the section claims profiles are left untouched, but the migration rewrites them",
  );
});

test("every /nodd-gates invocation the README shows is actually accepted", () => {
  // The contract checked that the *command* exists, never its arguments, so
  // the README taught `/nodd-gates off track` — rejected by the real parser —
  // in the paragraph explaining how to stop a gate. Verbs are part of the
  // promise, so they get run.
  const io = { readConfig: () => ({}), writeConfig: () => {} };
  const shown = [...DOCS.matchAll(/`\/nodd-gates ([^`]*)`/g)].map((m) => m[1].trim());
  assert.ok(shown.length > 0, "expected the README to show at least one /nodd-gates invocation");

  for (const args of shown) {
    // Bracketed forms like `[status|enable <gate>]` are syntax summaries.
    if (/[[\]<>|]/.test(args)) continue;
    assert.doesNotMatch(
      runGatesCommand(args, io),
      /usage —|unknown gate/,
      `the README shows "/nodd-gates ${args}", which the command rejects`,
    );
  }
});

test("a gate count quoted in the README matches the registry", () => {
  // The prose contract checks that every gate *named* exists, but a count is
  // a different claim and nothing measured it. The badge and the opening
  // sentence both said seven while the registry held six, because `registry.ts`
  // sits in `src/gates/` and got counted as one of the gates it indexes.
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const expected = GATE_IDS.length;

  for (const match of DOCS.matchAll(/\b(\w+)\s+gates\b/gi)) {
    const spelled = words.indexOf(match[1].toLowerCase());
    const counted = spelled >= 0 ? spelled : Number(match[1]);
    if (!Number.isFinite(counted)) continue; // "the gates", "all gates"
    assert.equal(counted, expected, `README says "${match[0]}", but the registry holds ${expected}`);
  }

  const badge = /badge\/gates-(\d+)/.exec(README);
  if (badge) assert.equal(Number(badge[1]), expected, `the badge claims ${badge[1]} gates, the registry holds ${expected}`);
});
