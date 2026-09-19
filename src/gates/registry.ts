// The gate list, in evaluation order. First refusal wins.
//
// The order is not cosmetic. `authorize` and `classify` are deliberately
// disjoint — `authorize` speaks only when an intent *was* declared read-only,
// `classify` only when nothing was declared — so the same call never collects
// two messages saying different things about the same missing declaration.

export const GATE_IDS = Object.freeze([
  "authorize",
  "classify",
  "track",
  "delegate",
  "evidence",
  "promotion",
] as const);

export type GateId = (typeof GATE_IDS)[number];

export function isGateId(value: string): value is GateId {
  return (GATE_IDS as readonly string[]).includes(value);
}
