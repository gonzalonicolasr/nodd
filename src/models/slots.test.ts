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

// T008 removed the inert `orchestrator` slot. These three tests pinned it as
// present before the removal (T007); they are rewritten, not deleted, to pin
// its absence now -- the delta the removal produced.
test("CONFIGURABLE_SLOTS no longer includes orchestrator; default, explore, resolve-uncertainty, implement remain", () => {
  assert.deepEqual(
    [...CONFIGURABLE_SLOTS].sort(),
    ["default", "explore", "implement", "resolve-uncertainty"].sort(),
  );
});

test("the slot table no longer shows an orchestrator row", () => {
  const row = SLOT_ROWS.find((r) => r.id === "orchestrator");
  assert.equal(row, undefined, "orchestrator must be gone");
  assert.equal(isConfigurableSlot("orchestrator"), false);
});

test("validateAssignment refuses orchestrator=provider/model, naming what replaced it", () => {
  const groups = groupByProvider([{ provider: "anthropic", id: "claude-opus-4-1" }]);
  const assignment = parseAssignment("orchestrator=anthropic/claude-opus-4-1");
  assert.ok(assignment);
  const result = validateAssignment(assignment!, groups);
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /default/);
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

test("orchestrator is gone as a real slot from every non-test source under src/ and extensions/, save for its explicit refusal in assign.ts and two unrelated comments about forge's orchestrator.md", () => {
  const files = [...tsFiles(join(REPO_ROOT, "src")), ...tsFiles(join(REPO_ROOT, "extensions"))];
  const hits = files.filter((f) => readFileSync(f, "utf8").includes("orchestrator"));
  for (const file of hits) {
    assert.ok(/promote\.ts$|[\\/]assign\.ts$/.test(file), `unexpected consumer of "orchestrator": ${file}`);
  }
});

test("every id in CONFIGURABLE_SLOTS is read by at least one non-test source under src/ or extensions/", () => {
  // Guards against the next inert slot: an id that no consumer reads is a
  // dropdown for a setting nothing uses, exactly what `orchestrator` was.
  const files = [
    ...tsFiles(join(REPO_ROOT, "src")).filter((f) => !f.endsWith(join("models", "slots.ts")) && !f.endsWith("manifest.ts")),
    ...tsFiles(join(REPO_ROOT, "extensions")),
  ];
  const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const slot of CONFIGURABLE_SLOTS) {
    assert.ok(text.includes(slot), `no consumer under src/ or extensions/ reads the "${slot}" slot`);
  }
});
