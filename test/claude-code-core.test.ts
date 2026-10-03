import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the Claude Code mod's vendored core matches src/ and imports nothing from node", () => {
  const script = join(root, "claude-code", "sync-core.sh");
  let output = "";
  try {
    output = execFileSync("bash", [script, "--check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const failure = err as { stderr?: string; stdout?: string };
    assert.fail(`claude-code/hooks/core drifted from src/:\n${failure.stderr ?? ""}${failure.stdout ?? ""}`);
  }
  assert.match(output, /al día/);
});
