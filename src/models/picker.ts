// The picker's decisions, as a pure state machine.
//
// Adapted from `zero-models-picker.ts` — adapted, never imported. Dependency-free
// by design: no `node:fs`, no pi, and above all no TUI package, not even as a
// type. The host in `extensions/nodd-models.ts` owns rendering and keystrokes and
// holds one `PickerState`; every navigation and staging decision is here, where
// `node --test` can reach it without a terminal.
//
// Three properties the tests pin down, because all three are easy to lose in a
// refactor:
//
//  1. The four mechanism rows are displayed but never enterable, and entering one
//     explains why rather than doing nothing. A cursor that can land on
//     `classify` implies a slot that does not exist.
//  2. This module writes nothing. It returns outcomes; the command decides. That
//     is what makes "quit writes nothing" structural instead of a promise about a
//     code path.
//  3. Model, provider and level commit together, at the level screen. Escaping
//     before it leaves the slot exactly as it was — a model saved without a level
//     would run at an effort nobody chose.
//
// Forge's autotune screen is deliberately absent: autotune is a forge feature and
// NODD has no learning loop to configure.

import { MECHANISM_PLACEHOLDER, SLOT_ROWS, isMechanismSlot } from "./slots.ts";
import { THINKING_LEVELS, type SlotThinking, type ThinkingLevel } from "./thinking.ts";
import { isValidProfileName, type Profile } from "./profiles.ts";

/** Which sub-screen the picker is showing. */
export type Screen = "main" | "slots" | "provider" | "model" | "thinking" | "profile-actions";

/** One row of the current screen. */
export type MenuEntry = {
  kind:
    | "profile" // a concrete profile                    (main)
    | "new-profile" // — nuevo perfil —                  (main)
    | "edit-loose" // configurar sin perfil              (main, only with none)
    | "save" // — guardar y salir —                      (main)
    | "profile-use" // activar                           (profile-actions)
    | "profile-active-noop" // ya está activo            (profile-actions)
    | "profile-edit" // editar modelos por slot          (profile-actions)
    | "profile-duplicate" // duplicar                    (profile-actions)
    | "profile-delete" // borrar                         (profile-actions)
    | "slot" // an assignable slot                       (slots)
    | "mechanism" // a displayed, inert canonical step   (slots)
    | "provider" // a concrete provider id               (provider)
    | "custom-provider" // — otro provider (escribir) —
    | "model" // a concrete model id                     (model)
    | "custom-model" // — otro modelo (escribir) —
    | "thinking-level"; // off | minimal | … | xhigh     (thinking)
  label: string;
  /** Payload: profile name, slot id, provider id, model id or level. */
  value: string;
};

/** Edits accumulated in memory. Written to `nodd.json` once, on save. */
export type StagedEdits = {
  /** slot -> `provider/model`, for the slot set currently being edited. */
  models: Record<string, string>;
  /** slot -> level, parallel to `models`. Partial: an absent slot has no level. */
  thinking: SlotThinking;
  /** Any slot assignment changed. */
  changed: boolean;
  profiles: Record<string, Profile>;
  activeProfile: string | null;
  /**
   * The profile the maps above are editing. `null` means the loose config, which
   * is the active profile's content when there is one. Distinct from
   * `activeProfile`: a profile can be edited without being activated.
   */
  editingProfile: string | null;
  /** A profile was created, deleted, duplicated or activated. */
  profilesChanged: boolean;
};

export type PickerState = {
  screen: Screen;
  cursor: number;
  /** Rows of the current screen — derived, never hand-mutated. */
  entries: MenuEntry[];
  edits: StagedEdits;
  /** provider -> model ids, captured from pi's registry when the picker opened. */
  groups: Map<string, string[]>;
  /** Drill context: the slot being edited. */
  drillSlot: string | null;
  /** Drill context: the provider chosen so far. */
  drillProvider: string | null;
  /** Drill context: the model chosen, awaiting a level. Held out of `edits`. */
  drillModel: string | null;
  /** Drill context: the profile chosen from the list. */
  drillProfile: string | null;
  /**
   * Has a slot been edited since these maps were loaded? Decides whether to fold
   * them into the target profile. `edits.changed` will not do: it is sticky for
   * the whole picker, so after editing one profile, opening a second would fold
   * untouched maps over it.
   */
  dirtySinceLoad: boolean;
  /** When set, the host shows an inline text input for this. */
  textPrompt: { for: "provider" | "model" | "new-profile" | "duplicate-profile"; label: string } | null;
  /** A one-line notice under the title. Cleared by the next transition. */
  notice: string | null;
};

export type EnterResult =
  | { type: "state"; state: PickerState } // stay open, re-render
  | { type: "save"; state: PickerState } // close, persist the edits
  | { type: "quit" }; // close, write nothing

const CUSTOM_PROVIDER_LABEL = "— otro provider (escribir) —";
const CUSTOM_MODEL_LABEL = "— otro modelo (escribir) —";
const SAVE_LABEL = "— guardar y salir —";
const NEW_PROFILE_LABEL = "— nuevo perfil —";
const LOOSE_LABEL = "— configurar modelos sin perfil —";

export function createPickerState(input: {
  models: Record<string, string>;
  thinking: SlotThinking;
  groups: Map<string, string[]>;
  profiles?: Record<string, Profile>;
  activeProfile?: string | null;
}): PickerState {
  return rebuildEntries({
    screen: "main",
    cursor: 0,
    entries: [],
    edits: {
      models: { ...input.models },
      thinking: { ...input.thinking },
      changed: false,
      profiles: cloneProfiles(input.profiles ?? {}),
      activeProfile: input.activeProfile ?? null,
      // Editing starts on the live config, which is the active profile's content
      // when there is one: so opening the picker and touching a slot edits it.
      editingProfile: null,
      profilesChanged: false,
    },
    groups: input.groups,
    drillSlot: null,
    drillProvider: null,
    drillModel: null,
    drillProfile: null,
    dirtySinceLoad: false,
    textPrompt: null,
    notice: null,
  });
}

/** Deep copy: staged edits must never mutate what the caller read from disk. */
function cloneProfiles(profiles: Record<string, Profile>): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const [name, profile] of Object.entries(profiles)) out[name] = cloneProfile(profile);
  return out;
}

function cloneProfile(profile: Profile): Profile {
  return profile.thinking
    ? { models: { ...profile.models }, thinking: { ...profile.thinking } }
    : { models: { ...profile.models } };
}

/** The maps being edited, as a profile. `thinking` is omitted when empty. */
function snapshotEdits(edits: StagedEdits): Profile {
  return Object.keys(edits.thinking).length > 0
    ? { models: { ...edits.models }, thinking: { ...edits.thinking } }
    : { models: { ...edits.models } };
}

/**
 * Fold the maps being edited into the profile they belong to.
 *
 * The target is the profile being edited, or the active one when editing the
 * loose config. With neither there is nowhere to fold and the maps stay as the
 * flat config.
 *
 * Only folds when a slot was actually edited since these maps were loaded.
 * Without that guard, merely opening another profile would overwrite the target
 * with maps nobody touched.
 */
function flushEdits(state: PickerState): PickerState {
  if (!state.dirtySinceLoad) return state;
  const target = state.edits.editingProfile ?? state.edits.activeProfile;
  if (target === null) return state;
  return {
    ...state,
    edits: { ...state.edits, profiles: { ...state.edits.profiles, [target]: snapshotEdits(state.edits) } },
    dirtySinceLoad: false,
  };
}

/** Load a profile into the editing maps, folding the previous one first. */
function loadProfile(state: PickerState, name: string): PickerState {
  const profile = state.edits.profiles[name];
  if (profile === undefined) return state;
  const flushed = flushEdits(state);
  return {
    ...flushed,
    edits: {
      ...flushed.edits,
      models: { ...profile.models },
      thinking: { ...(profile.thinking ?? {}) },
      editingProfile: name,
    },
    dirtySinceLoad: false,
  };
}

/** The frame title: always say what is being touched. */
export function pickerTitle(state: PickerState): string {
  if (state.screen === "main") return "nodd · perfiles de modelos";
  if (state.screen === "profile-actions") return `nodd · perfil «${state.drillProfile ?? ""}»`;

  const editing = state.edits.editingProfile;
  if (editing === null) return "nodd · modelos sin perfil";
  return `nodd · perfil «${editing}»${editing === state.edits.activeProfile ? " · activo" : " · no activo"}`;
}

// ---------------------------------------------------------------------------
// Rows per screen
// ---------------------------------------------------------------------------

/** The providers a profile assigns — a short summary for its menu row. */
function profileSummary(profile: Profile): string {
  const providers = new Set<string>();
  for (const value of Object.values(profile.models)) {
    const slash = value.indexOf("/");
    if (slash > 0) providers.add(value.slice(0, slash));
  }
  return [...providers].sort().join(", ");
}

function profileRowLabel(state: PickerState, name: string): string {
  const active = name === state.edits.activeProfile;
  const bits = [active ? "activo" : "", profileSummary(state.edits.profiles[name])].filter((s) => s !== "");
  return `${active ? "●" : "○"} ${name}${bits.length > 0 ? `   (${bits.join(" · ")})` : ""}`;
}

function mainEntries(state: PickerState): MenuEntry[] {
  const entries: MenuEntry[] = [];

  // Profiles first: a profile is what the generated agents actually read.
  for (const name of Object.keys(state.edits.profiles).sort()) {
    entries.push({ kind: "profile", label: profileRowLabel(state, name), value: name });
  }
  entries.push({ kind: "new-profile", label: NEW_PROFILE_LABEL, value: "" });

  // The loose config is only offered while no profile exists — it is the state of
  // someone who has not migrated, and the row goes when the first one is created.
  if (Object.keys(state.edits.profiles).length === 0) {
    entries.push({ kind: "edit-loose", label: LOOSE_LABEL, value: "loose" });
  }

  entries.push({ kind: "save", label: SAVE_LABEL, value: "save" });
  return entries;
}

function profileActionEntries(state: PickerState): MenuEntry[] {
  const name = state.drillProfile ?? "";
  const isActive = name === state.edits.activeProfile;
  return [
    isActive
      ? { kind: "profile-active-noop" as const, label: "● ya es el perfil activo", value: name }
      : { kind: "profile-use" as const, label: "activar — los agentes de NODD usan este", value: name },
    { kind: "profile-edit" as const, label: "editar modelos por slot…", value: name },
    { kind: "profile-duplicate" as const, label: "duplicar en un perfil nuevo…", value: name },
    {
      kind: "profile-delete" as const,
      label: isActive ? "borrar (queda sin perfil activo)" : "borrar",
      value: name,
    },
  ];
}

/**
 * The slot screen: the two globals, then the seven canonical steps in protocol
 * order. The four mechanisms are rows like any other — visible, so the mechanized
 * half of ODD stays legible — but their kind makes them inert.
 */
function slotEntries(state: PickerState): MenuEntry[] {
  const width = Math.max(...SLOT_ROWS.map((row) => row.id.length));
  return SLOT_ROWS.map((row): MenuEntry => {
    if (isMechanismSlot(row.id)) {
      return { kind: "mechanism", label: `${row.id.padEnd(width)}   ·   ${row.placeholder}`, value: row.id };
    }
    const model = state.edits.models[row.id] ?? row.placeholder;
    const level = state.edits.thinking[row.id];
    return {
      kind: "slot",
      label: `${row.id.padEnd(width)}   →   ${model}${level ? ` · thinking ${level}` : ""}`,
      value: row.id,
    };
  });
}

function providerEntries(state: PickerState): MenuEntry[] {
  const entries: MenuEntry[] = [...state.groups.keys()]
    .sort()
    .map((provider) => ({ kind: "provider" as const, label: provider, value: provider }));
  entries.push({ kind: "custom-provider", label: CUSTOM_PROVIDER_LABEL, value: "" });
  return entries;
}

function modelEntries(state: PickerState): MenuEntry[] {
  const models = state.drillProvider !== null ? (state.groups.get(state.drillProvider) ?? []) : [];
  const entries: MenuEntry[] = models.map((model) => ({ kind: "model" as const, label: model, value: model }));
  entries.push({ kind: "custom-model", label: CUSTOM_MODEL_LABEL, value: "" });
  return entries;
}

function thinkingEntries(): MenuEntry[] {
  return THINKING_LEVELS.map((level) => ({ kind: "thinking-level" as const, label: level, value: level }));
}

/**
 * Recompute `state.entries` for the current screen and drill context.
 *
 * Idempotent. Afterwards the cursor is clamped into range, so a transition that
 * shrinks the row list never leaves the highlight out of bounds, and it is nudged
 * off a mechanism row, which cannot be selected.
 */
export function rebuildEntries(state: PickerState): PickerState {
  const entries =
    state.screen === "main" ? mainEntries(state)
    : state.screen === "slots" ? slotEntries(state)
    : state.screen === "provider" ? providerEntries(state)
    : state.screen === "model" ? modelEntries(state)
    : state.screen === "thinking" ? thinkingEntries()
    : profileActionEntries(state);

  const clamped = entries.length === 0 ? 0 : Math.min(Math.max(0, state.cursor), entries.length - 1);
  const next = { ...state, entries, cursor: clamped };
  return entries[clamped]?.kind === "mechanism" ? navigate(next, 1) : next;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/**
 * Move the highlight by `dir`, wrapping at both ends and skipping the mechanism
 * rows: they are displayed, never selected.
 */
export function navigate(state: PickerState, dir: -1 | 1): PickerState {
  const n = state.entries.length;
  if (n === 0) return { ...state, cursor: 0 };

  for (let step = 1; step <= n; step++) {
    const index = (state.cursor + dir * step + n * step) % n;
    if (state.entries[index].kind !== "mechanism") return { ...state, cursor: index };
  }
  return state;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type PickerKey = "up" | "down" | "enter" | "esc" | "backspace";

/**
 * One functional key under the kitty keyboard protocol: `CSI <code>`, an optional
 * `;1` (no modifiers), an optional `:1` (press) or `:2` (repeat), then the final
 * byte. A `:3` release or any real modifier does not match — releases must be
 * ignored, and a modified key is not a picker key.
 */
function kittyPressOrRepeat(code: string, final: string): RegExp {
  return new RegExp(`^\u001b\\[${code}(?:;1(?::[12])?)?${final}$`);
}

const KITTY_UP = kittyPressOrRepeat("1", "A");
const KITTY_DOWN = kittyPressOrRepeat("1", "B");
const KITTY_ENTER = kittyPressOrRepeat("13", "u");
const KITTY_ESC = kittyPressOrRepeat("27", "u");
const KITTY_BACKSPACE = kittyPressOrRepeat("127", "u");

/**
 * Decode one raw stdin sequence into a picker key, or `null` when it is not one.
 *
 * pi-tui negotiates kitty keyboard flags with the terminal, and a terminal that
 * grants them encodes arrows as `CSI 1;1:1 A/B` and Esc as `CSI 27 u` — never the
 * legacy forms. A terminal that does not keeps the legacy or SS3 forms. Both
 * worlds are accepted, and kitty repeats navigate too so holding an arrow scrolls.
 */
export function decodeKey(data: string): PickerKey | null {
  if (data === "\u001b[A" || data === "\u001bOA" || KITTY_UP.test(data)) return "up";
  if (data === "\u001b[B" || data === "\u001bOB" || KITTY_DOWN.test(data)) return "down";
  if (data === "\r" || data === "\n" || data === "\r\n" || KITTY_ENTER.test(data)) return "enter";
  if (data === "\u001b" || KITTY_ESC.test(data)) return "esc";
  if (data === "\u007f" || data === "\b" || KITTY_BACKSPACE.test(data)) return "backspace";
  return null;
}

// ---------------------------------------------------------------------------
// Enter
// ---------------------------------------------------------------------------

/** Go to a screen with the cursor at the top and the rows rebuilt. */
function goto(state: PickerState, screen: Screen, patch: Partial<PickerState> = {}): EnterResult {
  return { type: "state", state: rebuildEntries({ ...state, ...patch, screen, cursor: 0 }) };
}

export function enter(state: PickerState): EnterResult {
  const entry = state.entries[state.cursor];
  if (!entry) return { type: "state", state };

  // Any key that advances clears the previous transition's notice.
  const current: PickerState = { ...state, notice: null };

  switch (entry.kind) {
    case "mechanism":
      // Displayed, never assignable. Saying why beats a dead keypress: the model
      // is not the problem, the slot does not exist.
      return {
        type: "state",
        state: {
          ...current,
          notice: `${entry.value} es un mecanismo: es código determinista y no corre ningún modelo`,
        },
      };

    case "slot":
      // With no registry there is no provider list worth showing, so the typed
      // escape on the model screen is the way through.
      return goto(current, current.groups.size === 0 ? "model" : "provider", {
        drillSlot: entry.value,
        drillProvider: null,
      });

    case "provider":
      return goto(current, "model", { drillProvider: entry.value });

    case "custom-provider":
      return { type: "state", state: { ...current, textPrompt: { for: "provider", label: entry.label } } };

    case "custom-model":
      return { type: "state", state: { ...current, textPrompt: { for: "model", label: entry.label } } };

    case "model":
      // Choosing a model does not commit: it stages the model and advances to the
      // level screen, so model, provider and level are written together. An esc
      // before that leaves `edits` untouched.
      return goto(current, "thinking", { drillModel: entry.value });

    case "thinking-level":
      return goto(commitDrill(current, entry.value as ThinkingLevel), "slots", {
        drillSlot: null,
        drillProvider: null,
        drillModel: null,
      });

    case "edit-loose":
      return goto(current, "slots", { ...{ edits: { ...current.edits, editingProfile: null } } });

    case "profile":
      return goto(current, "profile-actions", { drillProfile: entry.value });

    case "profile-active-noop":
      // Informational row: there is nothing to activate.
      return { type: "state", state: current };

    case "new-profile":
      return {
        type: "state",
        state: { ...current, textPrompt: { for: "new-profile", label: "nombre del perfil nuevo:" } },
      };

    case "profile-duplicate":
      return {
        type: "state",
        state: {
          ...current,
          textPrompt: { for: "duplicate-profile", label: `nombre del duplicado de «${entry.value}»:` },
        },
      };

    case "profile-edit":
      // Load that profile's slots. This does not activate it: an inactive profile
      // is editable.
      return goto(loadProfile(current, entry.value), "slots");

    case "profile-use": {
      // Activating means that profile becomes the live config. What was being
      // edited is folded in first, so no unsaved change is lost.
      const loaded = loadProfile(current, entry.value);
      return goto(
        {
          ...loaded,
          edits: { ...loaded.edits, activeProfile: entry.value, profilesChanged: true, changed: true },
        },
        "main",
        {
          drillProfile: null,
          notice: `perfil «${entry.value}» activo — guardá y reiniciá pi para que los agentes lo tomen`,
        },
      );
    }

    case "profile-delete": {
      const profiles = { ...current.edits.profiles };
      delete profiles[entry.value];
      // Deleting does not change the models in use: it only removes the profile
      // the edits would have been folded into.
      return goto(
        {
          ...current,
          edits: {
            ...current.edits,
            profiles,
            profilesChanged: true,
            activeProfile: current.edits.activeProfile === entry.value ? null : current.edits.activeProfile,
            editingProfile: current.edits.editingProfile === entry.value ? null : current.edits.editingProfile,
          },
        },
        "main",
        { drillProfile: null, notice: `perfil «${entry.value}» borrado` },
      );
    }

    case "save":
      // Fold what is open into its profile before closing, or the slots just
      // edited would never reach it.
      return { type: "save", state: flushEdits(current) };
  }
}

/** The single commit point: slot, provider, model and level, together. */
function commitDrill(state: PickerState, level: ThinkingLevel): PickerState {
  const { drillSlot, drillProvider, drillModel } = state;
  if (drillSlot === null || drillModel === null) return state;

  // `drillProvider` is a group key, and a pooled provider's key carries the
  // pool prefix (`cliproxy/ds`) which the id already repeats
  // (`ds/deepseek-v4-pro`). Only the provider part is prepended, or the commit
  // doubles the prefix into an id that resolves to nothing.
  //
  // No provider at all is a bare model id — what the empty-registry path
  // produces, and what the command's validation accepts.
  const provider = drillProvider?.split("/")[0] ?? null;
  const qualified = provider ? `${provider}/${drillModel}` : drillModel;
  return {
    ...state,
    edits: {
      ...state.edits,
      models: { ...state.edits.models, [drillSlot]: qualified },
      thinking: { ...state.edits.thinking, [drillSlot]: level },
      changed: true,
    },
    dirtySinceLoad: true,
  };
}

// ---------------------------------------------------------------------------
// Esc
// ---------------------------------------------------------------------------

/**
 * Go back one screen. From the main screen it quits, so the host closes the
 * picker without writing anything.
 *
 * One screen at a time, not straight to the menu: the way out of a wrong model is
 * the provider list, and the way out of a wrong provider is the slot list.
 */
export function back(state: PickerState): EnterResult {
  const current: PickerState = { ...state, notice: null, textPrompt: null };

  if (current.screen === "main") return { type: "quit" };

  if (current.screen === "model") {
    // One step back, to the providers. With no registry that screen was skipped,
    // so returning to it would land on a screen the user never saw.
    return current.groups.size === 0
      ? goto(current, "slots", { drillSlot: null, drillProvider: null, drillModel: null })
      : goto(current, "provider", { drillProvider: null, drillModel: null });
  }
  if (current.screen === "thinking") {
    // The level is the last step of one atomic write, so esc aborts the whole
    // commit rather than stepping back: clearing `drillModel` drops the model
    // chosen without a level, and no partial edit is ever written.
    return goto(current, "slots", { drillSlot: null, drillProvider: null, drillModel: null });
  }
  if (current.screen === "provider") {
    return goto(current, "slots", { drillSlot: null, drillProvider: null, drillModel: null });
  }

  // Leaving the slot screen folds what was edited into its profile.
  return goto(current.screen === "slots" ? flushEdits(current) : current, "main", {
    drillSlot: null,
    drillProvider: null,
    drillModel: null,
    drillProfile: null,
  });
}

// ---------------------------------------------------------------------------
// Typed values
// ---------------------------------------------------------------------------

/**
 * Commit a value typed into the inline input opened by a `custom-*` row or a
 * profile-name prompt. An empty or whitespace value is a no-op: the prompt closes
 * and the list comes back unchanged, with nothing committed.
 */
export function submitText(state: PickerState, typed: string): PickerState {
  const prompt = state.textPrompt;
  const value = typed.trim();
  const current: PickerState = { ...state, notice: null };

  if (prompt === null || value === "") return rebuildEntries({ ...current, textPrompt: null });

  if (prompt.for === "provider") {
    return rebuildEntries({ ...current, textPrompt: null, screen: "model", cursor: 0, drillProvider: value });
  }
  if (prompt.for === "model") {
    // Like the `model` row: stage it and go to the level screen. The commit is
    // there, never here.
    return rebuildEntries({ ...current, textPrompt: null, screen: "thinking", cursor: 0, drillModel: value });
  }

  return submitProfileName(current, prompt.for, value);
}

/** Create or duplicate a profile under a typed name. */
function submitProfileName(
  state: PickerState,
  kind: "new-profile" | "duplicate-profile",
  typed: string,
): PickerState {
  const name = typed.toLowerCase();
  const cleared: PickerState = { ...state, textPrompt: null };

  // An invalid or taken name says so and creates nothing: overwriting a profile
  // by typing its name would be destructive and silent.
  if (!isValidProfileName(name)) {
    return rebuildEntries({ ...cleared, notice: `nombre inválido: «${typed}» (minúsculas, números, - y _)` });
  }
  if (name in cleared.edits.profiles) {
    return rebuildEntries({ ...cleared, notice: `ya existe un perfil «${name}»` });
  }

  // A duplicate clones the chosen profile; a new one starts from whatever is
  // being edited, which is what the user has in front of them.
  const source =
    kind === "duplicate-profile" && cleared.drillProfile !== null
      ? cleared.edits.profiles[cleared.drillProfile]
      : snapshotEdits(cleared.edits);

  const created: PickerState = {
    ...cleared,
    edits: {
      ...cleared.edits,
      profiles: { ...cleared.edits.profiles, [name]: cloneProfile(source) },
      profilesChanged: true,
    },
  };

  if (kind === "duplicate-profile") {
    return rebuildEntries({
      ...created,
      screen: "main",
      cursor: 0,
      drillProfile: null,
      notice: `perfil «${name}» duplicado`,
    });
  }

  // Creating opens it for editing: choosing the models is what you came to do.
  const loaded = loadProfile(created, name);
  // The first profile activates itself. Otherwise it would sit saved while the
  // agents kept reading the loose config — a profile that does nothing.
  const first = loaded.edits.activeProfile === null;
  return rebuildEntries({
    ...loaded,
    // `loadProfile` already set `editingProfile`, and it stays set: the slots
    // being opened are this profile's, so the title has to say so. Blanking it
    // made the first profile read "sin perfil" while editing it.
    edits: first ? { ...loaded.edits, activeProfile: name } : loaded.edits,
    screen: "slots",
    cursor: 0,
    notice: first
      ? `perfil «${name}» creado y activo — elegí los modelos`
      : `perfil «${name}» creado — elegí los modelos (activar es aparte)`,
  });
}

// ---------------------------------------------------------------------------
// The preview panel
// ---------------------------------------------------------------------------

/** One row of the preview panel. */
export type PreviewRow = { text: string };

/** The profile the preview should show, or null when there is nothing to show. */
function previewTarget(state: PickerState): { name: string; profile: Profile } | null {
  if (state.screen === "profile-actions" && state.drillProfile) {
    const profile = state.edits.profiles[state.drillProfile];
    return profile ? { name: state.drillProfile, profile } : null;
  }
  if (state.screen !== "main") return null;

  // On the menu the cursor drives the preview, so arrowing down the list shows
  // each profile in turn. Off a profile row it falls back to the active one.
  const entry = state.entries[state.cursor];
  const name = entry?.kind === "profile"
    ? entry.value
    : state.edits.activeProfile ?? Object.keys(state.edits.profiles).sort()[0];
  if (!name) return null;
  const profile = state.edits.profiles[name];
  return profile ? { name, profile } : null;
}

/**
 * The preview rows: every canonical step with its model and thinking level.
 *
 * Empty when there is no profile to show, which is what suppresses the second
 * panel rather than drawing an empty box.
 */
export function previewRows(state: PickerState): PreviewRow[] {
  const target = previewTarget(state);
  if (!target) return [];

  const { name, profile } = target;
  const active = name === state.edits.activeProfile ? " (activo)" : "";
  const rows: PreviewRow[] = [{ text: `vista previa · ${name}${active}` }, { text: "" }];

  const width = Math.max(...SLOT_ROWS.map((row) => row.id.length));
  const providers = new Set<string>();
  for (const row of SLOT_ROWS) {
    const label = row.id.padEnd(width);
    if (isMechanismSlot(row.id)) {
      rows.push({ text: `${label}   ${MECHANISM_PLACEHOLDER}` });
      continue;
    }
    const model = profile.models?.[row.id];
    if (!model) {
      rows.push({ text: `${label} → sin asignar` });
      continue;
    }
    const slash = model.indexOf("/");
    if (slash > 0) providers.add(model.slice(0, slash));
    const level = profile.thinking?.[row.id];
    rows.push({ text: `${label} → ${model}${level ? ` · ${level}` : ""}` });
  }

  rows.push({ text: "" });
  rows.push({ text: `proveedores: ${providers.size > 0 ? [...providers].sort().join(", ") : "por defecto"}` });
  return rows;
}
