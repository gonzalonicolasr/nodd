// NODD's configuration lives in `~/.pi/nodd.json` and nowhere else. Forge's own
// config file is never read and never written: the two products share a home
// directory, not a schema. A test asserts no NODD source file even names it.
//
// This module is pure: it parses text and merges objects. Reading and writing
// the file is the extensions' job.

import { homedir } from "node:os";
import { join } from "node:path";
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

export function noddConfigPath(home: string = homedir()): string {
  return join(home, ".pi", "nodd.json");
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
export function hatchPath(home: string = homedir()): string {
  return join(home, ".pi", "nodd-hatch.json");
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
