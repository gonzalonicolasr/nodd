// What `/nodd-models` shows, and what it lets you change.
//
// All seven canonical ODD steps are displayed, because the visible protocol is
// part of what NODD inherits: hiding `authorize`, `classify`, `track` and
// `close` would make the mechanized half of ODD invisible. But those four run no
// model — they are comparators and file writers — so they get no slot. A
// decorative slot on a step that never calls a model is a lie with a dropdown.
//
// Assignable: the global `default` fallback plus the three model-backed steps.

import { CANONICAL_STEPS, CONFIGURABLE_SLOTS, MECHANISM_STEPS, type ConfigurableSlot } from "../manifest.ts";

export type SlotRow = {
  id: string;
  /** `global` and `step` are assignable; `mechanism` is displayed only. */
  kind: "global" | "step" | "mechanism";
  /** What the row shows when it carries no model. */
  placeholder: string;
};

export const MECHANISM_PLACEHOLDER = "mecanismo · sin modelo";

const GLOBAL_SLOTS = ["default"] as const;

/** A canonical step NODD implements as mechanism, so it gets no slot. */
export function isMechanismSlot(id: string): boolean {
  return (MECHANISM_STEPS as readonly string[]).includes(id);
}

/**
 * The display model: the global `default` fallback first, then the seven
 * canonical steps in protocol order. The order is the contract — a test
 * asserts it.
 */
export const SLOT_ROWS: readonly SlotRow[] = Object.freeze([
  ...GLOBAL_SLOTS.map((id): SlotRow => ({
    id,
    kind: "global",
    // The model used when a step's own slot is unset.
    placeholder: "sin asignar",
  })),
  ...CANONICAL_STEPS.map((id): SlotRow =>
    isMechanismSlot(id)
      ? { id, kind: "mechanism", placeholder: MECHANISM_PLACEHOLDER }
      : { id, kind: "step", placeholder: "sin asignar" },
  ),
]);

export function slotRow(id: string): SlotRow | undefined {
  return SLOT_ROWS.find((row) => row.id === id);
}

export function isConfigurableSlot(id: string): id is ConfigurableSlot {
  return (CONFIGURABLE_SLOTS as readonly string[]).includes(id);
}
