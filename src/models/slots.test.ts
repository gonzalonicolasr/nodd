// T007 -- characterize the slot surface BEFORE T008 removes `orchestrator`.
//
// `rdd-delivery-exception-removal` calls for pinning current behaviour before a
// removal, so the delta is visible rather than inferred. This test documents
// today's surface: which ids `CONFIGURABLE_SLOTS` and `GLOBAL_SLOTS` contain,
// which rows the picker shows as assignable, and that `orchestrator` is
// currently accepted by `validateAssignment` -- all against the CURRENT code,
// before T008 touches it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIGURABLE_SLOTS } from "../manifest.ts";
import { SLOT_ROWS, isConfigurableSlot } from "./slots.ts";
import { groupByProvider, parseAssignment, validateAssignment } from "./assign.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("CONFIGURABLE_SLOTS today includes orchestrator alongside default, explore, resolve-uncertainty, implement", () => {
  assert.deepEqual(
    [...CONFIGURABLE_SLOTS].sort(),
    ["default", "explore", "implement", "orchestrator", "resolve-uncertainty"].sort(),
  );
});

test("the slot table today shows orchestrator as a global, assignable row", () => {
  const row = SLOT_ROWS.find((r) => r.id === "orchestrator");
  assert.ok(row, "orchestrator must be a row today");
  assert.equal(row!.kind, "global");
  assert.equal(isConfigurableSlot("orchestrator"), true, "orchestrator is assignable today");
});

test("validateAssignment accepts orchestrator=provider/model today", () => {
  const groups = groupByProvider([{ provider: "anthropic", id: "claude-opus-4-1" }]);
  const assignment = parseAssignment("orchestrator=anthropic/claude-opus-4-1");
  assert.ok(assignment);
  const result = validateAssignment(assignment!, groups);
  assert.equal(result.ok, true, "orchestrator is accepted by validateAssignment today");
});

/** Every `.ts` file under a directory, one level of nesting included. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("orchestrator is inert today: no non-test source under src/ or extensions/ reads the orchestrator slot, besides its own definition and two unrelated comments about forge's orchestrator.md", () => {
  // This is the fact T008's removal acts on: `orchestrator` exists in the slot
  // surface but nothing consumes it. Documented here so the removal's delta is
  // visible, not inferred.
  const files = [...tsFiles(join(REPO_ROOT, "src")), ...tsFiles(join(REPO_ROOT, "extensions"))];
  const hits = files.filter((f) => readFileSync(f, "utf8").includes("orchestrator"));
  for (const file of hits) {
    assert.ok(
      /[\\/](slots|manifest|promote)\.ts$|nodd-promote\.ts$/.test(file),
      `unexpected consumer of "orchestrator": ${file}`,
    );
  }
});
