// The shape every NODD gate shares: a decision, a flag and an escape hatch.
//
// `remedy` is non-optional on a refusal. A gate that blocks without telling the
// agent how to proceed is the worst kind of gate — it turns enforcement into a
// dead end — so the type makes that unwritable rather than merely discouraged.
//
// Flag resolution keeps its source instead of collapsing it to a boolean,
// because `/nodd-gates status` has to answer "who decided this?" and `default`
// has to mean "nobody chose" (`routing.go:114`).

import type { GateId } from "./registry.ts";

export type Remedy = {
  action: string;
  escapeHatch: `/nodd-allow ${GateId}`;
};

export type GateDecision =
  | { allow: true }
  | { allow: false; gate: GateId; reason: string; remedy: Remedy };

export type FlagSource = "flag" | "config" | "default";
export type ResolvedFlag = { enabled: boolean; source: FlagSource };

export type Policy = {
  /** From `~/.pi/nodd.json`. */
  config: Record<string, { enabled: boolean }>;
  /** From the `--nodd-off` CLI flag. `all` disables every gate. */
  flags: Record<string, boolean>;
  /** Granted one-shot overrides, by gate id. */
  hatches: Record<string, { reason: string; at?: string }>;
};

export function emptyPolicy(): Policy {
  return { config: {}, flags: {}, hatches: {} };
}

export function resolveFlag(gate: GateId, policy: Policy): ResolvedFlag {
  if (policy.flags.all === false) return { enabled: false, source: "flag" };
  const flag = policy.flags[gate];
  if (typeof flag === "boolean") return { enabled: flag, source: "flag" };
  const configured = policy.config[gate]?.enabled;
  if (typeof configured === "boolean") return { enabled: configured, source: "config" };
  // NODD's gates default on: enforcement is the product. Everything else about
  // the kill switch is ODD's, unchanged.
  return { enabled: true, source: "default" };
}

export function allow(): GateDecision {
  return { allow: true };
}

/**
 * Build a refusal. The rendered reason always carries three things: what was
 * observed, the concrete action, and the escape hatch.
 */
export function refuse(gate: GateId, observed: string, action: string): GateDecision {
  const escapeHatch = `/nodd-allow ${gate}` as const;
  return {
    allow: false,
    gate,
    reason: `nodd/${gate}: ${observed}. To proceed: ${action}. To override this once: ${escapeHatch}`,
    remedy: { action, escapeHatch },
  };
}

/** First refusal wins: a single call never collects two overlapping messages. */
export function firstRefusal(decisions: GateDecision[]): Extract<GateDecision, { allow: false }> | null {
  for (const decision of decisions) {
    if (decision.allow === false) return decision;
  }
  return null;
}

export function grantHatch(policy: Policy, gate: GateId, reason: string, at?: string): Policy {
  return { ...policy, hatches: { ...policy.hatches, [gate]: { reason, ...(at ? { at } : {}) } } };
}

/**
 * Consume a one-shot override for exactly this gate. Returns the reason and the
 * policy with the override spent, or null when there is none — never implicit,
 * never permanent, never cross-gate.
 */
export function consumeHatch(policy: Policy, gate: GateId): { reason: string; policy: Policy } | null {
  const hatch = policy.hatches[gate];
  if (!hatch) return null;
  const hatches = { ...policy.hatches };
  delete hatches[gate];
  return { reason: hatch.reason, policy: { ...policy, hatches } };
}
