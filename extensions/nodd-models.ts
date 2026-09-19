// `/nodd-models` — a deterministic handler, not a prompt.
//
// Adapted from `zero-models.ts:929-1161`. It owns its own command name and its
// own file: forge's phase models stay `/zero-models`' business, and
// `~/.pi/nodd.json` is the only file this touches.
//
// **The no-TUI rule is absolute** (`zero-models.ts:22-32`): this file does not
// import pi's TUI package at all — not a value import, not an `import type`, and
// not even as a string, which is why the name is not written here.
// `ctx.ui.custom`'s factory only needs an object exposing
// `render(width): string[]`, so the contract is declared locally below. A stray
// ambient specifier would crash `node --test` with `ERR_MODULE_NOT_FOUND`, and
// the test file imports this module directly.

/** What `ctx.ui.custom()`'s factory must return. Declared locally on purpose. */
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
}

import { readFileSync, writeFileSync } from "node:fs";
import { mergeConfig, noddConfigPath } from "../src/config.ts";
import { SLOT_ROWS } from "../src/models/slots.ts";
import { assignmentPatch, groupByProvider, parseAssignment, validateAssignment, type RegistryModel } from "../src/models/assign.ts";
import { applyProfileCommand, isValidProfileName, mirrorToActiveProfile, readActiveProfile, readProfiles, type Profile } from "../src/models/profiles.ts";
import { back, createPickerState, decodeKey, enter, navigate, pickerTitle, previewRows, submitText, type EnterResult, type PickerState } from "../src/models/picker.ts";
import { fitRows, sideBySide, truncateToWidth, usableRows, windowRows } from "../src/models/layout.ts";
import { isThinkingLevel, type SlotThinking } from "../src/models/thinking.ts";

export type ConfigIo = {
  readConfig(): Record<string, unknown>;
  writeConfig(next: Record<string, unknown>): void;
};

export function fileConfigIo(path: string = noddConfigPath()): ConfigIo {
  return {
    readConfig() {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    },
    writeConfig(next) {
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    },
  };
}

type ModelRegistry = { getAll(): RegistryModel[] };

const USAGE =
  "uso: /nodd-models · /nodd-models <slot>=<provider>/<modelo> · /nodd-models profile [list|new <n>|save [n]|use <n>|delete <n>]";

function groupsFrom(registry: ModelRegistry | undefined): Map<string, string[]> {
  try {
    const all = registry?.getAll?.();
    return all && all.length > 0 ? groupByProvider(all) : new Map();
  } catch {
    // A registry that throws is a registry we do not have. Validation degrades
    // to permissive rather than making the command unusable.
    return new Map();
  }
}

function currentModels(raw: Record<string, unknown>): Record<string, string> {
  const models = raw.models;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(typeof models === "object" && models !== null ? models : {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** The slot table: every canonical step, with the mechanisms marked. */
function renderTable(raw: Record<string, unknown>): string {
  const models = currentModels(raw);
  const width = Math.max(...SLOT_ROWS.map((row) => row.id.length));
  const rows = SLOT_ROWS.map((row) => {
    const value = row.kind === "mechanism" ? row.placeholder : models[row.id] ?? row.placeholder;
    return `  ${row.id.padEnd(width)}  →  ${value}`;
  });

  const active = readActiveProfile(raw);
  const header = active ? `nodd · modelos (perfil activo: ${active})` : "nodd · modelos";
  return [header, ...rows].join("\n");
}

function renderProfileList(raw: Record<string, unknown>): string {
  const { profiles, defects } = readProfiles(raw);
  const names = Object.keys(profiles).sort();
  if (names.length === 0) {
    return "nodd · no hay perfiles todavía. Creá el primero con: /nodd-models profile new <nombre>";
  }
  const active = readActiveProfile(raw);
  const rows = names.map((name) => (name === active ? `  * ${name}  (activo)` : `    ${name}`));
  return ["nodd · perfiles:", ...rows, ...defects.map((d) => `  ! ${d}`)].join("\n");
}

function runProfile(args: string[], io: ConfigIo): string {
  const [verb, name, from, fromName] = args;

  if (!verb || verb === "list") return renderProfileList(io.readConfig());

  const command =
    verb === "new" ? { kind: "new" as const, name: name ?? "", ...(from === "from" && fromName ? { from: fromName } : {}) }
    : verb === "save" ? { kind: "save" as const, ...(name ? { name } : {}) }
    : verb === "use" ? { kind: "use" as const, name: name ?? "" }
    : verb === "delete" || verb === "rm" ? { kind: "delete" as const, name: name ?? "" }
    : null;

  if (!command) return USAGE;
  if (command.kind !== "save" && !isValidProfileName(command.name)) {
    return `nodd · nombre de perfil inválido: ${command.name || "(vacío)"}`;
  }

  const result = applyProfileCommand(io.readConfig(), command);
  if (!result.ok) return `nodd · ${result.message}`;
  io.writeConfig(result.data);
  return `nodd · ${result.message}`;
}

/**
 * The deterministic handler. Display writes nothing; a valid assignment writes
 * once, through the merge that preserves unrelated keys.
 */
export function runModelsCommand(args: string, io: ConfigIo, registry?: ModelRegistry): string {
  const words = args.trim().split(/\s+/).filter((word) => word !== "");

  if (words.length === 0) return renderTable(io.readConfig());
  if (words[0] === "profile") return runProfile(words.slice(1), io);

  const assignment = parseAssignment(words[0]);
  if (!assignment) return USAGE;

  const validation = validateAssignment(assignment, groupsFrom(registry));
  if (!validation.ok) return `nodd · ${validation.message}`;

  const raw = io.readConfig();
  const patch = assignmentPatch({ models: currentModels(raw) }, { ...assignment, provider: validation.provider });
  // Mirror after the write so editing a slot under an active profile edits that
  // profile too, rather than leaving the two silently divergent.
  io.writeConfig(mirrorToActiveProfile(mergeConfig(raw, patch)));

  return `nodd · ${assignment.slot} → ${patch.models[assignment.slot]}`;
}

/** The thinking map as stored, keeping only the levels that are real. */
function currentThinking(raw: Record<string, unknown>): SlotThinking {
  const stored = raw.thinking;
  const out: SlotThinking = {};
  for (const [key, value] of Object.entries(typeof stored === "object" && stored !== null ? stored : {})) {
    if (isThinkingLevel(value)) out[key] = value;
  }
  return out;
}

/** Everything the picker opens on, read from the config in one place. */
function pickerInput(raw: Record<string, unknown>, groups: Map<string, string[]>) {
  return {
    models: currentModels(raw),
    thinking: currentThinking(raw),
    groups,
    profiles: readProfiles(raw).profiles,
    activeProfile: readActiveProfile(raw),
  };
}

/**
 * Persist a picker outcome. Quit writes nothing; save writes once.
 *
 * The picker stages everything — slots, thinking levels and the whole profile
 * map — and hands back the final state, so this is one write, never one per
 * keystroke. `activeProfile` and `profiles` are carried through because the
 * picker can create, delete, duplicate and activate them.
 */
function runPicker(result: EnterResult, io: ConfigIo): void {
  if (result.type !== "save") return;
  const raw = io.readConfig();
  const { models, thinking, profiles, activeProfile } = result.state.edits;
  io.writeConfig(
    mirrorToActiveProfile(
      mergeConfig(raw, { models, thinking, profiles, activeProfile }),
    ),
  );
}

/**
 * The `ctx.ui.custom` component. It holds one `PickerState` and forwards every
 * keystroke to the pure state machine; no decision lives here.
 *
 * Ported from `zero-models.ts:777-926`. Two things it must never do: throw out
 * of `handleInput` (a transition bug would wedge the pi session, so the whole
 * body is wrapped and a failure closes the picker), and write anything — only
 * `runPicker` writes, once, on save.
 */
function createComponent(
  input: {
    models: Record<string, string>;
    thinking: SlotThinking;
    groups: Map<string, string[]>;
    profiles?: Record<string, Profile>;
    activeProfile?: string | null;
  },
  done: (result: EnterResult) => void,
  requestRender: () => void = () => {},
): Component {
  let state: PickerState = createPickerState(input);
  // Inline text buffer — non-null only while `state.textPrompt` is open.
  let buffer: string | null = null;

  function render(width: number): string[] {
    const inner = Math.max(20, width - 4);
    // pi hands the component its width but not its height, so the height comes
    // from the terminal itself, minus what pi's own chrome takes.
    const maxRows = usableRows(process.stdout?.rows);
    const head: string[] = [pickerTitle(state), ""];
    if (state.notice) head.push(state.notice, "");

    if (state.textPrompt) {
      return fitRows(
        [...head, state.textPrompt.label, `> ${buffer ?? ""}`, "", "enter confirmar · esc volver"]
          .map((line) => truncateToWidth(line, inner)),
        maxRows,
      );
    }

    // Reserve the header, footer and the two frame lines, then window the list
    // around the cursor so a long list scrolls instead of overflowing.
    const capacity = Math.max(1, maxRows - head.length - 4);
    const win = windowRows(state.entries.length, state.cursor, capacity);
    const rows = state.entries.slice(win.start, win.end).map((entry, index) => {
      const selected = win.start + index === state.cursor;
      return { text: `${selected ? "❯ " : "  "}${entry.label}` };
    });

    const menu = [
      ...head.map((text) => ({ text })),
      ...rows,
      { text: "" },
      { text: "↑↓ mover · enter elegir · esc volver · q salir" },
    ];
    // The preview is empty until a profile exists, and `sideBySide` drops the
    // second panel for an empty preview or a narrow terminal.
    return fitRows(sideBySide(menu, previewRows(state), width), maxRows);
  }

  /** Apply an `EnterResult` — re-render on `state`, close on `save`/`quit`. */
  function applyResult(result: EnterResult): void {
    if (result.type === "state") {
      state = result.state;
      requestRender();
      return;
    }
    done(result);
  }

  /** Route a keystroke while the inline text buffer is open. */
  function handleTextInput(data: string): void {
    const key = decodeKey(data);
    if (key === "esc") {
      // Esc abandons the typed value and returns to the list unchanged:
      // `submitText` with an empty string is exactly that no-op.
      state = submitText(state, "");
      buffer = null;
    } else if (key === "enter") {
      state = submitText(state, buffer ?? "");
      buffer = null;
    } else if (key === "backspace") {
      buffer = (buffer ?? "").slice(0, -1);
    } else if (data.length >= 1 && data.charCodeAt(0) >= 32 && !data.startsWith("\u001b")) {
      // Printable characters only; control sequences are dropped.
      buffer = (buffer ?? "") + data;
    }
    requestRender();
  }

  return {
    render,
    invalidate(): void {
      /* stateless render — nothing cached to clear */
    },
    handleInput(data: string): void {
      try {
        if (state.textPrompt) {
          handleTextInput(data);
          return;
        }

        const key = decodeKey(data);
        if (key === "up") state = navigate(state, -1);
        else if (key === "down") state = navigate(state, 1);
        else if (key === "enter") {
          const result = enter(state);
          // `enter` on a custom-* row opens `textPrompt`; arm the buffer.
          if (result.type === "state" && result.state.textPrompt) buffer = "";
          applyResult(result);
          return;
        } else if (key === "esc") {
          applyResult(back(state));
          return;
        } else if (data === "q") {
          done({ type: "quit" });
          return;
        }
        requestRender();
      } catch {
        // A transition bug must never wedge the pi session — close instead.
        done({ type: "quit" });
      }
    },
  };
}


type PiApi = {
  registerCommand?(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => unknown }): void;
};

type PiCtx = {
  ui?: {
    notify?(message: string, tone?: string): void;
    custom?<T>(factory: (tui: { requestRender(): void }, theme: unknown, keys: unknown, done: (result: T) => void) => Component): Promise<T>;
  };
  modelRegistry?: ModelRegistry;
};

function register(pi?: PiApi): void {
  pi?.registerCommand?.("nodd-models", {
    description: "Configurar los modelos de NODD: /nodd-models [<slot>=<provider>/<modelo>|profile …]",
    handler: async (args: string, rawCtx: unknown) => {
      const ctx = rawCtx as PiCtx;
      const notify = ctx?.ui?.notify;
      const io = fileConfigIo();

      try {
        // No arguments plus a custom-UI host: open the picker. Otherwise the
        // deterministic text path, which is the whole command in a headless run.
        if (args.trim() === "" && typeof ctx?.ui?.custom === "function") {
          const groups = groupsFrom(ctx.modelRegistry);
          // Everything the picker needs, including the saved profiles and the
          // active one. Passing only the models opened the picker as though
          // nothing had ever been saved.
          const input = pickerInput(io.readConfig(), groups);
          const result = await ctx.ui.custom<EnterResult>((tui, _theme, _keys, done) =>
            createComponent(input, done, () => tui.requestRender()),
          );
          runPicker(result, io);
          notify?.(result.type === "save" ? "nodd · modelos guardados" : "nodd · sin cambios", "info");
          return;
        }

        notify?.(runModelsCommand(args ?? "", io, ctx?.modelRegistry), "info");
      } catch (err) {
        notify?.(`nodd-models: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}

register.runPicker = runPicker;
register.createComponent = createComponent;
register.pickerInput = pickerInput;

export default register;
