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

export function groupByProvider(models: RegistryModel[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const existing = groups.get(model.provider);
    if (existing) existing.push(model.id);
    else groups.set(model.provider, [model.id]);
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

function providersOwning(groups: Map<string, string[]>, model: string): string[] {
  return [...groups.entries()].filter(([, ids]) => ids.includes(model)).map(([provider]) => provider);
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
    const ids = groups.get(assignment.provider);
    if (!ids) {
      return {
        ok: false,
        message: `provider desconocido: ${assignment.provider}. Usá uno de: ${[...groups.keys()].sort().join(", ")}`,
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
