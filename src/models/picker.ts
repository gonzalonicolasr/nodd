// The picker's decisions, as a pure state machine.
//
// Dependency-free by design, after `zero-models-picker.ts:5-11`: no `node:fs`,
// no pi, and above all no TUI package — not even as a type. The host in
// `extensions/nodd-models.ts` owns rendering and keystrokes and holds one
// `PickerState`; every navigation and staging decision is here, where
// `node --test` can reach it without a terminal.
//
// Two properties the tests pin down, because both are easy to lose in a
// refactor: the four mechanism rows are displayed but never selectable (a cursor
// that can land on `classify` implies a slot that does not exist), and this
// module writes nothing. It returns outcomes; the command decides.

import { SLOT_ROWS, type SlotRow } from "./slots.ts";

export type Row = SlotRow & {
  /** `action` rows are save/quit; the rest come from the slot table. */
  kind: SlotRow["kind"] | "action";
  /** The model to show, or the row's placeholder. */
  value: string;
  selectable: boolean;
};

export type PickerState = {
  cursor: number;
  /** slot -> `provider/model`, as read from config. */
  models: Record<string, string>;
  /** Edits not yet saved. Empty until the user chooses something. */
  staged: Record<string, string>;
  groups: Map<string, string[]>;
};

export type EnterResult =
  | { type: "choose"; slot: string; options: string[] }
  | { type: "save"; models: Record<string, string> }
  | { type: "quit" };

const ACTION_ROWS: Row[] = [
  { id: "save", kind: "action", placeholder: "", value: "— guardar y salir —", selectable: true },
  { id: "quit", kind: "action", placeholder: "", value: "— salir sin guardar —", selectable: true },
];

export function createPickerState(input: {
  models: Record<string, string>;
  groups: Map<string, string[]>;
}): PickerState {
  const state: PickerState = { cursor: 0, models: { ...input.models }, staged: {}, groups: input.groups };
  // Start on a row the user can actually act on, whatever the table's shape.
  return { ...state, cursor: nextSelectable(state, 0, 1) };
}

/** The full display, in order: globals, the seven steps, then the actions. */
export function renderRows(state: PickerState): Row[] {
  const assigned = { ...state.models, ...state.staged };
  const slots = SLOT_ROWS.map((row): Row => ({
    ...row,
    value: row.kind === "mechanism" ? row.placeholder : assigned[row.id] ?? row.placeholder,
    selectable: row.kind !== "mechanism",
  }));
  return [...slots, ...ACTION_ROWS];
}

/** Every `provider/model` pi can resolve, qualified, in registry order. */
export function modelOptions(groups: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const [provider, ids] of groups) {
    for (const id of ids) out.push(`${provider}/${id}`);
  }
  return out;
}

function nextSelectable(state: PickerState, from: number, step: number): number {
  const rows = renderRows(state);
  for (let i = 0; i < rows.length; i++) {
    const index = (((from + i * step) % rows.length) + rows.length) % rows.length;
    if (rows[index].selectable) return index;
  }
  return from;
}

/** Move the cursor, wrapping at both ends and skipping mechanism rows. */
export function moveCursor(state: PickerState, step: number): PickerState {
  const rows = renderRows(state);
  const start = (((state.cursor + step) % rows.length) + rows.length) % rows.length;
  return { ...state, cursor: nextSelectable(state, start, step >= 0 ? 1 : -1) };
}

export function enter(state: PickerState): EnterResult {
  const row = renderRows(state)[state.cursor];
  if (row.id === "quit") return { type: "quit" };
  if (row.id === "save") return { type: "save", models: { ...state.models, ...state.staged } };
  return { type: "choose", slot: row.id, options: modelOptions(state.groups) };
}

/** Stage a choice. Nothing is written until the user picks the save row. */
export function stage(state: PickerState, slot: string, model: string): PickerState {
  return { ...state, staged: { ...state.staged, [slot]: model } };
}
