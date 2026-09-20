import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_IDS } from "../src/gates/registry.ts";
import { consumeHatch, emptyPolicy, refuse } from "../src/gates/policy.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register, { runAllowCommand } from "./nodd-allow.ts";

function session() {
  const entries: Array<{ type: string; data: any }> = [];
  return {
    entries,
    policy: emptyPolicy(),
    appendEntry(type: string, data: unknown) { entries.push({ type, data: data as any }); },
  };
}

/** A gate that always refuses, wrapped so a granted hatch can clear it once. */
function attempt(policy: ReturnType<typeof emptyPolicy>, gate: (typeof GATE_IDS)[number]) {
  const consumed = consumeHatch(policy, gate);
  if (consumed) return { blocked: false, policy: consumed.policy };
  refuse(gate, "observed", "do the thing");
  return { blocked: true, policy };
}

test("after /nodd-allow track the next track refusal passes and the one after blocks", () => {
  const s = session();
  const granted = runAllowCommand("track I know what I am doing", s.policy, s);
  assert.equal(granted.ok, true);

  const first = attempt(granted.policy, "track");
  assert.equal(first.blocked, false, "the override clears the next refusal");

  const second = attempt(first.policy, "track");
  assert.equal(second.blocked, true, "the override was one-shot");
});

test("an override for one gate does not affect another", () => {
  const s = session();
  const granted = runAllowCommand("track", s.policy, s);
  assert.equal(attempt(granted.policy, "classify").blocked, true, "classify is untouched");
  assert.equal(attempt(granted.policy, "track").blocked, false);
});

test("one audit entry is appended with gate, timestamp and reason", () => {
  const s = session();
  runAllowCommand("delegate the count is wrong here", s.policy, s, () => "2026-09-19T10:00:00.000Z");
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].type, "nodd:allow");
  assert.deepEqual(s.entries[0].data, {
    gate: "delegate",
    reason: "the count is wrong here",
    at: "2026-09-19T10:00:00.000Z",
  });
});

test("a reason is optional and recorded as empty, never invented", () => {
  const s = session();
  runAllowCommand("track", s.policy, s, () => "t");
  assert.equal(s.entries[0].data.reason, "");
});

test("an unknown gate id lists the valid ids and grants nothing", () => {
  const s = session();
  const result = runAllowCommand("nonsense", s.policy, s);
  assert.equal(result.ok, false);
  for (const id of GATE_IDS) assert.ok(result.text.includes(id), `must list ${id}`);
  assert.deepEqual(result.policy.hatches, {}, "nothing was granted");
  assert.deepEqual(s.entries, [], "a rejected request is not audited as a grant");
});

test("an empty invocation explains itself instead of granting silently", () => {
  const s = session();
  const result = runAllowCommand("", s.policy, s);
  assert.equal(result.ok, false);
  assert.deepEqual(result.policy.hatches, {});
});

// ---------------------------------------------------------------------------
// The escape hatch has to reach the kernel.
//
// Every refusal NODD emits ends with "To override this once: /nodd-allow
// <gate>", so this command is the product's promise that a user is never
// stuck. It was inert: `register(pi, policyRef)` takes the ref as a defaulted
// parameter, pi calls extension factories with one argument, and the command
// wrote the hatch into a fresh literal connected to nothing. It reported
// success and changed no behaviour.
//
// Extensions are separate modules with no channel between them, so the hatch
// travels the way every other NODD decision does: through disk, which the
// kernel already re-reads on every `tool_call`.
// ---------------------------------------------------------------------------
test("a granted hatch lets exactly one refused call through", async () => {
  const home = mkdtempSync(join(tmpdir(), "nodd-hatch-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "nodd-hatch-cwd-"));
  const handlers = new Map<string, (event: unknown) => unknown>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => void }>();
  const pi = {
    on: (n: string, f: (e: unknown) => unknown) => handlers.set(n, f),
    registerTool: () => {},
    registerFlag: () => {},
    registerCommand: (n: string, o: { handler: (a: string, c: unknown) => void }) => commands.set(n, o),
    appendEntry: () => {},
  };
  const kernelReg = (await import("./nodd-kernel.ts")).default;
  kernelReg(pi as never, cwd, home);
  // As pi loads it: one argument, no shared reference.
  register(pi as never, undefined, home);

  const write = { toolName: "write", toolCallId: "w1", input: { file_path: "src/a.ts" } };
  assert.ok(handlers.get("tool_call")!(write), "an undeclared write must be refused to begin with");

  commands.get("nodd-allow")!.handler("classify", { ui: { notify: () => {} } });

  assert.equal(
    handlers.get("tool_call")!({ ...write, toolCallId: "w2" }),
    undefined,
    "the granted hatch did not reach the kernel: /nodd-allow reported success and changed nothing",
  );
  assert.ok(
    handlers.get("tool_call")!({ ...write, toolCallId: "w3" }),
    "the hatch is one-shot: the call after it must refuse again",
  );
});
