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
import { applyProfileCommand, isValidProfileName, mirrorToActiveProfile, readActiveProfile, readProfiles } from "../src/models/profiles.ts";
import { createPickerState, enter, moveCursor, renderRows, stage, type EnterResult, type PickerState } from "../src/models/picker.ts";

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

/** Persist a picker outcome. Quit writes nothing; save writes once. */
function runPicker(result: EnterResult, io: ConfigIo): void {
  if (result.type !== "save") return;
  const raw = io.readConfig();
  io.writeConfig(mirrorToActiveProfile(mergeConfig(raw, { models: result.models })));
}

/**
 * The `ctx.ui.custom` component. It holds one `PickerState` and forwards
 * keystrokes to the pure state machine; every decision lives there.
 */
function createComponent(
  input: { models: Record<string, string>; groups: Map<string, string[]> },
  done: (result: EnterResult) => void,
  requestRender: () => void = () => {},
): Component {
  let state: PickerState = createPickerState(input);
  let choosing: { slot: string; options: string[]; cursor: number } | null = null;

  return {
    render(width: number): string[] {
      const inner = Math.max(20, width - 4);
      const lines = choosing
        ? [
            `elegí un modelo para ${choosing.slot}:`,
            ...choosing.options.map((option, i) => `${i === choosing!.cursor ? "❯" : " "} ${option}`),
          ]
        : [
            "nodd · modelos (↑↓ mover · enter elegir · q salir)",
            ...renderRows(state).map((row, i) => {
              const marker = i === state.cursor ? "❯" : " ";
              return `${marker} ${row.id.padEnd(20)} →  ${row.value}`;
            }),
          ];
      return lines.map((line) => line.slice(0, inner));
    },

    handleInput(data: string): void {
      if (choosing) {
        if (data === "\r" || data === "\n") {
          state = stage(state, choosing.slot, choosing.options[choosing.cursor]);
          choosing = null;
        } else if (data === "\u001b[A") choosing.cursor = Math.max(0, choosing.cursor - 1);
        else if (data === "\u001b[B") choosing.cursor = Math.min(choosing.options.length - 1, choosing.cursor + 1);
        else if (data === "q" || data === "\u001b") choosing = null;
        requestRender();
        return;
      }

      if (data === "\u001b[A") state = moveCursor(state, -1);
      else if (data === "\u001b[B") state = moveCursor(state, 1);
      else if (data === "q" || data === "\u001b") done({ type: "quit" });
      else if (data === "\r" || data === "\n") {
        const result = enter(state);
        if (result.type === "choose") choosing = { slot: result.slot, options: result.options, cursor: 0 };
        else done(result);
      }
      requestRender();
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
          const result = await ctx.ui.custom<EnterResult>((tui, _theme, _keys, done) =>
            createComponent({ models: currentModels(io.readConfig()), groups }, done, () => tui.requestRender()),
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

export default register;
