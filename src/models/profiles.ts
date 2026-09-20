// Named slot-assignment sets, in `~/.pi/nodd.json` only.
//
// Adapted from `zero-models-profiles.ts:46-68,170-177,255-299`. NODD's profiles
// are never shared with forge's: the two products keep separate files, and the
// isolation test in `src/config.test.ts` asserts no NODD source even names the
// other one.
//
// Every verb is a pure transform returning the new data plus a message. The
// command decides whether to write — which is what makes "quit writes nothing"
// enforceable rather than a promise about a code path.
//
// Malformed profile data is discarded *and reported*. Silently dropping it would
// leave the user staring at a profile that vanished with no explanation, and
// throwing would take the whole command down over a hand-edit.

import { isThinkingLevel, type SlotThinking } from "./thinking.ts";

/**
 * A named set of slot assignments, plus the thinking level each one runs at.
 *
 * `thinking` is optional and omitted when empty, never stored as `{}`: the
 * stored file is what the round-trip tests compare, and an empty object would
 * make "this profile sets no levels" and "this profile sets levels, none of them"
 * the same shape on disk.
 */
export type Profile = { models: Record<string, string>; thinking?: SlotThinking };

/** Sub-command verbs, which therefore cannot be profile names. */
export const RESERVED_PROFILE_NAMES = ["list", "new", "save", "use", "delete", "rm", "from"] as const;

export type ProfileCommand =
  | { kind: "new"; name: string; from?: string }
  | { kind: "save"; name?: string }
  | { kind: "use"; name: string }
  | { kind: "delete"; name: string };

export type ProfileResult =
  | { ok: true; data: Record<string, unknown>; message: string }
  | { ok: false; message: string };

export function isValidProfileName(name: string): boolean {
  if (!/^[a-z0-9_-]+$/.test(name)) return false;
  return !(RESERVED_PROFILE_NAMES as readonly string[]).includes(name);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(isObject(value) ? value : {})) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

/** The real levels inside one `thinking` map, dropping everything else. */
function levelMap(value: unknown): SlotThinking {
  const out: SlotThinking = {};
  for (const [slot, level] of Object.entries(isObject(value) ? value : {})) {
    if (isThinkingLevel(level)) out[slot] = level;
  }
  return out;
}

/**
 * The thinking levels of a config object, keeping only real pi effort levels.
 *
 * A level pi cannot resolve is dropped rather than carried: it would reach
 * `nodd-agents.ts` and land in agent frontmatter, failing at the moment the
 * agent is launched instead of here, where the user can still see why.
 */
export function readThinking(data: Record<string, unknown>): SlotThinking {
  return levelMap(data.thinking);
}

/** Every non-level found under a `thinking` map, for reporting. */
function badLevels(value: unknown): string[] {
  return Object.entries(isObject(value) ? value : {})
    .filter(([, level]) => !isThinkingLevel(level))
    .map(([slot, level]) => `${slot}=${String(level)}`);
}

/** A profile, with `thinking` present only when it holds something. */
function profileOf(models: Record<string, string>, thinking: SlotThinking): Profile {
  return Object.keys(thinking).length > 0 ? { models, thinking } : { models };
}

export type ReadProfiles = { profiles: Record<string, Profile>; defects: string[] };

export function readProfiles(data: Record<string, unknown>): ReadProfiles {
  const raw = data.profiles;
  if (raw === undefined) return { profiles: {}, defects: [] };
  if (!isObject(raw)) {
    return { profiles: {}, defects: ["`profiles` is not an object; it was discarded and no profile is available"] };
  }

  const profiles: Record<string, Profile> = {};
  const defects: string[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (!isValidProfileName(name)) {
      defects.push(`profile \`${name}\` has an invalid name and was discarded`);
      continue;
    }
    if (!isObject(value)) {
      defects.push(`profile \`${name}\` is not an object and was discarded`);
      continue;
    }
    const bad = badLevels(value.thinking);
    if (bad.length > 0) {
      defects.push(`profile \`${name}\` has thinking levels pi cannot resolve, discarded: ${bad.join(", ")}`);
    }
    profiles[name] = profileOf(stringMap(value.models), levelMap(value.thinking));
  }
  return { profiles, defects };
}

/** The active profile, but only when it actually exists. */
export function readActiveProfile(data: Record<string, unknown>): string | null {
  const active = data.activeProfile;
  if (typeof active !== "string") return null;
  return readProfiles(data).profiles[active] ? active : null;
}

/** The flat config as a profile snapshot. */
function snapshot(data: Record<string, unknown>): Profile {
  return profileOf(stringMap(data.models), readThinking(data));
}

/**
 * Apply a profile's models and levels to the flat config.
 *
 * A profile with no levels *removes* the key rather than leaving the previous
 * profile's levels behind: a stale level would keep running a model at an effort
 * nobody chose for it, which is the silent-divergence defect this whole command
 * is built to avoid.
 */
function flatten(data: Record<string, unknown>, profile: Profile): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data, models: { ...profile.models } };
  if (profile.thinking) next.thinking = { ...profile.thinking };
  else delete next.thinking;
  return next;
}

/**
 * Editing a slot while a profile is active edits that profile, so the two never
 * drift apart without the user asking for it. No active profile: unchanged.
 */
export function mirrorToActiveProfile(data: Record<string, unknown>): Record<string, unknown> {
  const active = readActiveProfile(data);
  if (active === null) return data;
  const { profiles } = readProfiles(data);
  return { ...data, profiles: { ...profiles, [active]: snapshot(data) } };
}

export type MigrationResult = { data: Record<string, unknown>; changed: boolean; defect?: string };

/**
 * `orchestrator -> default` in one slot map, following D5's rule: `orchestrator`
 * set and `default` unset moves the value; both set drops `orchestrator`;
 * neither is a no-op.
 */
function migrateSlotMap<T>(map: Record<string, T> | undefined): { map: Record<string, T> | undefined; changed: boolean } {
  if (!map || !("orchestrator" in map)) return { map, changed: false };
  const { orchestrator, ...rest } = map;
  if (!("default" in rest)) (rest as Record<string, T>).default = orchestrator;
  return { map: rest as Record<string, T>, changed: true };
}

/**
 * Migrate `orchestrator` to `default` across the loose config, every profile
 * and their parallel `thinking` maps (`design.md` § "D5 + migration — slots").
 *
 * Writes nothing itself — pure transform, returned data plus whether anything
 * changed, so the caller can skip the write (and the backup) on a no-op.
 * Malformed `profiles` is left untouched and reported rather than partially
 * rewritten.
 */
export function migrateOrchestratorSlot(data: Record<string, unknown>): MigrationResult {
  if (data.profiles !== undefined && !isObject(data.profiles)) {
    return { data, changed: false, defect: "`profiles` is not an object; migration skipped" };
  }

  let changed = false;
  const next: Record<string, unknown> = { ...data };

  const models = migrateSlotMap(isObject(data.models) ? (data.models as Record<string, string>) : undefined);
  if (models.changed) {
    next.models = models.map;
    changed = true;
  }

  const thinking = migrateSlotMap(isObject(data.thinking) ? (data.thinking as SlotThinking) : undefined);
  if (thinking.changed) {
    next.thinking = thinking.map;
    changed = true;
  }

  const profiles = isObject(data.profiles) ? data.profiles : undefined;
  if (profiles) {
    const nextProfiles: Record<string, unknown> = { ...profiles };
    for (const [name, value] of Object.entries(profiles)) {
      if (!isObject(value)) continue;
      const profileModels = migrateSlotMap(isObject(value.models) ? (value.models as Record<string, string>) : undefined);
      const profileThinking = migrateSlotMap(isObject(value.thinking) ? (value.thinking as SlotThinking) : undefined);
      if (!profileModels.changed && !profileThinking.changed) continue;
      changed = true;
      const nextProfile: Record<string, unknown> = { ...value };
      if (profileModels.changed) nextProfile.models = profileModels.map;
      if (profileThinking.changed) nextProfile.thinking = profileThinking.map;
      nextProfiles[name] = nextProfile;
    }
    if (changed) next.profiles = nextProfiles;
  }

  return changed ? { data: next, changed: true } : { data, changed: false };
}

export function applyProfileCommand(data: Record<string, unknown>, command: ProfileCommand): ProfileResult {
  const { profiles } = readProfiles(data);
  const names = Object.keys(profiles).sort();

  if (command.kind === "new") {
    if (!isValidProfileName(command.name)) {
      return { ok: false, message: `nombre de perfil inválido: ${command.name}` };
    }
    if (profiles[command.name]) {
      return { ok: false, message: `el perfil ${command.name} ya existe; usá save para sobrescribirlo` };
    }
    const source = command.from ? profiles[command.from] : snapshot(data);
    if (!source) return { ok: false, message: `no existe el perfil ${command.from}` };
    return {
      ok: true,
      data: { ...data, profiles: { ...profiles, [command.name]: source }, activeProfile: command.name },
      message: `perfil ${command.name} creado y activado`,
    };
  }

  if (command.kind === "save") {
    const target = command.name ?? readActiveProfile(data);
    if (!target) {
      return { ok: false, message: "no hay perfil activo: pasá un nombre para guardar" };
    }
    if (!isValidProfileName(target)) {
      return { ok: false, message: `nombre de perfil inválido: ${target}` };
    }
    return {
      ok: true,
      data: { ...data, profiles: { ...profiles, [target]: snapshot(data) } },
      message: `perfil ${target} guardado`,
    };
  }

  if (command.kind === "use") {
    const profile = profiles[command.name];
    if (!profile) {
      return {
        ok: false,
        message: `no existe el perfil ${command.name}${names.length > 0 ? `. Perfiles: ${names.join(", ")}` : ""}`,
      };
    }
    return {
      ok: true,
      data: { ...flatten(data, profile), activeProfile: command.name },
      message: `perfil ${command.name} activado`,
    };
  }

  const remaining = { ...profiles };
  if (!remaining[command.name]) {
    return {
      ok: false,
      message: `no existe el perfil ${command.name}${names.length > 0 ? `. Perfiles: ${names.join(", ")}` : ""}`,
    };
  }
  delete remaining[command.name];
  // The flat config stays as it is: deleting a profile must not silently change
  // which models are in use.
  const active = readActiveProfile(data);
  return {
    ok: true,
    data: { ...data, profiles: remaining, activeProfile: active === command.name ? null : active },
    message: `perfil ${command.name} borrado`,
  };
}
