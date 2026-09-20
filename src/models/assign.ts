// Validating a model assignment against pi's live registry.
//
// Adapted from `zero-models.ts:411-460,505-525` — adapted, never imported: NODD
// is a standalone package and a shared import would couple two products that
// only share a home directory.
//
// The rule that matters: the names written to `~/.pi/nodd.json` must be names pi
// can actually resolve, so a configured slot never fails at the moment it is
// needed. That means the registry is the authority, not a hardcoded catalog. An
// ambiguous bare id is refused with the qualified forms rather than guessed —
// picking a provider on the user's behalf is how a config silently points at the
// wrong model.
//
// A mechanism step refuses assignment saying *why*: "unknown model" would be a
// misleading error for `classify=x/y`, where the model is fine and the slot does
// not exist.

import { isConfigurableSlot, slotRow } from "./slots.ts";
import type { ConfigurableSlot } from "../manifest.ts";

export type RegistryModel = { provider: string; id: string };

export type Assignment = {
  slot: string;
  /** null when the user gave a bare model id. */
  provider: string | null;
  model: string;
};

export type Validation =
  | { ok: true; provider: string | null }
  | { ok: false; message: string };

/**
 * Group the registry into browsable menus.
 *
 * Normally one group per provider. But a provider that fronts several pools
 * encodes the pool in the id — cliproxy serves `personal/claude-opus-5`,
 * `ds/deepseek-flash`, `wibond/...` — and grouping by provider alone puts every
 * one of them behind a single row: measured against a live cliproxy, 166 models
 * in one flat list. Those ids are split one level deeper into `provider/prefix`
 * groups, so the pools are what you actually browse.
 *
 * The group key is a browsing device only. The id inside each group stays whole
 * (`personal/claude-opus-5`), because that is what pi has to resolve.
 */
export function groupByProvider(models: RegistryModel[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const slash = model.id.indexOf("/");
    // An id that begins or ends with the slash has no usable prefix; it is kept
    // whole under its provider rather than producing an empty group.
    const key = slash > 0 && slash < model.id.length - 1
      ? `${model.provider}/${model.id.slice(0, slash)}`
      : model.provider;
    const existing = groups.get(key);
    if (existing) existing.push(model.id);
    else groups.set(key, [model.id]);
  }
  return groups;
}

/** `slot=provider/model` or `slot=model`. */
export function parseAssignment(text: string): Assignment | null {
  const match = /^([^=\s]+)=(\S+)$/.exec(text.trim());
  if (!match) return null;

  const [, slot, value] = match;
  const slash = value.indexOf("/");
  if (slash < 0) return { slot, provider: null, model: value };

  const provider = value.slice(0, slash);
  const model = value.slice(slash + 1);
  if (!provider || !model) return null;
  return { slot, provider, model };
}

/** The real provider names, with the browsing prefixes folded back off. */
function providerNames(groups: Map<string, string[]>): string[] {
  const names = new Set<string>();
  for (const key of groups.keys()) {
    const slash = key.indexOf("/");
    names.add(slash > 0 ? key.slice(0, slash) : key);
  }
  return [...names].sort();
}

/** Every id reachable under a provider, across all of its prefixed groups. */
function idsForProvider(groups: Map<string, string[]>, provider: string): string[] | undefined {
  const ids: string[] = [];
  for (const [key, group] of groups) {
    if (key === provider || key.startsWith(`${provider}/`)) ids.push(...group);
  }
  return ids.length > 0 ? ids : undefined;
}

/** The providers owning a model id, with the browsing prefix stripped back off. */
function providersOwning(groups: Map<string, string[]>, model: string): string[] {
  const owners = new Set<string>();
  for (const [key, ids] of groups) {
    if (!ids.includes(model)) continue;
    const slash = key.indexOf("/");
    owners.add(slash > 0 ? key.slice(0, slash) : key);
  }
  return [...owners];
}

function suggest(groups: Map<string, string[]>, model: string): string[] {
  const needle = model.toLowerCase();
  const out: string[] = [];
  for (const [provider, ids] of groups) {
    for (const id of ids) {
      const hay = id.toLowerCase();
      if (hay.includes(needle) || needle.includes(hay)) out.push(`${provider}/${id}`);
    }
  }
  return out.slice(0, 5);
}

export function validateAssignment(assignment: Assignment, groups: Map<string, string[]>): Validation {
  if (assignment.slot === "orchestrator") {
    return { ok: false, message: "orchestrator ya no existe: fue reemplazado por default" };
  }
  const row = slotRow(assignment.slot);
  if (!row) {
    return { ok: false, message: `slot desconocido: ${assignment.slot}` };
  }
  if (!isConfigurableSlot(assignment.slot)) {
    return {
      ok: false,
      message: `${assignment.slot} es un mecanismo, no un paso con modelo: es código determinista y no admite asignación`,
    };
  }

  // An empty registry means we cannot check; refusing everything would make a
  // headless context unusable, so the permissive fallback is deliberate.
  if (groups.size === 0) return { ok: true, provider: assignment.provider };

  if (assignment.provider) {
    // The group keys are browsing devices (`cliproxy/personal`), so a provider
    // owns every group it prefixes, not just the one bearing its exact name.
    const ids = idsForProvider(groups, assignment.provider);
    if (!ids) {
      return {
        ok: false,
        message: `provider desconocido: ${assignment.provider}. Usá uno de: ${providerNames(groups).join(", ")}`,
      };
    }
    if (!ids.includes(assignment.model)) {
      const hints = suggest(groups, assignment.model);
      return {
        ok: false,
        message: `modelo desconocido para ${assignment.provider}: ${assignment.model}${hints.length > 0 ? `. Quizás: ${hints.join(", ")}` : ""}`,
      };
    }
    return { ok: true, provider: assignment.provider };
  }

  const owners = providersOwning(groups, assignment.model);
  if (owners.length === 1) return { ok: true, provider: owners[0] };
  if (owners.length > 1) {
    return {
      ok: false,
      message: `modelo ambiguo: ${assignment.model}. Usá provider/model: ${owners.map((p) => `${p}/${assignment.model}`).join(", ")}`,
    };
  }

  const hints = suggest(groups, assignment.model);
  return {
    ok: false,
    message: `modelo desconocido: ${assignment.model}${hints.length > 0 ? `. Quizás: ${hints.join(", ")}` : ""}`,
  };
}

/**
 * The config patch for a validated assignment: only `models`, and inside it only
 * the one slot. The merge in `src/config.ts` preserves everything else, so an
 * unrelated key the user put in the file survives.
 */
export function assignmentPatch(
  existing: { models?: Record<string, string> },
  assignment: Assignment & { provider: string | null },
): { models: Record<string, string> } {
  const qualified = assignment.provider ? `${assignment.provider}/${assignment.model}` : assignment.model;
  return {
    models: { ...(existing.models ?? {}), [assignment.slot as ConfigurableSlot]: qualified },
  };
}
