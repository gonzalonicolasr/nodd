// The reachability invariant, asserted as a class rather than per gate (T011).
//
// This project produced five instances of one defect family — track, classify,
// delegate, promotion and authorize each refused work while offering only
// remedies the refused actor could not perform — plus defect #6, where a
// refusal inflated the very counter that caused it. Each was fixed where it
// was found. Fixing instances is not the same as holding the rule.
//
// Round 2 of the adversarial review showed the first version of this file did
// not hold it either. Clause 1 regex-scanned gate *source*, so a gate passed by
// having the phrase in a comment while its runtime remedy was a dead end.
// Clause 2 claimed to enumerate `GATE_IDS` and actually exercised one trigger
// of one gate. Both mutations survived. The rewrite drives real refusals.
//
//   1. Every refusal names at least one remedy its recipient can perform.
//   2. No refusal worsens the state that caused it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register from "../extensions/nodd-kernel.ts";
import { GATE_IDS } from "../src/gates/registry.ts";
import { emptyPolicy } from "../src/gates/policy.ts";
import { emptyCommitted, type Committed } from "../src/state.ts";
import { authorizeGate } from "../src/gates/authorize.ts";
import { classifyGate } from "../src/gates/classify.ts";
import { trackGate } from "../src/gates/track.ts";
import { delegateGate } from "../src/gates/delegate.ts";
import { promotionGate } from "../src/gates/promotion.ts";
import { evidenceGate } from "../src/gates/evidence.ts";

/**
 * A remedy reachable by any actor, needing no tool and no slash command.
 *
 * NODD's own generated writer, `nodd-implement`, holds
 * `read, grep, ls, write, edit, bash` and nothing else: no `subagent`, no
 * `nodd_declare`, no slash commands. A gate whose every remedy needs one of
 * those can refuse it into a dead end.
 */
const UNIVERSAL_REMEDY =
  /report .*(block|delegator)|ask the user|write .*directly|run the verification command/i;

const declared = (route: "inline" | "tracked" | "forge", intent: "read-only" | "change" = "change"): Committed => ({
  ...emptyCommitted(),
  declaration: { intent, route, slug: "demo", title: "T", summary: "s" } as never,
});

const write = { toolName: "write", input: { path: "src/a.ts" } };

/**
 * One real refusal from every registered gate, produced by driving the gate —
 * not by reading its source. If a gate stops refusing here the lookup throws,
 * so the enumeration cannot silently cover nothing.
 */
/**
 * The inputs that make one gate refuse. Built once per scenario so a gate that
 * mutates what it was handed is visible across repeated refusals.
 */
function scenarioFor(gate: string): Record<string, unknown> {
  switch (gate) {
    case "authorize":
      return { committed: declared("inline", "read-only") };
    case "classify":
      return { committed: emptyCommitted() };
    case "track":
      return { committed: declared("tracked") };
    case "delegate":
      return { committed: { ...declared("inline"), filesWritten: new Set(["a.ts", "b.ts"]) } };
    case "promotion":
      return { signals: { declaredFiles: 1, observedFiles: 9, slug: "demo", route: "tracked" } };
    case "evidence":
      return { committed: declared("tracked") };
    default:
      throw new Error(`unknown gate ${gate}`);
  }
}

/**
 * One real refusal, produced by driving the gate — never by reading its source.
 * The first version of this file regex-scanned gate source, so a gate passed by
 * having the right phrase in a comment while its runtime remedy was a dead end.
 */
function refuse(gate: string, scenario: Record<string, unknown>): { reason: string; action: string } {
  const c = scenario.committed as Committed;
  const decision = (() => {
    switch (gate) {
      case "authorize":
        return authorizeGate(c, write, emptyPolicy());
      case "classify":
        return classifyGate(c, write, emptyPolicy(), new Map());
      case "track":
        return trackGate(c, write, emptyPolicy(), () => false);
      case "delegate":
        return delegateGate(c, write, emptyPolicy(), new Map());
      case "promotion":
        return promotionGate(scenario.signals as never, write, emptyPolicy());
      case "evidence":
        return evidenceGate(c, [], { kind: "check", slug: "demo", id: "T1" } as never, emptyPolicy());
      default:
        throw new Error(`unknown gate ${gate}`);
    }
  })();
  assert.equal(decision.allow, false, `gate ${gate} was expected to refuse in this scenario`);
  const refused = decision as { reason: string; remedy?: { action: string } };
  return { reason: refused.reason, action: refused.remedy?.action ?? "" };
}

/** One refusal from a fresh scenario, for the clauses that do not repeat. */
function refusalOf(gate: string): { reason: string; action: string } {
  return refuse(gate, scenarioFor(gate));
}

test("every gate offers a remedy its recipient can actually perform", () => {
  const offenders: string[] = [];
  for (const gate of GATE_IDS) {
    const { action } = refusalOf(gate);
    if (!UNIVERSAL_REMEDY.test(action)) offenders.push(`${gate} ("${action}")`);
  }
  assert.deepEqual(
    offenders,
    [],
    `these gates refuse work while every remedy needs a tool or slash command the actor may lack: ${offenders.join("; ")}`,
  );
});

test("every refusal names its own escape hatch", () => {
  // The hatch is the last resort when every other remedy is out of reach, so a
  // refusal that omits it is a dead end even when its advice is sound.
  for (const gate of GATE_IDS) {
    assert.match(refusalOf(gate).reason, new RegExp(`/nodd-allow ${gate}\\b`), `gate ${gate} hides its hatch`);
  }
});

test("a refusal never worsens the state that caused it", () => {
  // Clause 2, over every gate: refusing the same call repeatedly must not
  // change the refusal. A gate that counts its own refusals escalates without
  // bound and can never be satisfied — defect #6's signature.
  const drifting: string[] = [];
  for (const gate of GATE_IDS) {
    // One scenario object, refused four times. Rebuilding the inputs per call
    // would hide exactly the defect this looks for: a gate that mutates the
    // state it was handed cannot be caught by a fresh copy each time.
    const scenario = scenarioFor(gate);
    const reasons = [0, 1, 2, 3].map(() => refuse(gate, scenario).reason);
    if (new Set(reasons).size > 1) drifting.push(`${gate} (${reasons.join(" | ")})`);
  }
  assert.deepEqual(drifting, [], `these refusals change as they repeat, feeding the trigger that caused them: ${drifting.join(", ")}`);
});

test("a refused call leaves no trace in the counters that refuse the next one", () => {
  // The same clause end to end, through the kernel: the path where defect #6
  // actually lived. Blocked calls and abandoned calls must both be forgotten,
  // or the session locks itself out over work that never happened.
  const handlers = new Map<string, (event: unknown) => unknown>();
  const kernel = register(
    { on: (n: string, f: (e: unknown) => unknown) => handlers.set(n, f), registerTool: () => {}, appendEntry: () => {} } as never,
    mkdtempSync(join(tmpdir(), "nodd-reach-")),
    mkdtempSync(join(tmpdir(), "nodd-reach-h-")),
  );
  const decl = { intent: "change", route: "inline", slug: "probe", summary: "s", title: "P" };
  kernel.declare(decl as never);
  const d = { toolName: "nodd_declare", toolCallId: "d1", input: decl };
  handlers.get("tool_call")!(d);
  handlers.get("tool_result")!({ ...d, isError: false, content: "" });

  const counts: number[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const event = { toolName: "write", toolCallId: `w${i}`, input: { file_path: `/repo/f${i}.ts` } };
    const decision = handlers.get("tool_call")!(event) as { reason?: string } | undefined;
    if (!decision) handlers.get("tool_result")!({ ...event, isError: false, content: "" });
    else counts.push(Number(/written (\d+) distinct files/.exec(String(decision.reason))?.[1] ?? 0));
    handlers.get("turn_end")!({});
  }

  assert.ok(counts.length > 0, "expected the writer trigger to fire at all");
  assert.equal(
    new Set(counts).size,
    1,
    `the refusal count climbed across refused writes (${counts.join(", ")}): each refusal is feeding the trigger that caused it`,
  );
});

// ---------------------------------------------------------------------------
// A delegated worker cannot declare its own route.
//
// Observed five times in one SDD run: clarify, plan, analyze and build were
// each refused by `gate-classify` on their first write, because a subagent has
// neither `nodd_declare` nor slash commands, and kernel state is per session —
// a declaration made by the parent is invisible to the child.
//
// The gate is correct and this test says so: what it pins is that the refusal
// stays escapable by an actor with no tools at all. If someone ever narrows
// that remedy, delegation becomes a dead end and this turns red.
// ---------------------------------------------------------------------------
test("a child kernel's first write is refused with a remedy it can reach", () => {
  const decision = classifyGate(
    emptyCommitted(), // exactly the state a freshly started child kernel has
    { toolName: "write", input: { path: "src/a.ts" } },
    emptyPolicy(),
    new Map(),
  );

  assert.equal(decision.allow, false, "an undeclared child must not write unannounced");
  const remedy = (decision as { remedy?: { action: string } }).remedy?.action ?? "";
  assert.match(
    remedy,
    UNIVERSAL_REMEDY,
    `a delegated worker has no tools to act on: "${remedy}"`,
  );
});

test("the remedy that needs no tool is not buried last", () => {
  // Two reviewers and one live session reported the same thing: when the
  // refused actor is a subagent, the first remedy needs `nodd_declare` and the
  // hatch needs a slash command — neither reachable — and the one that always
  // works is third, in prose. It saved the session every time, but only after
  // the reader got through two dead ends.
  //
  // Order is not design, it is wording, and a remedy list is read top to
  // bottom by someone who is already blocked.
  for (const gate of GATE_IDS) {
    const { action } = refusalOf(gate);
    const universal = action.search(UNIVERSAL_REMEDY);
    if (universal === -1) continue; // clause 1 already fails that case
    const alternatives = action.slice(0, universal).split(/,| or /).filter((part) => part.trim()).length;
    assert.ok(
      alternatives <= 1,
      `gate ${gate} puts ${alternatives} unreachable options before the one that needs no tool: "${action}"`,
    );
  }
});
