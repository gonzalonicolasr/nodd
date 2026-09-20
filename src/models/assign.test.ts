import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_STEPS, MECHANISM_STEPS } from "../manifest.ts";
import { SLOT_ROWS, isConfigurableSlot, slotRow } from "./slots.ts";
import { assignmentPatch, groupByProvider, parseAssignment, validateAssignment } from "./assign.ts";

const registry = groupByProvider([
  { provider: "anthropic", id: "claude-sonnet-4-5" },
  { provider: "anthropic", id: "claude-opus-4-1" },
  { provider: "openai-codex", id: "gpt-5-codex" },
  { provider: "opencode-go", id: "claude-sonnet-4-5" },
]);

// ---------------------------------------------------------------------------
// Slots: all seven steps visible, only five assignable.
// ---------------------------------------------------------------------------
test("the slot table displays all seven canonical steps in order", () => {
  const stepRows = SLOT_ROWS.filter((row) => row.kind !== "global");
  assert.deepEqual(stepRows.map((row) => row.id), [...CANONICAL_STEPS]);
});

test("the four mechanism steps are present and not assignable", () => {
  for (const step of MECHANISM_STEPS) {
    const row = slotRow(step);
    assert.ok(row, `${step} must be displayed`);
    assert.equal(row!.kind, "mechanism");
    assert.equal(isConfigurableSlot(step), false, `${step} must not be assignable`);
  }
});

test("the global default slot is assignable and is not a canonical step", () => {
  assert.equal(isConfigurableSlot("default"), true);
  assert.equal(slotRow("default")!.kind, "global");
  assert.ok(!(CANONICAL_STEPS as readonly string[]).includes("default"));
});

test("orchestrator is no longer a slot: it was inert, and default replaces it", () => {
  assert.equal(isConfigurableSlot("orchestrator"), false);
  assert.equal(slotRow("orchestrator"), undefined);
});

test("validateAssignment refuses orchestrator, naming what replaced it", () => {
  const result = validateAssignment(parseAssignment("orchestrator=anthropic/claude-opus-4-1")!, registry);
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /default/);
});

// ---------------------------------------------------------------------------
// A mechanism step rejects assignment, saying it is a mechanism.
// ---------------------------------------------------------------------------
test("classify=x/y is rejected as a mechanism step, not as an unknown model", () => {
  const result = validateAssignment(parseAssignment("classify=anthropic/claude-sonnet-4-5")!, registry);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /mecanismo/.test(result.message), result.ok === false ? result.message : "");
  assert.ok(result.ok === false && result.message.includes("classify"));
});

test("every mechanism step rejects assignment", () => {
  for (const step of MECHANISM_STEPS) {
    const result = validateAssignment({ slot: step, provider: "anthropic", model: "claude-opus-4-1" }, registry);
    assert.equal(result.ok, false, `${step} must reject assignment`);
  }
});

// ---------------------------------------------------------------------------
// Model validation against the registry.
// ---------------------------------------------------------------------------
test("implement=unknown/model is rejected against the registry", () => {
  const unknownProvider = validateAssignment(parseAssignment("implement=nope/some-model")!, registry);
  assert.equal(unknownProvider.ok, false);
  assert.ok(unknownProvider.ok === false && unknownProvider.message.includes("nope"));
  assert.ok(unknownProvider.ok === false && unknownProvider.message.includes("anthropic"), "valid providers are listed");

  const unknownModel = validateAssignment(parseAssignment("implement=anthropic/gpt-9")!, registry);
  assert.equal(unknownModel.ok, false);
  assert.ok(unknownModel.ok === false && unknownModel.message.includes("gpt-9"));
});

test("an ambiguous bare model id is rejected with qualified suggestions", () => {
  const result = validateAssignment(parseAssignment("implement=claude-sonnet-4-5")!, registry);
  assert.equal(result.ok, false);
  if (result.ok !== false) return;
  assert.ok(/ambiguo/.test(result.message), result.message);
  assert.ok(result.message.includes("anthropic/claude-sonnet-4-5"));
  assert.ok(result.message.includes("opencode-go/claude-sonnet-4-5"));
});

test("an unambiguous bare model id resolves to its only provider", () => {
  const result = validateAssignment(parseAssignment("implement=gpt-5-codex")!, registry);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.provider, "openai-codex");
});

test("a qualified valid assignment is accepted", () => {
  const result = validateAssignment(parseAssignment("implement=anthropic/claude-opus-4-1")!, registry);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.provider, "anthropic");
});

test("an empty registry is permissive: a headless context must not be unusable", () => {
  const result = validateAssignment(parseAssignment("implement=whatever/model")!, new Map());
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Parsing and the config patch.
// ---------------------------------------------------------------------------
test("parseAssignment reads slot=provider/model and slot=model", () => {
  assert.deepEqual(parseAssignment("implement=anthropic/claude-opus-4-1"), {
    slot: "implement", provider: "anthropic", model: "claude-opus-4-1",
  });
  assert.deepEqual(parseAssignment("default=gpt-5-codex"), {
    slot: "default", provider: null, model: "gpt-5-codex",
  });
  assert.equal(parseAssignment("implement"), null, "no `=` is not an assignment");
  assert.equal(parseAssignment("=x/y"), null, "an empty slot is not an assignment");
  assert.equal(parseAssignment("implement="), null, "an empty model is not an assignment");
});

test("a valid assignment produces a patch touching only models.<slot>", () => {
  const patch = assignmentPatch({ models: { explore: "anthropic/claude-opus-4-1" }, unrelated: 42 } as never, {
    slot: "implement", provider: "anthropic", model: "claude-opus-4-1",
  });

  assert.deepEqual(patch, {
    models: { explore: "anthropic/claude-opus-4-1", implement: "anthropic/claude-opus-4-1" },
  });
  assert.ok(!("unrelated" in patch), "the patch names only what it changes; the merge preserves the rest");
});

test("a bare model resolved to one provider is written qualified", () => {
  const patch = assignmentPatch({}, { slot: "implement", provider: "openai-codex", model: "gpt-5-codex" });
  assert.deepEqual(patch, { models: { implement: "openai-codex/gpt-5-codex" } });
});

test("a provider whose ids carry a prefix is browsable by prefix", () => {
  // cliproxy fronts several subscription pools and encodes the pool in the id:
  // `personal/claude-opus-5`, `ds/deepseek-flash`. Grouping by provider alone
  // put 166 models behind one row, which is not a menu anyone can use.
  const groups = groupByProvider([
    { provider: "cliproxy", id: "personal/claude-opus-5" },
    { provider: "cliproxy", id: "personal/claude-sonnet-5" },
    { provider: "cliproxy", id: "ds/deepseek-flash" },
    { provider: "cliproxy", id: "glm-5.2" },
    { provider: "anthropic", id: "claude-opus-4-1" },
  ]);

  assert.deepEqual(
    [...groups.keys()].sort(),
    ["anthropic", "cliproxy/ds", "cliproxy/personal", "cliproxy"].sort(),
    "each prefix is its own browsable group; unprefixed ids stay under the provider",
  );
  assert.deepEqual(groups.get("cliproxy/personal"), ["personal/claude-opus-5", "personal/claude-sonnet-5"]);
  assert.deepEqual(groups.get("cliproxy"), ["glm-5.2"], "only the unprefixed ids remain directly under it");
});

test("assigning through a prefixed group writes the provider, not the prefix", () => {
  // The group is a browsing device. What reaches the agent frontmatter must be
  // the real `provider/id`, or pi cannot resolve it.
  const groups = groupByProvider([{ provider: "cliproxy", id: "personal/claude-opus-5" }]);
  const assignment = parseAssignment("implement=cliproxy/personal/claude-opus-5");

  assert.deepEqual(assignment, { slot: "implement", provider: "cliproxy", model: "personal/claude-opus-5" });
  assert.deepEqual(validateAssignment(assignment!, groups), { ok: true, provider: "cliproxy" });
});

test("the unknown-provider message names providers, not browsing keys", () => {
  // `cliproxy/ds` is a menu grouping, not something you can type as a provider:
  // offering it as a valid value would send the user to an assignment that
  // cannot resolve.
  const groups = groupByProvider([
    { provider: "cliproxy", id: "personal/claude-opus-5" },
    { provider: "cliproxy", id: "ds/deepseek-flash" },
    { provider: "anthropic", id: "claude-opus-4-1" },
  ]);
  const result = validateAssignment(parseAssignment("implement=nope/x")!, groups);

  assert.equal(result.ok, false);
  assert.match(result.message, /Usá uno de: anthropic, cliproxy$/, "the real providers, deduped");
});
