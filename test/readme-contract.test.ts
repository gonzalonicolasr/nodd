import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GATE_IDS } from "../src/gates/registry.ts";
import { CANONICAL_STEPS } from "../src/manifest.ts";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** A section and everything under it, up to the next heading of the same level. */
function section(heading: RegExp): string {
  const lines = README.split("\n");
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
  for (const gate of GATE_IDS) {
    assert.ok(README.includes(gate), `gate ${gate} is unmentioned`);
  }
});

test("every gate the README names is actually registered", () => {
  const claimed = [...README.matchAll(/`gate-([a-z-]+)`/g)].map((m) => m[1]);
  for (const gate of new Set(claimed)) {
    assert.ok((GATE_IDS as readonly string[]).includes(gate), `README claims gate-${gate}, which does not exist`);
  }
});

test("every module the README cites exists on disk", () => {
  const cited = [...README.matchAll(/`(src\/[a-z-]+(?:\/[a-z-]+)?\.ts)`/g)].map((m) => m[1]);
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
  assert.match(README, /per-process|por proceso/i);
  assert.match(README, /no aggregate|sin total|does not claim/i);
});

test("the resume behaviour is documented as expected, with its reason", () => {
  const resume = section(/[Rr]esum/);
  assert.match(resume, /unverified/, "prior evidence returns as unverified");
  assert.match(resume, /re-?run/i, "the check must be re-run");
  assert.match(resume, /observed/i, "and the one-line reason is given");
});

test("unverified and mismatch are distinguished", () => {
  assert.ok(README.includes("unverified") && README.includes("mismatch"));
  const unverifiedLine = README.split("\n").find((l) => l.includes("unverified") && l.includes("mismatch"))
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
  assert.ok(README.includes("routing.go:68"), "the divergent clause must be cited by line");
  const around = README.slice(Math.max(0, README.indexOf("routing.go:68") - 600), README.indexOf("routing.go:68") + 600);
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
    assert.ok(README.includes(`(${marker})`), `the README must explain what (${marker}) means`);
  }

  // A quoted total is how "fully classified" quietly stops being true as ODD's
  // surface grows, so if the README states one it must be the real one.
  const quoted = README.match(/(\d+)\s+(?:clauses|rows)\b/i);
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
  const claimed = new Set([...README.matchAll(/`\/(nodd-[a-z-]+)/g)].map((m) => m[1]));
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
