// What `/nodd-models` shows, and what it lets you change.
//
// All seven canonical ODD steps are displayed, because the visible protocol is
// part of what NODD inherits: hiding `authorize`, `classify`, `track` and
// `close` would make the mechanized half of ODD invisible. But those four run no
// model — they are comparators and file writers — so they get no slot. A
// decorative slot on a step that never calls a model is a lie with a dropdown.
//
// Assignable: the two global slots plus the three model-backed steps.

import { CANONICAL_STEPS, CONFIGURABLE_SLOTS, MECHANISM_STEPS, type ConfigurableSlot } from "../manifest.ts";

export type SlotRow = {
  id: string;
  /** `global` and `step` are assignable; `mechanism` is displayed only. */
  kind: "global" | "step" | "mechanism";
  /** What the row shows when it carries no model. */
  placeholder: string;
};

export const MECHANISM_PLACEHOLDER = "mecanismo · sin modelo";

const GLOBAL_SLOTS = ["default", "orchestrator"] as const;

function isMechanism(step: string): boolean {
  return (MECHANISM_STEPS as readonly string[]).includes(step);
}

/**
 * The display model: the two global slots first, then the seven canonical steps
 * in protocol order. The order is the contract — a test asserts it.
 */
export const SLOT_ROWS: readonly SlotRow[] = Object.freeze([
  ...GLOBAL_SLOTS.map((id): SlotRow => ({ id, kind: "global", placeholder: "sin asignar" })),
  ...CANONICAL_STEPS.map((id): SlotRow =>
    isMechanism(id)
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
