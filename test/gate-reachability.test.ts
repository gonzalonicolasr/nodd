// The reachability invariant, asserted as a class rather than per gate (T011).
//
// This run produced four instances of one defect family — track, classify,
// delegate and promotion each refused work while offering only remedies the
// refused actor could not perform — plus a fifth, defect #6, where a refusal
// inflated the very counter that caused it. Each was fixed where it was found.
// Fixing instances is not the same as holding the rule: the next gate still
// ships without anyone checking.
//
// So the invariant has two clauses, and both are enumerated over `GATE_IDS`:
//
//   1. Every refusal names at least one remedy its recipient can perform.
//   2. No refusal worsens the state that caused it.
//
// Clause 2 is the one that would have caught defect #6.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import register from "../extensions/nodd-kernel.ts";
import { GATE_IDS } from "../src/gates/registry.ts";

const GATES_DIR = join(import.meta.dirname, "..", "src", "gates");

/**
 * A remedy reachable by any actor, needing no tool and no slash command.
 *
 * NODD's own generated writer, `nodd-implement`, holds
 * `read, grep, ls, write, edit, bash` and nothing else: it cannot call
 * `subagent`, cannot call `nodd_declare`, and has no slash commands. A gate
 * whose every remedy needs one of those can refuse it into a dead end, which
 * is how three of this run's deadlocks happened.
 */
const UNIVERSAL_REMEDY = /report .*(block|delegator)|ask the user|write .*directly|run the verification command/i;

test("every gate offers a remedy its recipient can actually perform", () => {
  const offenders: string[] = [];

  for (const gate of GATE_IDS) {
    const source = readFileSync(join(GATES_DIR, `${gate}.ts`), "utf8");
    // `allow()`-only gates never refuse, so they cannot strand anyone.
    if (!source.includes("refuse(")) continue;
    if (!UNIVERSAL_REMEDY.test(source)) offenders.push(gate);
  }

  assert.deepEqual(
    offenders,
    [],
    `these gates refuse work while every remedy needs a tool or slash command the actor may lack: ${offenders.join(", ")}`,
  );
});

test("a refusal never worsens the state that caused it", () => {
  // Clause 2, driven through the real `tool_call` hook. A gate that counts its
  // own refusals escalates without bound and can never be satisfied: the actor
  // is locked out of the session for work it never did.
  const handlers = new Map<string, (event: unknown) => unknown>();
  const kernel = register(
    { on: (n: string, f: (e: unknown) => unknown) => handlers.set(n, f), registerTool: () => {}, appendEntry: () => {} } as never,
    "/tmp/nodd-reachability-probe",
  );

  const declared = { intent: "change", route: "inline", slug: "probe", summary: "s", title: "P" };
  kernel.declare(declared as never);
  const declare = { toolName: "nodd_declare", toolCallId: "d1", input: declared };
  handlers.get("tool_call")!(declare);
  handlers.get("tool_result")!({ ...declare, isError: false, content: "" });

  const reasons: string[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const event = { toolName: "write", toolCallId: `w${i}`, input: { file_path: `/repo/f${i}.ts` } };
    const decision = handlers.get("tool_call")!(event) as { reason?: string } | undefined;
    // pi reports a result only for calls it executed (`agent-loop.js:419-428`).
    if (!decision) handlers.get("tool_result")!({ ...event, isError: false, content: "" });
    else reasons.push(String(decision.reason));
  }

  const counts = reasons
    .map((reason) => Number(/written (\d+) distinct files/.exec(reason)?.[1] ?? 0))
    .filter((n) => n > 0);

  assert.ok(counts.length > 0, "expected the writer trigger to fire at all");
  assert.equal(
    new Set(counts).size,
    1,
    `the refusal count climbed across refused writes (${counts.join(", ")}): each refusal is feeding the trigger that caused it`,
  );
});
