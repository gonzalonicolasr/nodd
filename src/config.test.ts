import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, mergeConfig, noddConfigPath, parseConfig } from "./config.ts";

test("the config path is ~/.pi/nodd.json and nothing else", () => {
  assert.equal(noddConfigPath(), join(homedir(), ".pi", "nodd.json"));
});

test("absent, empty and malformed input all degrade to defaults", () => {
  for (const input of [undefined, "", "   ", "{{{", "[]", "null"]) {
    const parsed = parseConfig(input);
    assert.deepEqual(parsed.config, DEFAULT_CONFIG, `input ${JSON.stringify(input)}`);
  }
  assert.deepEqual(parseConfig(undefined).defects, []);
  assert.equal(parseConfig("{{{").defects.length, 1);
});

test("a partial config keeps its own values and fills the rest", () => {
  const { config, defects } = parseConfig(JSON.stringify({ models: { implement: "a/b" } }));
  assert.deepEqual(defects, []);
  assert.equal(config.models.implement, "a/b");
  assert.deepEqual(config.profiles, {});
  assert.equal(config.activeProfile, null);
});

test("merge preserves an unknown key byte-for-byte", () => {
  const existing = { keepMe: { deep: [1, "two", { three: true }] }, models: { implement: "a/b" } };
  const merged = mergeConfig(existing, { models: { implement: "c/d" } });
  assert.deepEqual(merged.keepMe, existing.keepMe);
  assert.equal(JSON.stringify(merged.keepMe), JSON.stringify(existing.keepMe));
  assert.deepEqual(merged.models, { implement: "c/d" });
});

test("merge writes only the named section", () => {
  const merged = mergeConfig({ models: { implement: "a/b" } }, { gates: { track: { enabled: false } } });
  assert.deepEqual(merged.models, { implement: "a/b" });
  assert.deepEqual(merged.gates, { track: { enabled: false } });
});

// `/nodd-gates` writes through this merge, so a section it does not know about
// has to survive it. Thinking levels are exactly that section: dropping them on
// an unrelated gate toggle would silently reset every slot's effort.
test("merge preserves thinking levels it was not asked to touch", () => {
  const merged = mergeConfig(
    { models: { implement: "a/b" }, thinking: { implement: "high" } },
    { gates: { track: { enabled: false } } },
  );
  assert.deepEqual(merged.thinking, { implement: "high" });
});

test("no NODD source file mentions zero.json", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  // Assembled at runtime so this assertion does not match its own source.
  const forbidden = `zero${"."}json`;
  for (const file of [...walk(join(root, "src")), ...walk(join(root, "extensions"))]) {
    if (file.endsWith("config.test.ts")) continue;
    assert.ok(!readFileSync(file, "utf8").includes(forbidden), `${file} mentions forge's config file`);
  }
});
