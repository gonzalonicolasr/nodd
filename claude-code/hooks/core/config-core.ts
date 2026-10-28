// NODD's configuration lives in `~/.pi/nodd.json` and nowhere else. Forge's own
// config file is never read and never written: the two products share a home
// directory, not a schema. A test asserts no NODD source file even names it.
//
// This module is pure: it parses text and merges objects. Reading and writing
// the file is the extensions' job.

import { joinPath } from "./path.ts";
import { bashWriteTargets, writesOnlyUnder } from "./scratch.ts";
import type { ConfigurableSlot } from "./manifest.ts";

export type GateFlag = { enabled: boolean };

export type NoddConfig = {
  /** slot -> `provider/model` (or a bare model id pi can resolve). */
  models: Partial<Record<ConfigurableSlot, string>>;
  /** profile name -> a full slot assignment set. */
  profiles: Record<string, Partial<Record<ConfigurableSlot, string>>>;
  activeProfile: string | null;
  /** gate id -> flag. Absent means "nobody chose"; the default applies. */
  gates: Record<string, GateFlag>;
};

export const DEFAULT_CONFIG: NoddConfig = Object.freeze({
  models: {},
  profiles: {},
  activeProfile: null,
  gates: {},
});

export function noddConfigPath(home: string): string {
  return joinPath(home, ".pi", "nodd.json");
}

/**
 * Where a one-shot override waits between the command that grants it and the
 * refusal it prevents.
 *
 * Deliberately not `nodd.json`: that file is the user's durable configuration,
 * and a hatch is spent within seconds. Keeping the two apart means a crash
 * mid-override cannot corrupt the profiles, and the user never finds ephemeral
 * state in the file they hand-edit.
 */
export function hatchPath(home: string): string {
  return joinPath(home, ".pi", "nodd-hatch.json");
}

/** Where the global on/off switch lives, and where the exported per-session state does. */
export function switchPath(home: string): string {
  return joinPath(home, ".local", "state", "nodd", "switch.json");
}

export function statePath(home: string, sessionId: string): string {
  return joinPath(home, ".local", "state", "nodd", "sessions", `${sessionId || "sin-id"}.json`);
}

/**
 * The files that decide whether NODD looks at a call: the gate config, a
 * pending one-shot override, the global switch, and the exported state.
 *
 * They live under `$HOME`, so the roots the destructive guard knows never
 * included them, and once a declaration existed every other gate was satisfied —
 * a model could write `{"gates":{"evidence":{"enabled":false}}}` and then check
 * a task off with no run observed. An enforcer whose subject can rewrite its
 * rules is enforcing prose with extra steps.
 */
export type ControlPaths = {
  files: string[];
  /** Prefixes that may legitimately be created: a conflict copy, a session's state file. */
  prefixes: string[];
};

export function controlPaths(home: string): ControlPaths {
  const config = noddConfigPath(home);
  const hatch = hatchPath(home);
  const flip = switchPath(home);
  return {
    files: [config, hatch, flip],
    prefixes: [`${config}.conflict-`, `${hatch}.conflict-`, `${joinPath(home, ".local", "state", "nodd")}/`],
  };
}

export function isControlPath(path: string, home: string): boolean {
  if (typeof path !== "string" || path === "" || home === "") return false;
  const { files, prefixes } = controlPaths(home);
  return files.includes(path) || prefixes.some((prefix) => path.startsWith(prefix));
}

/** `~` and `$HOME` stand for the same directory, and the write tools see them as written. */
function expandHome(command: string, home: string): string {
  if (home === "") return command;
  return command
    .replace(/(^|[\s='"<>&|(])\$HOME(?=\/|$|[\s'";&|)])/g, `$1${home}`)
    .replace(/(^|[\s='"<>&|(])~(?=\/|$|[\s'";&|)])/g, `$1${home}`);
}

/**
 * The control file a bash command would write, if any.
 *
 * Built on the same target extraction the gates already trust, over a copy of
 * the command with `~`/`$HOME` expanded — `bashWriteTargets` drops those as
 * unpinnable, which is right for promotion and wrong here, because they name a
 * control file exactly.
 */
export function bashControlTarget(command: string, home: string, cwd: string): string | null {
  if (typeof command !== "string" || command === "") return null;
  const expanded = expandHome(command, home);
  const found: string[] = [];
  writesOnlyUnder(expanded, () => true, (path) => found.push(path));
  found.push(...bashWriteTargets(expanded, cwd));
  return found.find((path) => isControlPath(path, home)) ?? null;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(asObject(value))) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

export type ParsedConfig = { config: NoddConfig; defects: string[] };

/**
 * Tolerant read. An absent file, an empty file and `{{{` all produce the
 * documented defaults — a broken config must never take a session down. A parse
 * failure is reported as a defect so the user can see it; missing sections are
 * not defects, they are just unset.
 */
export function parseConfig(text: string | undefined): ParsedConfig {
  if (text === undefined || text.trim() === "") {
    return { config: { ...DEFAULT_CONFIG }, defects: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { config: { ...DEFAULT_CONFIG }, defects: [`nodd.json is not valid JSON: ${message}`] };
  }

  const root = asObject(raw);
  const profiles: NoddConfig["profiles"] = {};
  for (const [name, value] of Object.entries(asObject(root.profiles))) {
    profiles[name] = asStringMap(value) as NoddConfig["profiles"][string];
  }

  const gates: NoddConfig["gates"] = {};
  for (const [id, value] of Object.entries(asObject(root.gates))) {
    const enabled = asObject(value).enabled;
    if (typeof enabled === "boolean") gates[id] = { enabled };
  }

  return {
    config: {
      models: asStringMap(root.models) as NoddConfig["models"],
      profiles,
      activeProfile: typeof root.activeProfile === "string" ? root.activeProfile : null,
      gates,
    },
    defects: [],
  };
}

/**
 * Merge a patch into the raw parsed JSON, section by section. Unknown top-level
 * keys survive untouched: NODD is a guest in a file the user owns, and losing a
 * key nobody asked us to manage would be a silent data loss.
 */
export function mergeConfig(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}
