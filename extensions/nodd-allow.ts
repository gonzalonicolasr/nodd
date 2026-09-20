// `/nodd-allow <gate> [reason]` — the escape hatch.
//
// A gate that is wrong is worse than no gate, so every gate ships with a way
// past it from day one. The constraints are what keep it from becoming a
// silent opt-out: one shot, consumed by the next refusal of that one gate,
// audited through `pi.appendEntry`, never implicit and never permanent.
//
// Turning a gate off for good is `/nodd-gates disable`, which is a different
// decision and says so.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hatchPath } from "../src/config.ts";
import { GATE_IDS, isGateId } from "../src/gates/registry.ts";
import { grantHatch, type Policy } from "../src/gates/policy.ts";

export const ALLOW_ENTRY = "nodd:allow";

type Session = { appendEntry(type: string, data: unknown): void };

export type AllowResult = { ok: boolean; text: string; policy: Policy };

export function runAllowCommand(
  args: string,
  policy: Policy,
  session: Session,
  now: () => string = () => new Date().toISOString(),
): AllowResult {
  const trimmed = (args ?? "").trim();
  const [gate, ...rest] = trimmed.split(/\s+/);

  if (!gate) {
    return {
      ok: false,
      text: `nodd-allow: usage — /nodd-allow <gate> [reason]. Valid gates: ${GATE_IDS.join(", ")}`,
      policy,
    };
  }
  if (!isGateId(gate)) {
    return {
      ok: false,
      text: `nodd-allow: unknown gate "${gate}". Valid gates: ${GATE_IDS.join(", ")}`,
      policy,
    };
  }

  const reason = rest.join(" ");
  const at = now();
  try {
    session.appendEntry(ALLOW_ENTRY, { gate, reason, at });
  } catch {
    // The audit trail is best effort; the override itself still stands.
  }

  return {
    ok: true,
    text: `nodd: one-shot override granted for ${gate}. It is consumed by the next ${gate} refusal.`,
    policy: grantHatch(policy, gate, reason, at),
  };
}

type PiApi = {
  registerCommand?(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => void }): void;
  appendEntry?(type: string, data?: unknown): void;
};

export default function register(
  pi?: PiApi,
  policyRef: { current: Policy } = { current: { config: {}, flags: {}, hatches: {} } },
  home?: string,
): void {
  pi?.registerCommand?.("nodd-allow", {
    description: "Grant a one-shot override of a single NODD gate: /nodd-allow <gate> [reason]",
    handler: (args: string, ctx: unknown) => {
      const notify = (ctx as { ui?: { notify?(m: string, t?: string): void } })?.ui?.notify;
      const result = runAllowCommand(args ?? "", policyRef.current, {
        appendEntry: (type, data) => pi?.appendEntry?.(type, data),
      });
      policyRef.current = result.policy;
      // The kernel lives in another module with no reference to this one, so
      // the hatch reaches it the way every other NODD decision travels: on
      // disk, which the kernel re-reads on each `tool_call`. Without this the
      // command reported success and changed nothing at all.
      if (result.ok) {
        try {
          const path = hatchPath(home);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, `${JSON.stringify(result.policy.hatches)}\n`, "utf8");
        } catch {
          // A hatch that cannot be persisted must not break the session; the
          // refusal simply stands, which is the safe direction.
        }
      }
      notify?.(result.text, result.ok ? "info" : "warning");
    },
  });
}
