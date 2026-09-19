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

test("the seven canonical steps are documented", () => {
  for (const step of CANONICAL_STEPS) assert.ok(README.includes(step), `step ${step} is undocumented`);
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

test("the parity matrix carries all three classes", () => {
  for (const marker of ["(M)", "(P)", "(F)"]) {
    assert.ok(README.includes(marker), `the matrix must classify ${marker}`);
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
