import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVED_PROFILE_NAMES,
  applyProfileCommand,
  isValidProfileName,
  mirrorToActiveProfile,
  readActiveProfile,
  readProfiles,
  readThinking,
} from "./profiles.ts";

const withProfiles = () => ({
  models: { implement: "anthropic/claude-opus-4-1" },
  profiles: {
    fast: { models: { implement: "openai-codex/gpt-5-codex" } },
    careful: { models: { implement: "anthropic/claude-opus-4-1", explore: "anthropic/claude-sonnet-4-5" } },
  },
  activeProfile: "fast",
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
test("reserved verb names are rejected, so `profile save` stays unambiguous", () => {
  for (const reserved of RESERVED_PROFILE_NAMES) {
    assert.equal(isValidProfileName(reserved), false, `${reserved} must be reserved`);
  }
});

test("invalid characters are rejected and ordinary names accepted", () => {
  for (const bad of ["Fast", "my profile", "prof/ile", "", "über", "a.b"]) {
    assert.equal(isValidProfileName(bad), false, `${bad} must be rejected`);
  }
  for (const good of ["fast", "careful-2", "my_profile", "x"]) {
    assert.equal(isValidProfileName(good), true, `${good} must be accepted`);
  }
});

// ---------------------------------------------------------------------------
// Reading, tolerantly
// ---------------------------------------------------------------------------
test("a corrupt profiles value parses to an empty set with a defect note", () => {
  for (const corrupt of ["not an object", 42, null, ["a"]]) {
    const result = readProfiles({ profiles: corrupt });
    assert.deepEqual(result.profiles, {});
    assert.ok(result.defects.length > 0, `${JSON.stringify(corrupt)} must be reported, not silently dropped`);
  }
});

test("malformed individual entries are discarded and reported, valid siblings survive", () => {
  const result = readProfiles({
    profiles: { fast: { models: { implement: "anthropic/x" } }, "BAD NAME": { models: {} }, broken: 7 },
  });
  assert.deepEqual(Object.keys(result.profiles), ["fast"]);
  assert.equal(result.defects.length, 2);
  assert.ok(result.defects.some((d) => d.includes("BAD NAME")));
  assert.ok(result.defects.some((d) => d.includes("broken")));
});

test("an absent profiles key is not a defect: it is just unset", () => {
  const result = readProfiles({});
  assert.deepEqual(result.profiles, {});
  assert.deepEqual(result.defects, []);
});

test("activeProfile is only honoured when the profile exists", () => {
  assert.equal(readActiveProfile(withProfiles()), "fast");
  assert.equal(readActiveProfile({ ...withProfiles(), activeProfile: "ghost" }), null);
  assert.equal(readActiveProfile({ activeProfile: 42 }), null);
});

// ---------------------------------------------------------------------------
// The four verbs, as pure transforms
// ---------------------------------------------------------------------------
test("new creates from the current config and activates it", () => {
  const result = applyProfileCommand({ models: { implement: "anthropic/claude-opus-4-1" } }, { kind: "new", name: "fresh" });
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.deepEqual(result.data.profiles, { fresh: { models: { implement: "anthropic/claude-opus-4-1" } } });
  assert.equal(result.data.activeProfile, "fresh");
  assert.match(result.message, /fresh/);
});

test("new refuses to overwrite an existing profile", () => {
  const result = applyProfileCommand(withProfiles(), { kind: "new", name: "fast" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.message.includes("fast"));
});

test("new with an invalid name is refused", () => {
  assert.equal(applyProfileCommand({}, { kind: "new", name: "use" }).ok, false);
  assert.equal(applyProfileCommand({}, { kind: "new", name: "Bad Name" }).ok, false);
});

test("save stores the current config under a name", () => {
  const data = { ...withProfiles(), models: { implement: "anthropic/new-model" } };
  const result = applyProfileCommand(data, { kind: "save", name: "careful" });
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.deepEqual((result.data.profiles as Record<string, unknown>).careful, {
    models: { implement: "anthropic/new-model" },
  });
  assert.deepEqual(
    (result.data.profiles as Record<string, unknown>).fast,
    { models: { implement: "openai-codex/gpt-5-codex" } },
    "an unrelated profile is untouched",
  );
});

test("save without a name consolidates the active profile", () => {
  const data = { ...withProfiles(), models: { implement: "anthropic/edited" } };
  const result = applyProfileCommand(data, { kind: "save" });
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.deepEqual((result.data.profiles as Record<string, unknown>).fast, { models: { implement: "anthropic/edited" } });
});

test("save without a name and no active profile is refused", () => {
  const result = applyProfileCommand({ models: {} }, { kind: "save" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /activo|nombre/.test(result.message));
});

test("use activates a profile and applies its models", () => {
  const result = applyProfileCommand(withProfiles(), { kind: "use", name: "careful" });
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.equal(result.data.activeProfile, "careful");
  assert.deepEqual(result.data.models, {
    implement: "anthropic/claude-opus-4-1",
    explore: "anthropic/claude-sonnet-4-5",
  });
});

test("use on an unknown profile is refused and lists what exists", () => {
  const result = applyProfileCommand(withProfiles(), { kind: "use", name: "ghost" });
  assert.equal(result.ok, false);
  if (result.ok !== false) return;
  assert.ok(result.message.includes("ghost"));
  assert.ok(result.message.includes("careful") && result.message.includes("fast"));
});

test("delete removes a profile and clears activeProfile when it was active", () => {
  const result = applyProfileCommand(withProfiles(), { kind: "delete", name: "fast" });
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.deepEqual(Object.keys(result.data.profiles as object), ["careful"]);
  assert.equal(result.data.activeProfile, null);
  assert.deepEqual(result.data.models, { implement: "anthropic/claude-opus-4-1" }, "the flat config survives a delete");
});

test("deleting a non-active profile leaves the active one alone", () => {
  const result = applyProfileCommand(withProfiles(), { kind: "delete", name: "careful" });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.data.activeProfile, "fast");
});

test("every verb is pure: the input object is never mutated", () => {
  const data = withProfiles();
  const snapshot = JSON.stringify(data);
  for (const command of [
    { kind: "new" as const, name: "fresh" },
    { kind: "save" as const, name: "fast" },
    { kind: "use" as const, name: "careful" },
    { kind: "delete" as const, name: "fast" },
  ]) {
    applyProfileCommand(data, command);
  }
  assert.equal(JSON.stringify(data), snapshot, "the transforms return new data; the command decides to write");
});

// ---------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------
test("mirroring writes the current config into the active profile", () => {
  const data = { ...withProfiles(), models: { implement: "anthropic/just-edited" } };
  const mirrored = mirrorToActiveProfile(data);
  assert.deepEqual((mirrored.profiles as Record<string, unknown>).fast, {
    models: { implement: "anthropic/just-edited" },
  });
});

test("mirroring with no active profile changes nothing", () => {
  const data = { models: { implement: "anthropic/x" }, profiles: {}, activeProfile: null };
  assert.deepEqual(mirrorToActiveProfile(data), data);
});

// ---------------------------------------------------------------------------
// Thinking levels travel with the models, and only when they exist
// ---------------------------------------------------------------------------
test("a profile reads back the thinking levels it was stored with", () => {
  const result = readProfiles({
    profiles: { fast: { models: { implement: "anthropic/x" }, thinking: { implement: "high" } } },
  });
  assert.deepEqual(result.profiles.fast, {
    models: { implement: "anthropic/x" },
    thinking: { implement: "high" },
  });
  assert.deepEqual(result.defects, []);
});

test("an invalid level is dropped and reported, not written on to frontmatter pi cannot resolve", () => {
  const result = readProfiles({
    profiles: { fast: { models: {}, thinking: { implement: "ultracode", explore: "high" } } },
  });
  assert.deepEqual(result.profiles.fast.thinking, { explore: "high" });
  assert.ok(
    result.defects.some((d) => d.includes("ultracode")),
    `the discarded level must be named: ${JSON.stringify(result.defects)}`,
  );
});

test("a profile with no levels carries no thinking key at all, so the file stays minimal", () => {
  const result = readProfiles({ profiles: { fast: { models: { implement: "anthropic/x" } } } });
  assert.deepEqual(result.profiles.fast, { models: { implement: "anthropic/x" } });
  assert.ok(!("thinking" in result.profiles.fast), "an absent level set must not become an empty object");
});

test("new snapshots the live thinking map into the profile", () => {
  const result = applyProfileCommand(
    { models: { implement: "anthropic/x" }, thinking: { implement: "xhigh" } },
    { kind: "new", name: "fresh" },
  );
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.deepEqual(result.data.profiles, {
    fresh: { models: { implement: "anthropic/x" }, thinking: { implement: "xhigh" } },
  });
});

test("use applies the profile's levels to the live config, and clears them when it has none", () => {
  const withLevels = applyProfileCommand(
    { profiles: { fast: { models: { implement: "anthropic/x" }, thinking: { implement: "low" } } } },
    { kind: "use", name: "fast" },
  );
  assert.equal(withLevels.ok, true);
  if (withLevels.ok !== true) return;
  assert.deepEqual(withLevels.data.thinking, { implement: "low" });

  // A profile with no levels must not leave the previous profile's levels
  // applied to its models: that would run a model at an effort nobody chose.
  const without = applyProfileCommand(
    { thinking: { implement: "low" }, profiles: { plain: { models: { implement: "anthropic/y" } } } },
    { kind: "use", name: "plain" },
  );
  assert.equal(without.ok, true);
  if (without.ok !== true) return;
  assert.ok(!("thinking" in without.data), "the stale level set must be dropped, not carried over");
});

test("mirroring carries the live levels into the active profile", () => {
  const mirrored = mirrorToActiveProfile({
    models: { implement: "anthropic/just-edited" },
    thinking: { implement: "medium" },
    profiles: { fast: { models: { implement: "anthropic/old" } } },
    activeProfile: "fast",
  });
  assert.deepEqual((mirrored.profiles as Record<string, unknown>).fast, {
    models: { implement: "anthropic/just-edited" },
    thinking: { implement: "medium" },
  });
});

test("readThinking keeps only real levels, so a hand-edited file cannot inject one", () => {
  assert.deepEqual(readThinking({ thinking: { implement: "high", explore: "max", track: "low" } }), {
    implement: "high",
    track: "low",
  });
  assert.deepEqual(readThinking({}), {});
  assert.deepEqual(readThinking({ thinking: "broken" }), {});
});
