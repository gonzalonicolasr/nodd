import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CANONICAL_STEPS } from "../manifest.ts";
import { MECHANISM_PLACEHOLDER } from "./slots.ts";
import { createPickerState, enter, moveCursor, renderRows, type PickerState } from "./picker.ts";

const groups = new Map([
  ["anthropic", ["claude-sonnet-4-5", "claude-opus-4-1"]],
  ["openai-codex", ["gpt-5-codex"]],
]);

function open(models: Record<string, string> = {}): PickerState {
  return createPickerState({ models, groups });
}

// ---------------------------------------------------------------------------
// Display: seven steps, four of them mechanisms.
// ---------------------------------------------------------------------------
test("all seven canonical steps are displayed in protocol order", () => {
  const rows = renderRows(open());
  const stepRows = rows.filter((row) => row.kind === "step" || row.kind === "mechanism");
  assert.deepEqual(stepRows.map((row) => row.id), [...CANONICAL_STEPS]);
  assert.equal(stepRows.length, 7);
});

test("the four mechanism rows say mecanismo · sin modelo and are not selectable", () => {
  const mechanisms = renderRows(open()).filter((row) => row.kind === "mechanism");
  assert.deepEqual(mechanisms.map((row) => row.id), ["authorize", "classify", "track", "close"]);
  for (const row of mechanisms) {
    assert.equal(row.value, MECHANISM_PLACEHOLDER);
    assert.equal(row.selectable, false, `${row.id} must not be selectable`);
  }
});

test("an assigned slot displays its model, an unassigned one its placeholder", () => {
  const rows = renderRows(open({ implement: "anthropic/claude-opus-4-1" }));
  assert.equal(rows.find((row) => row.id === "implement")!.value, "anthropic/claude-opus-4-1");
  assert.equal(rows.find((row) => row.id === "explore")!.value, "sin asignar");
});

test("there is a save row and a quit row, and they are selectable", () => {
  const rows = renderRows(open());
  const actions = rows.filter((row) => row.kind === "action");
  assert.deepEqual(actions.map((row) => row.id), ["save", "quit"]);
  for (const row of actions) assert.equal(row.selectable, true);
});

// ---------------------------------------------------------------------------
// Navigation skips the non-selectable rows.
// ---------------------------------------------------------------------------
test("the cursor starts on the first selectable row", () => {
  const rows = renderRows(open());
  assert.equal(rows[open().cursor].selectable, true);
  assert.equal(rows[open().cursor].id, "default");
});

test("navigation skips mechanism rows entirely", () => {
  let state = open();
  const visited: string[] = [];
  for (let i = 0; i < 12; i++) {
    visited.push(renderRows(state)[state.cursor].id);
    state = moveCursor(state, 1);
  }
  for (const mechanism of ["authorize", "classify", "track", "close"]) {
    assert.ok(!visited.includes(mechanism), `the cursor must never land on ${mechanism}`);
  }
  assert.deepEqual([...new Set(visited)], ["default", "orchestrator", "explore", "resolve-uncertainty", "implement", "save", "quit"]);
});

test("the cursor wraps at both ends and never leaves a selectable row", () => {
  let state = open();
  const up = moveCursor(state, -1);
  assert.equal(renderRows(up)[up.cursor].id, "quit", "moving up from the top wraps to the last row");

  for (let i = 0; i < 30; i++) {
    state = moveCursor(state, i % 2 === 0 ? 1 : -1);
    assert.equal(renderRows(state)[state.cursor].selectable, true);
  }
});

// ---------------------------------------------------------------------------
// Outcomes: quit writes nothing, save returns the assignment set.
// ---------------------------------------------------------------------------
test("quit returns no changes", () => {
  let state = open({ implement: "anthropic/claude-opus-4-1" });
  state = { ...state, staged: { ...state.staged, explore: "openai-codex/gpt-5-codex" } };

  const rows = renderRows(state);
  state = { ...state, cursor: rows.findIndex((row) => row.id === "quit") };

  assert.deepEqual(enter(state), { type: "quit" });
});

test("save returns the staged assignment set", () => {
  let state = open({ implement: "anthropic/claude-opus-4-1" });
  state = { ...state, staged: { ...state.staged, explore: "openai-codex/gpt-5-codex" } };

  const rows = renderRows(state);
  state = { ...state, cursor: rows.findIndex((row) => row.id === "save") };

  assert.deepEqual(enter(state), {
    type: "save",
    models: { implement: "anthropic/claude-opus-4-1", explore: "openai-codex/gpt-5-codex" },
  });
});

test("entering a slot row opens that slot's model list", () => {
  const state = open();
  const result = enter(state);
  assert.equal(result.type, "choose");
  if (result.type !== "choose") return;
  assert.equal(result.slot, "default");
  assert.deepEqual(result.options, ["anthropic/claude-sonnet-4-5", "anthropic/claude-opus-4-1", "openai-codex/gpt-5-codex"]);
});

test("staging a choice does not write and is visible in the rows", () => {
  let state = open();
  state = { ...state, staged: { ...state.staged, default: "anthropic/claude-opus-4-1" } };
  assert.equal(renderRows(state).find((row) => row.id === "default")!.value, "anthropic/claude-opus-4-1");
  assert.deepEqual(open().staged, {}, "the initial state stages nothing");
});

// ---------------------------------------------------------------------------
// The module boundary is the point: no fs, no pi, no TUI.
// ---------------------------------------------------------------------------
test("the picker imports no node:fs, no pi and no TUI package", () => {
  // Comments are free to name what the module refuses to import; executable
  // lines are not.
  const source = readFileSync(new URL("./picker.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!source.includes("node:fs"), "the picker must not touch the filesystem");
  assert.ok(!source.includes("@earendil-works/"), "the picker must not import pi or its TUI package");
  const imports = [...source.matchAll(/from "([^"]+)";/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, "the scan must actually find the imports");
  for (const specifier of imports) {
    assert.ok(specifier.startsWith("."), `unexpected external import: ${specifier}`);
  }
});
