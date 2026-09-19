import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOutcome, isSuccess, type Outcome } from "./outcome.ts";

test("isError false is success by construction — pi's bash throws on any non-zero code", () => {
  assert.deepEqual(parseOutcome(false, "anything at all"), { kind: "success" });
  assert.deepEqual(parseOutcome(false, ""), { kind: "success" });
});

const TABLE: Array<[string, Outcome]> = [
  ["Command exited with code 1", { kind: "exit", code: 1 }],
  ["Command exited with code 137", { kind: "exit", code: 137 }],
  ["Command exited with code 0", { kind: "exit", code: 0 }],
  ["Command aborted", { kind: "aborted" }],
  ["Command timed out after 120 seconds", { kind: "timeout", seconds: 120 }],
  ["Command timed out after 5 seconds", { kind: "timeout", seconds: 5 }],
];

test("the five outcomes parse from the last line appended by bash.js:321", () => {
  for (const [line, expected] of TABLE) {
    assert.deepEqual(parseOutcome(true, line), expected, `"${line}"`);
  }
});

test("a non-matching error text is unknown, never success", () => {
  for (const text of ["", "ENOENT: no such file", "killed", "Command exited with code abc"]) {
    const outcome = parseOutcome(true, text);
    assert.equal(outcome.kind, "unknown", `"${text}" must be unknown`);
    assert.equal(isSuccess(outcome), false, "unknown must never count as success");
  }
});

// The marker is the *last* line pi appends. Text that merely mentions it is
// stdout, and stdout is the model's playground: a test runner printing
// "Command exited with code 1" in its own output must not be able to change
// how its own run is recorded.
test("the marker is only read from the last non-empty line", () => {
  const stdout = "running suite\nCommand exited with code 1\nall good\n";
  assert.deepEqual(parseOutcome(false, stdout), { kind: "success" },
    "a successful run whose stdout quotes the marker is still success");

  assert.deepEqual(parseOutcome(true, `${stdout}Command exited with code 2`), { kind: "exit", code: 2 },
    "the real last line wins over an earlier quoted one");

  assert.deepEqual(parseOutcome(true, "Command aborted\n\n  \n"), { kind: "aborted" },
    "trailing blank lines are skipped");
});

test("isSuccess is true for success alone", () => {
  assert.equal(isSuccess({ kind: "success" }), true);
  for (const outcome of [
    { kind: "exit", code: 0 }, { kind: "exit", code: 1 },
    { kind: "aborted" }, { kind: "timeout", seconds: 1 }, { kind: "unknown" },
  ] as Outcome[]) {
    assert.equal(isSuccess(outcome), false, `${outcome.kind} is not success`);
  }
});

// Three distinct failure modes collapsed into one boolean is how "the tests
// pass" gets written after a timeout. The union has no room for that field.
test("no boolean verdict field exists on any outcome", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "outcome.ts"), "utf8");
  const type = src.slice(src.indexOf("export type Outcome"), src.indexOf(";", src.indexOf("export type Outcome")));
  for (const field of ["ok", "passed", "success:", "failed"]) {
    assert.ok(!type.includes(field), `the Outcome union must not carry "${field}"`);
  }
  for (const outcome of TABLE.map(([, o]) => o)) {
    for (const field of ["ok", "passed", "success", "failed"]) {
      assert.ok(!(field in outcome), `${outcome.kind} must not carry "${field}"`);
    }
  }
});
