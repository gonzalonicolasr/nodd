import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_IDS } from "../src/gates/registry.ts";
import { emptyPolicy, resolveFlag } from "../src/gates/policy.ts";
import { fileConfigIo, flagsFromCli, runGatesCommand } from "./nodd-gates.ts";

function ctx(config: Record<string, unknown> = {}) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    readConfig: () => config,
    writeConfig: (next: Record<string, unknown>) => { writes.push(next); },
  };
}

test("status is read-only and reports default for an untouched gate", () => {
  const c = ctx();
  const out = runGatesCommand("status", c);
  assert.deepEqual(c.writes, [], "status must write nothing");
  for (const id of GATE_IDS) {
    assert.match(out, new RegExp(`${id}\\s+on\\s+default`), `${id} row must report on/default`);
  }
});

test("status reports the deciding source when config chose", () => {
  const out = runGatesCommand("status", ctx({ gates: { track: { enabled: false } } }));
  assert.match(out, /track\s+off\s+config/);
  assert.match(out, /classify\s+on\s+default/);
});

// routing.go:115 — "do not argue, do not work around it, do not propose
// alternatives first". The one-line confirmation is the whole response.
test("disable obeys in exactly one line, with no argument and no alternative", () => {
  const c = ctx();
  const out = runGatesCommand("disable track", c);
  assert.equal(out, "nodd: gate track disabled.");
  assert.equal(out.split("\n").length, 1, "the confirmation is one line");

  const forbidden = ["but ", "however", "instead", "consider", "recommend", "warning",
    "careful", "risk", "re-enable", "reenable", "you can turn", "alternative"];
  for (const word of forbidden) {
    assert.ok(!out.toLowerCase().includes(word), `the confirmation must not contain "${word}"`);
  }
});

test("disable flips only that gate's flag", () => {
  const c = ctx({ models: { implement: "a/b" }, gates: { classify: { enabled: false } } });
  runGatesCommand("disable track", c);
  assert.equal(c.writes.length, 1);
  const written = c.writes[0] as any;
  assert.equal(written.gates.track.enabled, false);
  assert.equal(written.gates.classify.enabled, false, "another gate's choice must survive");
  assert.deepEqual(written.models, { implement: "a/b" }, "unrelated keys must survive");
});

// routing.go:116 — "do not reactivate it". Nothing but an explicit enable may
// turn a gate back on: not a session start, not a threshold, not 50 events.
test("a disabled gate stays disabled across a session start and 50 observations", () => {
  const config = { gates: { track: { enabled: false } } };
  let policy = { ...emptyPolicy(), config: { track: { enabled: false } } };
  assert.deepEqual(resolveFlag("track", policy), { enabled: false, source: "config" });

  for (let i = 0; i < 50; i++) {
    policy = { ...policy, config: { ...policy.config } };
  }
  assert.deepEqual(resolveFlag("track", policy), { enabled: false, source: "config" });
  // And a real status read after all of it still reports off, from config.
  const c = ctx(config);
  assert.match(runGatesCommand("status", c), /track\s+off\s+config/);
  assert.deepEqual(c.writes, [], "nothing re-enabled it and nothing was written");
});

test("enable is the only way back on", () => {
  const c = ctx({ gates: { track: { enabled: false } } });
  const out = runGatesCommand("enable track", c);
  assert.equal(out, "nodd: gate track enabled.");
  assert.equal((c.writes[0] as any).gates.track.enabled, true);
});

test("an unknown gate id lists the valid ids", () => {
  const out = runGatesCommand("disable nonsense", ctx());
  assert.match(out, /nonsense/);
  for (const id of GATE_IDS) assert.ok(out.includes(id), `must list ${id}`);
});

test("`enabled: true` is written from exactly one handler", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nodd-gates.ts"), "utf8");
  const occurrences = src.match(/enabled:\s*true/g) ?? [];
  assert.equal(occurrences.length, 1, `expected exactly one 'enabled: true' writer, found ${occurrences.length}`);
});

test("--nodd-off=<id> disables one gate and --nodd-off=all disables every gate", () => {
  assert.deepEqual(flagsFromCli("track"), { track: false });
  assert.deepEqual(flagsFromCli("all"), { all: false });
  assert.deepEqual(flagsFromCli("nonsense"), {}, "an unknown id disables nothing");
  assert.deepEqual(flagsFromCli(undefined), {});

  // The flag outranks config, and the status output says so.
  const one = runGatesCommand("status", ctx(), flagsFromCli("track"));
  assert.match(one, /track\s+off\s+flag/);
  assert.match(one, /classify\s+on\s+default/);

  const every = runGatesCommand("status", ctx(), flagsFromCli("all"));
  for (const id of GATE_IDS) assert.match(every, new RegExp(`${id}\\s+off\\s+flag`));
});

// ---------------------------------------------------------------------------
// The kill switch has to work on a machine that has never run pi before.
//
// `readConfig` tolerates a missing file, so a fresh user reaches the gates
// fine. `writeConfig` did not create the directory, so the first attempt to
// turn a gate off died with ENOENT — the one moment a kill switch exists for.
// ---------------------------------------------------------------------------
test("a gate can be turned off before ~/.pi exists", () => {
  const home = mkdtempSync(join(tmpdir(), "nodd-nohome-"));
  const path = join(home, ".pi", "nodd.json");
  const io = fileConfigIo(path);

  io.writeConfig({ gates: { track: { enabled: false } } });

  assert.deepEqual(io.readConfig(), { gates: { track: { enabled: false } } });
});
