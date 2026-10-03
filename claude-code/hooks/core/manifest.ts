// The single source of truth for NODD's numeric thresholds and its visible
// protocol. The values are copied from gentle's capability manifest
// (`internal/agents/capabilitymanifest/manifest.go:203-216`) and from the
// long-session backstop, which lives in gentle only as prose
// (`internal/components/agentguidance/routing.go:82`).
//
// The difference from gentle is the consumer: there these numbers feed
// `fmt.Fprintf`, here they feed a comparator (`src/gates/delegate.ts`). No gate
// module may restate a threshold literal.

export const THRESHOLDS = Object.freeze({
  /** Direct inline: decide or verify from 1–3 files. */
  minUnderstandingFiles: 1,
  maxUnderstandingFiles: 3,
  /** One mechanical, already-understood file change stays inline. */
  maxMechanicalWriteFiles: 1,
  /** Mapping trigger: 4+ distinct understanding files. */
  mappingMinUnderstandingFiles: 4,
  /** Writer trigger: 2+ non-trivial writer files. */
  writerMinNonTrivialFiles: 2,
  /** Long-session backstop: about 20 tool calls without a delegation. */
  longSessionToolCalls: 20,
});

/** The seven ODD steps, in protocol order. This is NODD's visible contract. */
export const CANONICAL_STEPS = Object.freeze([
  "authorize",
  "explore",
  "resolve-uncertainty",
  "classify",
  "track",
  "implement",
  "close",
] as const);

export type CanonicalStep = (typeof CANONICAL_STEPS)[number];

/**
 * The four steps NODD implements as mechanism — gates, comparators and file
 * writers. They stay visible so the protocol is legible, but they run no model,
 * so giving them a slot would be decoration.
 */
export const MECHANISM_STEPS = Object.freeze([
  "authorize",
  "classify",
  "track",
  "close",
] as const);

export type MechanismStep = (typeof MECHANISM_STEPS)[number];

/** The four slots `/nodd-models` can assign: one global fallback, three model-backed steps. */
export const CONFIGURABLE_SLOTS = Object.freeze([
  "default",
  "explore",
  "resolve-uncertainty",
  "implement",
] as const);

export type ConfigurableSlot = (typeof CONFIGURABLE_SLOTS)[number];
