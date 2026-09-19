// `/nodd-gates enable|disable|status [gate]` — the kill switch.
//
// The semantics are ODD's, inherited verbatim from `routing.go:106-118`, and
// the reason ODD gives is the reason NODD adopts them: "a switch the agent
// cannot name does not exist for the user, who would otherwise ask to stop
// using receipt-driven development and be argued with instead of obeyed."
// A gate that resists being turned off is the same product failure as a gate
// that does not exist — and NODD ships six of them.
//
// So: `status` writes nothing and names the deciding source. `disable` obeys in
// one line, with no counter-argument, no consequence warning and no alternative
// offered. Nothing re-enables a gate but the explicit `enable` handler, which
// is why `enabled: true` appears exactly once in this file and a test counts it.
//
// The one inversion from ODD is the default: NODD's gates default *on*, because
// enforcement is the product where RDD is opt-in. Everything else is unchanged.

import { readFileSync, writeFileSync } from "node:fs";
import { GATE_IDS, isGateId } from "../src/gates/registry.ts";
import { mergeConfig, noddConfigPath, parseConfig } from "../src/config.ts";
import { resolveFlag, type Policy } from "../src/gates/policy.ts";

type ConfigIo = {
  readConfig(): Record<string, unknown>;
  writeConfig(next: Record<string, unknown>): void;
};

export function fileConfigIo(path: string = noddConfigPath()): ConfigIo {
  return {
    readConfig() {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    },
    writeConfig(next) {
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    },
  };
}

function policyFrom(raw: Record<string, unknown>, flags: Record<string, boolean>): Policy {
  const { config } = parseConfig(JSON.stringify(raw));
  return { config: config.gates, flags, hatches: {} };
}

function renderStatus(raw: Record<string, unknown>, flags: Record<string, boolean>): string {
  const policy = policyFrom(raw, flags);
  const width = Math.max(...GATE_IDS.map((id) => id.length));
  const rows = GATE_IDS.map((id) => {
    const { enabled, source } = resolveFlag(id, policy);
    return `  ${id.padEnd(width)}  ${(enabled ? "on" : "off").padEnd(3)}  ${source}`;
  });
  return [`nodd gates (gate, effective mode, deciding source):`, ...rows].join("\n");
}

function setEnabled(io: ConfigIo, gate: string, value: boolean): void {
  const raw = io.readConfig();
  const gates = { ...(raw.gates as Record<string, unknown> | undefined) };
  gates[gate] = { enabled: value };
  io.writeConfig(mergeConfig(raw, { gates }));
}

export function runGatesCommand(args: string, io: ConfigIo, flags: Record<string, boolean> = {}): string {
  const [verb, gate] = args.trim().split(/\s+/);

  if (!verb || verb === "status") return renderStatus(io.readConfig(), flags);

  if (verb !== "enable" && verb !== "disable") {
    return `nodd-gates: usage — /nodd-gates [status|enable <gate>|disable <gate>]`;
  }
  if (!gate || !isGateId(gate)) {
    return `nodd-gates: unknown gate "${gate ?? ""}". Valid gates: ${GATE_IDS.join(", ")}`;
  }

  if (verb === "disable") {
    setEnabled(io, gate, false);
    // One line. No argument, no consequence warning, no alternative, no hint
    // about turning it back on. This shape is asserted by test because
    // "do not argue" is a behaviour, and behaviours drift.
    return `nodd: gate ${gate} disabled.`;
  }

  // The only place in NODD that turns a gate on. Reached only from an explicit
  // `/nodd-gates enable` — never from a session start, a threshold or another
  // gate, and never on the user's behalf.
  setEnabled(io, gate, true);
  return `nodd: gate ${gate} enabled.`;
}

type PiApi = {
  registerCommand?(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => void }): void;
  registerFlag?(name: string, options: unknown): void;
};

export default function register(pi?: PiApi): void {
  pi?.registerFlag?.("nodd-off", {
    description: "Disable one NODD gate for this session, or all of them: --nodd-off=track | --nodd-off=all",
    type: "string",
  });

  pi?.registerCommand?.("nodd-gates", {
    description: "Read or set NODD's per-gate switches: /nodd-gates [status|enable <gate>|disable <gate>]",
    handler: (args: string, ctx: unknown) => {
      const notify = (ctx as { ui?: { notify?(m: string, t?: string): void } })?.ui?.notify;
      try {
        notify?.(runGatesCommand(args ?? "", fileConfigIo()), "info");
      } catch (err) {
        notify?.(`nodd-gates: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}

/** Parse `--nodd-off=<id|all>` into the policy's flag map. */
export function flagsFromCli(value: string | undefined): Record<string, boolean> {
  if (!value) return {};
  if (value === "all") return { all: false };
  return isGateId(value) ? { [value]: false } : {};
}
