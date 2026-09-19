// The thinking level of a slot: pi's reasoning effort, per configured model.
//
// Adapted from `zero-models.ts:84-93`. These six strings are the real pi effort
// levels and the only source of truth for validity here — `max` and `ultracode`
// are not levels, and a config that names one is rejected rather than passed
// through to frontmatter pi cannot resolve.
//
// The level is not decoration: `extensions/nodd-agents.ts` emits it as the
// `thinking:` line of every generated agent file, which is what makes choosing
// one in the picker mean something.

/** The six real pi effort levels, ascending. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** slot -> level. Partial on purpose: an absent slot means no level configured. */
export type SlotThinking = Record<string, ThinkingLevel>;

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}
