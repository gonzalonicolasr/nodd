import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CANONICAL_STEPS } from "../manifest.ts";
import { MECHANISM_PLACEHOLDER } from "./slots.ts";
import {
  back,
  createPickerState,
  decodeKey,
  enter,
  navigate,
  pickerTitle,
  previewRows,
  rebuildEntries,
  submitText,
  type PickerState,
} from "./picker.ts";

const groups = new Map([
  ["anthropic", ["claude-opus-4-1", "claude-sonnet-4-5"]],
  ["openai-codex", ["gpt-5-codex"]],
]);

function open(input: Partial<Parameters<typeof createPickerState>[0]> = {}): PickerState {
  return createPickerState({ models: {}, thinking: {}, groups, ...input });
}

/** Move the cursor onto the row of the given kind, failing loudly if absent. */
function focus(state: PickerState, kind: string, value?: string): PickerState {
  const index = state.entries.findIndex((e) => e.kind === kind && (value === undefined || e.value === value));
  assert.ok(index >= 0, `no ${kind} row${value ? ` for ${value}` : ""} in: ${state.entries.map((e) => e.kind)}`);
  return { ...state, cursor: index } as PickerState;
}

/** Enter on the focused row, asserting the picker stays open. */
function press(state: PickerState, kind: string, value?: string): PickerState {
  const result = enter(focus(state, kind, value));
  assert.equal(result.type, "state", `entering ${kind} should keep the picker open`);
  if (result.type !== "state") throw new Error("unreachable");
  return result.state;
}

/** Drill a slot all the way through provider → model → thinking. */
function assign(state: PickerState, slot: string, provider: string, model: string, level: string): PickerState {
  let next = press(state, "slot", slot);
  next = press(next, "provider", provider);
  next = press(next, "model", model);
  return press(next, "thinking-level", level);
}

// ---------------------------------------------------------------------------
// The main menu is profiles, not slots — a profile is what the agents read.
// ---------------------------------------------------------------------------
test("the picker opens on the main screen with the cursor on the first row", () => {
  const state = open();
  assert.equal(state.screen, "main");
  assert.equal(state.cursor, 0);
  assert.ok(state.entries.length > 0);
});

test("the main screen lists one row per profile, sorted, plus new-profile and save", () => {
  const state = open({ profiles: { quick: { models: {} }, careful: { models: {} } } });
  const kinds = state.entries.map((e) => e.kind);
  assert.deepEqual(
    state.entries.filter((e) => e.kind === "profile").map((e) => e.value),
    ["careful", "quick"],
  );
  assert.ok(kinds.includes("new-profile"));
  assert.equal(kinds.at(-1), "save", "save-and-exit is the last row");
});

test("the active profile is marked and the others are not", () => {
  const state = open({ profiles: { quick: { models: {} }, careful: { models: {} } }, activeProfile: "quick" });
  const rows = state.entries.filter((e) => e.kind === "profile");
  assert.match(rows.find((e) => e.value === "quick")!.label, /activo/);
  assert.ok(!/activo/.test(rows.find((e) => e.value === "careful")!.label));
});

test("a profile row summarises the providers it assigns", () => {
  const state = open({
    profiles: { mixed: { models: { implement: "anthropic/claude-opus-4-1", explore: "openai-codex/gpt-5-codex" } } },
  });
  const label = state.entries.find((e) => e.kind === "profile")!.label;
  assert.match(label, /anthropic/);
  assert.match(label, /openai-codex/);
});

test("with no profiles the menu offers editing the loose config; the row goes once one exists", () => {
  assert.ok(open().entries.some((e) => e.kind === "edit-loose"));
  assert.ok(!open({ profiles: { quick: { models: {} } } }).entries.some((e) => e.kind === "edit-loose"));
});

// ---------------------------------------------------------------------------
// The slot screen: NODD's slots, with the four mechanisms shown but inert.
// ---------------------------------------------------------------------------
test("the slot screen shows the two globals and all seven canonical steps in order", () => {
  const slots = press(open(), "edit-loose");
  assert.equal(slots.screen, "slots");
  const shown = slots.entries.filter((e) => e.kind === "slot" || e.kind === "mechanism");
  assert.deepEqual(shown.map((e) => e.value), ["default", "orchestrator", ...CANONICAL_STEPS]);
});

test("the four mechanism rows say mecanismo · sin modelo and cannot be entered", () => {
  const slots = press(open(), "edit-loose");
  const mechanisms = slots.entries.filter((e) => e.kind === "mechanism");
  assert.deepEqual(mechanisms.map((e) => e.value), ["authorize", "classify", "track", "close"]);
  for (const row of mechanisms) {
    assert.ok(row.label.includes(MECHANISM_PLACEHOLDER), `${row.value}: ${row.label}`);
  }

  // Entering one must not open a provider list: the slot does not exist.
  for (const mechanism of mechanisms) {
    const after = press(slots, "mechanism", mechanism.value);
    assert.equal(after.screen, "slots", `${mechanism.value} must not drill anywhere`);
    assert.equal(after.drillSlot, null);
    assert.match(after.notice ?? "", /mecanismo/, "the refusal must say why, not just do nothing");
  }
});

test("navigation never lands the cursor on a mechanism row", () => {
  let state = press(open(), "edit-loose");
  const visited: string[] = [];
  for (let i = 0; i < state.entries.length * 2; i++) {
    visited.push(state.entries[state.cursor].kind);
    state = navigate(state, 1);
  }
  assert.ok(!visited.includes("mechanism"), "the cursor must skip every mechanism row");
  assert.ok(visited.includes("slot"), "the scan must actually have walked the slot rows");
});

test("a slot row shows its model and thinking level, or a placeholder", () => {
  const slots = press(open({ models: { implement: "anthropic/claude-opus-4-1" }, thinking: { implement: "high" } }), "edit-loose");
  const implement = slots.entries.find((e) => e.value === "implement")!;
  assert.match(implement.label, /anthropic\/claude-opus-4-1/);
  assert.match(implement.label, /high/);
  assert.match(slots.entries.find((e) => e.value === "explore")!.label, /sin asignar/);
});

// ---------------------------------------------------------------------------
// Editing: provider → model → thinking, committed atomically at the level.
// ---------------------------------------------------------------------------
test("entering a slot opens the providers of the live registry, sorted, plus a custom row", () => {
  const providers = press(press(open(), "edit-loose"), "slot", "implement");
  assert.equal(providers.screen, "provider");
  assert.equal(providers.drillSlot, "implement");
  assert.deepEqual(
    providers.entries.filter((e) => e.kind === "provider").map((e) => e.value),
    ["anthropic", "openai-codex"],
  );
  assert.ok(providers.entries.some((e) => e.kind === "custom-provider"));
});

test("entering a provider opens that provider's models plus a custom row", () => {
  const models = press(press(press(open(), "edit-loose"), "slot", "implement"), "provider", "anthropic");
  assert.equal(models.screen, "model");
  assert.equal(models.drillProvider, "anthropic");
  assert.deepEqual(
    models.entries.filter((e) => e.kind === "model").map((e) => e.value),
    ["claude-opus-4-1", "claude-sonnet-4-5"],
  );
  assert.ok(models.entries.some((e) => e.kind === "custom-model"));
});

test("with no registry the provider screen is skipped: there is nothing to list", () => {
  const state = press(press(open({ groups: new Map() }), "edit-loose"), "slot", "implement");
  assert.equal(state.screen, "model", "an empty provider list must not be shown as a screen");
  assert.equal(state.drillProvider, null);
  assert.ok(state.entries.some((e) => e.kind === "custom-model"), "the typed escape is the only way through");

  // A bare model id with no provider is what the registry-free path produces,
  // and it is exactly what `validateAssignment` accepts. The typed row has to be
  // entered first: `submitText` only commits against an open prompt.
  const typed = submitText(press(state, "custom-model"), "some-model");
  const committed = press(press(typed, "thinking-level", "medium"), "slot", "implement");
  assert.equal(committed.edits.models.implement, "some-model");
});

test("choosing a model stages nothing yet: it advances to the thinking screen", () => {
  let state = press(press(open(), "edit-loose"), "slot", "implement");
  state = press(state, "provider", "anthropic");
  state = press(state, "model", "claude-opus-4-1");

  assert.equal(state.screen, "thinking");
  assert.equal(state.drillModel, "claude-opus-4-1");
  assert.deepEqual(state.edits.models, {}, "nothing is committed before a level is chosen");
  assert.equal(state.edits.changed, false);
});

test("the thinking screen offers exactly the six real levels", () => {
  let state = press(press(open(), "edit-loose"), "slot", "implement");
  state = press(press(state, "provider", "anthropic"), "model", "claude-opus-4-1");
  assert.deepEqual(state.entries.map((e) => e.value), ["off", "minimal", "low", "medium", "high", "xhigh"]);
});

test("choosing a level commits provider, model and level together, and returns to the slots", () => {
  const state = assign(press(open(), "edit-loose"), "implement", "anthropic", "claude-opus-4-1", "xhigh");

  assert.deepEqual(state.edits.models, { implement: "anthropic/claude-opus-4-1" });
  assert.deepEqual(state.edits.thinking, { implement: "xhigh" });
  assert.equal(state.edits.changed, true);
  assert.equal(state.screen, "slots");
  assert.equal(state.drillSlot, null, "the drill context is cleared after the commit");
  assert.equal(state.drillModel, null);
});

test("escaping the thinking screen commits no partial edit", () => {
  let state = press(press(open(), "edit-loose"), "slot", "implement");
  state = press(press(state, "provider", "anthropic"), "model", "claude-opus-4-1");

  const result = back(state);
  assert.equal(result.type, "state");
  if (result.type !== "state") return;
  assert.deepEqual(result.state.edits.models, {}, "a model with no level must not be written");
  assert.deepEqual(result.state.edits.thinking, {});
  assert.equal(result.state.drillModel, null);
  assert.equal(result.state.screen, "slots");
});

test("a typed provider and a typed model reach the same commit path", () => {
  let state = press(press(open(), "edit-loose"), "slot", "implement");
  state = press(state, "custom-provider");
  assert.equal(state.textPrompt?.for, "provider");

  state = submitText(state, "  my-provider  ");
  assert.equal(state.screen, "model", "a typed provider advances to the model list");
  assert.equal(state.drillProvider, "my-provider", "the typed value is trimmed");
  assert.equal(state.textPrompt, null);

  state = press(state, "custom-model");
  state = submitText(state, "my-model");
  assert.equal(state.screen, "thinking", "a typed model still goes through the level screen");
  state = press(state, "thinking-level", "low");
  assert.deepEqual(state.edits.models, { implement: "my-provider/my-model" });
  assert.deepEqual(state.edits.thinking, { implement: "low" });
});

test("an empty typed value commits nothing and just closes the prompt", () => {
  let state = press(press(open(), "edit-loose"), "slot", "implement");
  state = press(state, "custom-provider");
  const after = submitText(state, "   ");
  assert.equal(after.textPrompt, null);
  assert.equal(after.screen, "provider", "the list comes back unchanged");
  assert.equal(after.drillProvider, null);
});

// ---------------------------------------------------------------------------
// Profiles: create, edit, activate, duplicate, delete — all staged.
// ---------------------------------------------------------------------------
test("opening a profile offers activate, edit, duplicate and delete", () => {
  const state = press(open({ profiles: { quick: { models: {} } } }), "profile", "quick");
  assert.equal(state.screen, "profile-actions");
  assert.equal(state.drillProfile, "quick");
  assert.deepEqual(state.entries.map((e) => e.kind), [
    "profile-use",
    "profile-edit",
    "profile-duplicate",
    "profile-delete",
  ]);
});

test("the already-active profile says so instead of offering activation", () => {
  const state = press(open({ profiles: { quick: { models: {} } }, activeProfile: "quick" }), "profile", "quick");
  assert.deepEqual(state.entries.map((e) => e.kind), [
    "profile-active-noop",
    "profile-edit",
    "profile-duplicate",
    "profile-delete",
  ]);
  // The informational row does nothing at all.
  const after = press(state, "profile-active-noop");
  assert.equal(after.screen, "profile-actions");
});

test("editing a profile loads its slots without activating it", () => {
  let state = open({
    profiles: { quick: { models: { implement: "openai-codex/gpt-5-codex" }, thinking: { implement: "low" } } },
    activeProfile: null,
  });
  state = press(press(state, "profile", "quick"), "profile-edit");

  assert.equal(state.screen, "slots");
  assert.equal(state.edits.editingProfile, "quick");
  assert.equal(state.edits.activeProfile, null, "editing is not activating");
  assert.deepEqual(state.edits.models, { implement: "openai-codex/gpt-5-codex" });
  assert.deepEqual(state.edits.thinking, { implement: "low" });
});

test("the title names what is being edited and whether it is active", () => {
  const state = open({ profiles: { quick: { models: {} }, slow: { models: {} } }, activeProfile: "quick" });
  assert.match(pickerTitle(state), /nodd/);

  const editingActive = press(press(state, "profile", "quick"), "profile-edit");
  assert.match(pickerTitle(editingActive), /quick/);
  assert.match(pickerTitle(editingActive), /activo/);

  const editingOther = press(press(state, "profile", "slow"), "profile-edit");
  assert.match(pickerTitle(editingOther), /slow/);
  assert.match(pickerTitle(editingOther), /no activo/);

  assert.match(pickerTitle(press(open(), "edit-loose")), /sin perfil/);
});

test("creating the first profile names it in the title, not 'sin perfil'", () => {
  // The first profile activates itself, and the slots opened right after are
  // that profile's. A title reading "sin perfil" while editing «rapido» tells
  // the user their choices are going somewhere other than where they are going.
  const created = submitText(press(open(), "new-profile"), "rapido");

  assert.equal(created.screen, "slots");
  assert.match(pickerTitle(created), /rapido/);
  assert.ok(!/sin perfil/.test(pickerTitle(created)), "the slots being edited belong to the new profile");
});

test("an edit lands in the profile being edited, not in the active one", () => {
  let state = open({
    profiles: { quick: { models: { implement: "openai-codex/gpt-5-codex" } }, slow: { models: {} } },
    activeProfile: "quick",
  });
  state = press(press(state, "profile", "slow"), "profile-edit");
  state = assign(state, "implement", "anthropic", "claude-opus-4-1", "high");

  const result = back(state);
  assert.equal(result.type, "state");
  if (result.type !== "state") return;
  assert.deepEqual(result.state.edits.profiles.slow, {
    models: { implement: "anthropic/claude-opus-4-1" },
    thinking: { implement: "high" },
  });
  assert.deepEqual(
    result.state.edits.profiles.quick,
    { models: { implement: "openai-codex/gpt-5-codex" } },
    "the active profile must not be touched by editing another",
  );
});

test("leaving the slot screen folds the edits into the profile they belong to", () => {
  let state = open({ profiles: { quick: { models: {} } }, activeProfile: "quick" });
  state = press(press(state, "profile", "quick"), "profile-edit");
  state = assign(state, "explore", "anthropic", "claude-sonnet-4-5", "medium");
  assert.deepEqual(state.edits.profiles.quick, { models: {} }, "not folded in until the screen is left");

  const result = back(state);
  assert.equal(result.type, "state");
  if (result.type !== "state") return;
  assert.deepEqual(result.state.edits.profiles.quick.models, { explore: "anthropic/claude-sonnet-4-5" });
});

test("activating a profile switches the live models and says a restart is needed", () => {
  let state = open({
    profiles: { quick: { models: { implement: "openai-codex/gpt-5-codex" } }, slow: { models: {} } },
    activeProfile: "slow",
  });
  state = press(press(state, "profile", "quick"), "profile-use");

  assert.equal(state.edits.activeProfile, "quick");
  assert.deepEqual(state.edits.models, { implement: "openai-codex/gpt-5-codex" });
  assert.equal(state.screen, "main");
  assert.match(state.notice ?? "", /quick/);
});

test("creating a profile asks for a name, then opens its slots", () => {
  let state = press(open(), "new-profile");
  assert.equal(state.textPrompt?.for, "new-profile");

  state = submitText(state, "fresh");
  assert.equal(state.screen, "slots");
  assert.ok("fresh" in state.edits.profiles);
  assert.equal(state.edits.activeProfile, "fresh", "the very first profile is activated on creation");
});

test("creating a second profile does not steal the activation", () => {
  let state = open({ profiles: { quick: { models: {} } }, activeProfile: "quick" });
  state = submitText(press(state, "new-profile"), "second");
  assert.equal(state.edits.activeProfile, "quick");
  assert.equal(state.edits.editingProfile, "second");
});

test("an invalid or duplicate name creates nothing and says why", () => {
  for (const bad of ["Bad Name", "use", ""]) {
    const state = submitText(press(open(), "new-profile"), bad);
    assert.deepEqual(state.edits.profiles, {}, `${bad} must create nothing`);
    if (bad !== "") assert.match(state.notice ?? "", /inválido|invalido/i, `${bad} must be explained`);
  }

  const dup = submitText(press(open({ profiles: { quick: { models: {} } } }), "new-profile"), "quick");
  assert.match(dup.notice ?? "", /quick/);
  assert.deepEqual(Object.keys(dup.edits.profiles), ["quick"], "an existing profile is never overwritten by a name");
});

test("duplicating clones the chosen profile under a new name", () => {
  let state = open({ profiles: { quick: { models: { implement: "anthropic/claude-opus-4-1" } } } });
  state = press(press(state, "profile", "quick"), "profile-duplicate");
  assert.equal(state.textPrompt?.for, "duplicate-profile");

  state = submitText(state, "copy");
  assert.deepEqual(state.edits.profiles.copy, { models: { implement: "anthropic/claude-opus-4-1" } });
  assert.equal(state.screen, "main");
});

test("deleting a profile drops it and clears the activation it held", () => {
  let state = open({ profiles: { quick: { models: {} }, slow: { models: {} } }, activeProfile: "quick" });
  state = press(press(state, "profile", "quick"), "profile-delete");

  assert.deepEqual(Object.keys(state.edits.profiles), ["slow"]);
  assert.equal(state.edits.activeProfile, null);
  assert.equal(state.screen, "main");
  assert.match(state.notice ?? "", /quick/);
});

// ---------------------------------------------------------------------------
// Going back, and leaving without writing.
// ---------------------------------------------------------------------------
test("esc walks back one screen at a time: model → provider is not skipped", () => {
  let state = press(press(open(), "edit-loose"), "slot", "implement");
  state = press(state, "provider", "anthropic");

  const toProvider = back(state);
  assert.equal(toProvider.type, "state");
  if (toProvider.type !== "state") return;
  assert.equal(toProvider.state.screen, "provider", "esc from the models returns to the providers");
  assert.equal(toProvider.state.drillProvider, null);

  const toSlots = back(toProvider.state);
  assert.equal(toSlots.type === "state" && toSlots.state.screen, "slots");
});

test("esc from the slot screen returns to the menu, and from the menu it quits", () => {
  const slots = press(open(), "edit-loose");
  const toMain = back(slots);
  assert.equal(toMain.type === "state" && toMain.state.screen, "main");

  assert.deepEqual(back(toMain.type === "state" ? toMain.state : slots), { type: "quit" });
});

test("quit is the only way out that writes nothing, and save carries the edits", () => {
  let state = assign(press(open(), "edit-loose"), "implement", "anthropic", "claude-opus-4-1", "high");
  const toMain = back(state);
  assert.equal(toMain.type, "state");
  if (toMain.type !== "state") return;

  assert.deepEqual(back(toMain.state), { type: "quit" }, "quit returns no edits at all");

  const saved = enter(focus(toMain.state, "save"));
  assert.equal(saved.type, "save");
  if (saved.type !== "save") return;
  assert.deepEqual(saved.state.edits.models, { implement: "anthropic/claude-opus-4-1" });
  assert.deepEqual(saved.state.edits.thinking, { implement: "high" });
});

test("saving folds the open edits into their profile first", () => {
  let state = open({ profiles: { quick: { models: {} } }, activeProfile: "quick" });
  state = press(press(state, "profile", "quick"), "profile-edit");
  state = assign(state, "implement", "anthropic", "claude-opus-4-1", "high");

  // Save lives on the main menu, so this leaves the slot screen first — which is
  // the point: the edits have to survive the trip and land in their profile.
  const menu = back(state);
  assert.equal(menu.type, "state");
  if (menu.type !== "state") return;

  const saved = enter(focus(menu.state, "save"));
  assert.equal(saved.type, "save");
  if (saved.type !== "save") return;
  assert.deepEqual(saved.state.edits.profiles.quick.models, { implement: "anthropic/claude-opus-4-1" });
});

// ---------------------------------------------------------------------------
// Rows, cursors and keys.
// ---------------------------------------------------------------------------
test("rebuildEntries is idempotent and clamps a cursor past the last row", () => {
  const state = open({ profiles: { quick: { models: {} } } });
  assert.deepEqual(rebuildEntries({ ...state }).entries, state.entries);

  const clamped = rebuildEntries({ ...state, cursor: 99 });
  assert.equal(clamped.cursor, clamped.entries.length - 1);
  assert.equal(rebuildEntries({ ...state, cursor: -5 }).cursor, 0);
});

test("the cursor wraps at both ends", () => {
  const state = open({ profiles: { quick: { models: {} } } });
  assert.equal(navigate({ ...state, cursor: 0 }, -1).cursor, state.entries.length - 1);
  assert.equal(navigate({ ...state, cursor: state.entries.length - 1 }, 1).cursor, 0);
  assert.equal(navigate({ ...state, cursor: 0 }, 1).cursor, 1);
});

test("decodeKey accepts the legacy, SS3 and kitty forms of every picker key", () => {
  assert.equal(decodeKey("\u001b[A"), "up");
  assert.equal(decodeKey("\u001bOA"), "up");
  assert.equal(decodeKey("\u001b[1;1:1A"), "up", "kitty press");
  assert.equal(decodeKey("\u001b[1;1:2A"), "up", "kitty repeat: holding the key scrolls");
  assert.equal(decodeKey("\u001b[B"), "down");
  assert.equal(decodeKey("\u001b[1;1:1B"), "down");
  assert.equal(decodeKey("\r"), "enter");
  assert.equal(decodeKey("\n"), "enter");
  assert.equal(decodeKey("\u001b[13u"), "enter");
  assert.equal(decodeKey("\u001b"), "esc");
  assert.equal(decodeKey("\u001b[27u"), "esc");
  assert.equal(decodeKey("\u007f"), "backspace");
  assert.equal(decodeKey("\u001b[127u"), "backspace");
});

test("decodeKey ignores releases, modified keys and printable text", () => {
  assert.equal(decodeKey("\u001b[1;1:3A"), null, "a key release must not navigate");
  assert.equal(decodeKey("\u001b[1;5A"), null, "ctrl+up is not a picker key");
  assert.equal(decodeKey("q"), null);
  assert.equal(decodeKey("A"), null);
  assert.equal(decodeKey(""), null);
});

// ---------------------------------------------------------------------------
// The module boundary is the point: no fs, no pi, no TUI.
// ---------------------------------------------------------------------------
test("the picker imports no node:fs, no pi and no TUI package", () => {
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

test("no transition writes: every one returns state the caller may discard", () => {
  // The guarantee behind "quit writes nothing" is structural, not a promise about
  // a code path: the module cannot write, so only the command can.
  const source = readFileSync(new URL("./picker.ts", import.meta.url), "utf8");
  assert.ok(!/writeFileSync|readFileSync/.test(source), "the state machine performs no IO");
});

// ---------------------------------------------------------------------------
// The preview panel
// ---------------------------------------------------------------------------

test("the preview shows the profile under the cursor, model and level per slot", () => {
  const state = createPickerState({
    models: {},
    thinking: {},
    groups: new Map(),
    profiles: {
      rapido: {
        models: { implement: "cliproxy/ds/deepseek-v4-pro", explore: "cliproxy/ds/deepseek-flash" },
        thinking: { implement: "high", explore: "low" },
      },
      lento: { models: { implement: "cliproxy/personal/claude-opus-5" }, thinking: { implement: "xhigh" } },
    },
    activeProfile: "rapido",
  });

  // The menu is alphabetical, so the cursor opens on `lento`; one row down is
  // `rapido`, and the preview follows the cursor rather than the active profile.
  const rows = previewRows(navigate(state, 1)).map((row) => row.text);
  assert.match(rows[0], /vista previa · rapido \(activo\)/, "the profile under the cursor is named");
  assert.ok(rows.some((r) => /implement\s+→ cliproxy\/ds\/deepseek-v4-pro · high/.test(r)), rows.join("\n"));
  assert.ok(rows.some((r) => /explore\s+→ cliproxy\/ds\/deepseek-flash · low/.test(r)), rows.join("\n"));
  assert.ok(rows.some((r) => r.includes("proveedores: cliproxy")), "the providers are summarised");
});

test("the preview marks mechanism steps rather than pretending they take a model", () => {
  const state = createPickerState({
    models: {}, thinking: {}, groups: new Map(),
    profiles: { p: { models: {}, thinking: {} } }, activeProfile: "p",
  });
  const rows = previewRows(state).map((row) => row.text);
  assert.ok(rows.some((r) => r.includes("authorize") && r.includes(MECHANISM_PLACEHOLDER)), rows.join("\n"));
});

test("with no profile at all there is nothing to preview", () => {
  const state = createPickerState({ models: {}, thinking: {}, groups: new Map(), profiles: {}, activeProfile: null });
  assert.deepEqual(previewRows(state), [], "an empty preview is what suppresses the second panel");
});

test("choosing through a prefixed group does not double the prefix", () => {
  // The group key is `cliproxy/ds` and the id inside it is `ds/deepseek-v4-pro`:
  // joining them naively produced `cliproxy/ds/ds/deepseek-v4-pro`, a model id
  // that resolves to nothing. The key's prefix belongs to the id, not to the
  // provider, so only the provider part may be prepended.
  let state = open({ groups: new Map([["cliproxy/ds", ["ds/deepseek-v4-pro"]]]) });
  state = press(state, "edit-loose");
  state = assign(state, "implement", "cliproxy/ds", "ds/deepseek-v4-pro", "high");

  assert.equal(state.edits.models.implement, "cliproxy/ds/deepseek-v4-pro");
  assert.equal(state.edits.thinking.implement, "high");
});
