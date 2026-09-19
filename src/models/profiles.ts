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

export type Profile = { models: Record<string, string> };

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
    profiles[name] = { models: stringMap(value.models) };
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
  return { models: stringMap(data.models) };
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
      data: { ...data, models: { ...profile.models }, activeProfile: command.name },
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
