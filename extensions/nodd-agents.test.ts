import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANTI_GAMING, NODD_AGENTS, agentsDir, buildAgentFile, provisionAgents } from "./nodd-agents.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nodd-agents-"));
}

// ---------------------------------------------------------------------------
// Paths: the nodd namespace, never forge's.
// ---------------------------------------------------------------------------
test("agent files land under agents/nodd/ and never under agents/zero/", () => {
  const dir = agentsDir("/home/someone");
  assert.equal(dir, "/home/someone/.pi/agent/agents/nodd");
  assert.ok(!dir.includes("agents/zero"), "NODD must never write into forge's agent namespace");
});

test("the three model-backed steps get an agent, the four mechanisms do not", () => {
  assert.deepEqual(NODD_AGENTS.map((agent) => agent.slot), ["explore", "resolve-uncertainty", "implement"]);
  for (const mechanism of ["authorize", "classify", "track", "close"]) {
    assert.ok(!NODD_AGENTS.some((agent) => agent.slot === mechanism), `${mechanism} runs no model`);
  }
});

// ---------------------------------------------------------------------------
// The renderer is pure and its output is pinned.
// ---------------------------------------------------------------------------
test("the renderer matches an expected frontmatter and body exactly", () => {
  const rendered = buildAgentFile(NODD_AGENTS[2], "anthropic/claude-opus-4-1");
  const [, frontmatter] = rendered.split("---\n");

  assert.ok(rendered.startsWith("---\n"), "the file opens with frontmatter");
  assert.match(frontmatter, /^name: nodd-implement$/m);
  assert.match(frontmatter, /^model: anthropic\/claude-opus-4-1$/m);
  assert.match(frontmatter, /^tools: /m);
  assert.match(frontmatter, /^systemPromptMode: replace$/m);
  assert.ok(rendered.endsWith("\n"));
});

test("a slot with no configured model falls back to default, then omits the line", () => {
  const withDefault = buildAgentFile(NODD_AGENTS[0], "anthropic/fallback");
  assert.match(withDefault, /^model: anthropic\/fallback$/m);

  const withNone = buildAgentFile(NODD_AGENTS[0], undefined);
  assert.ok(!/^model:/m.test(withNone), "no model line rather than an empty one pi cannot resolve");
  assert.match(withNone, /^name: nodd-explore$/m);
});

test("the frontmatter declares no extensions list of its own", () => {
  // An agent definition with `extensions:` makes pi-subagents launch the child
  // with --no-extensions, which would strip NODD out of its own sub-agent
  // (spike RESULT.md, uncovered vector 1). NODD must not do that to itself.
  for (const agent of NODD_AGENTS) {
    const rendered = buildAgentFile(agent, "anthropic/x");
    assert.ok(!/^extensions:/m.test(rendered), `${agent.slot} must not declare its own extensions list`);
  }
});

// ---------------------------------------------------------------------------
// The advisory travels into every generated body.
// ---------------------------------------------------------------------------
test("every generated body carries the advisory-only line heuristic and its anti-gaming sentence", () => {
  for (const agent of NODD_AGENTS) {
    const body = buildAgentFile(agent, "anthropic/x");
    assert.match(body, /400/, `${agent.slot} must carry the line figure`);
    assert.match(body, /advisory|orientativ/i, `${agent.slot} must mark it advisory`);
    assert.ok(body.includes(ANTI_GAMING), `${agent.slot} must carry the anti-gaming sentence verbatim`);
  }
});

test("the anti-gaming sentence names all the things it forbids", () => {
  for (const forbidden of ["blank lines", "comments", "minify", "tests", "split"]) {
    assert.ok(ANTI_GAMING.includes(forbidden), `the advisory must name ${forbidden}`);
  }
});

test("the enforcement caveat from the spike travels with every agent", () => {
  for (const agent of NODD_AGENTS) {
    const body = buildAgentFile(agent, "anthropic/x");
    assert.match(body, /gate/i, "the body states that NODD's gates apply here");
  }
});

// ---------------------------------------------------------------------------
// Provisioning: per-file failures are swallowed.
// ---------------------------------------------------------------------------
test("provisioning writes one file per agent, named nodd-<slot>.md", () => {
  const home = tmp();
  const result = provisionAgents(home, { models: { implement: "anthropic/claude-opus-4-1" } });

  assert.equal(result.written.length, 3);
  const files = readdirSync(agentsDir(home)).sort();
  assert.deepEqual(files, ["nodd-explore.md", "nodd-implement.md", "nodd-resolve-uncertainty.md"]);
  assert.match(readFileSync(join(agentsDir(home), "nodd-implement.md"), "utf8"), /^model: anthropic\/claude-opus-4-1$/m);
});

test("models come from nodd.json with the default slot as fallback", () => {
  const home = tmp();
  provisionAgents(home, { models: { default: "anthropic/fallback", implement: "anthropic/specific" } });

  const dir = agentsDir(home);
  assert.match(readFileSync(join(dir, "nodd-implement.md"), "utf8"), /^model: anthropic\/specific$/m);
  assert.match(readFileSync(join(dir, "nodd-explore.md"), "utf8"), /^model: anthropic\/fallback$/m);
});

test("one failing write does not prevent the other two", () => {
  const home = tmp();
  const dir = agentsDir(home);
  mkdirSync(dir, { recursive: true });
  // Make one target unwritable by putting a read-only directory in its place.
  mkdirSync(join(dir, "nodd-implement.md"));

  const result = provisionAgents(home, {});
  assert.equal(result.written.length, 2, "the other two are still written");
  assert.equal(result.failed.length, 1);
  assert.ok(result.failed[0].includes("implement"));
  assert.ok(existsSync(join(dir, "nodd-explore.md")));
  assert.ok(existsSync(join(dir, "nodd-resolve-uncertainty.md")));
});

test("provisioning never throws, whatever the config holds", () => {
  const home = tmp();
  for (const config of [{}, { models: null }, { models: { implement: 42 } }] as never[]) {
    assert.doesNotThrow(() => provisionAgents(home, config));
  }
});
