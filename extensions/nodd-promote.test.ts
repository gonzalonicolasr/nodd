import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, renderFeatureDoc, type FeatureDoc } from "../src/feature-doc.ts";
import register, { runPromote } from "./nodd-promote.ts";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "nodd-promote-"));
}

function sampleDoc(): FeatureDoc {
  return {
    ...emptyDoc({ slug: "cache-warmup", title: "Warm the cache on boot" }),
    objective: "Serve the first request from a warm cache.",
    constraints: "No new dependencies.",
    tasks: [
      {
        id: "T001",
        title: "Read the boot sequence",
        checked: true,
        evidence: { command: "node --test src/boot.test.ts", outcome: "success" },
        candidate: "a1b2c3d",
      },
      { id: "T002", title: "Preload the hot keys", checked: false },
    ],
  };
}

function seedRun(root: string, doc: FeatureDoc = sampleDoc()): string {
  const dir = join(root, ".nodd", doc.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "feature.md"), renderFeatureDoc(doc), "utf8");
  return root;
}

// ---------------------------------------------------------------------------
// Exactly one file
// ---------------------------------------------------------------------------
test("promotion writes requirements.md and nothing else under .sdd/", () => {
  const root = seedRun(workspace());
  const result = runPromote("cache-warmup", root);

  assert.equal(result.ok, true, result.message);
  const sddDir = join(root, ".sdd", "cache-warmup");
  assert.deepEqual(readdirSync(sddDir), ["requirements.md"], "exactly one file");
  assert.ok(!existsSync(join(sddDir, "design.md")), "design.md must be absent so forge resumes at plan");
  assert.ok(!existsSync(join(sddDir, "tasks.md")), "tasks.md must be absent so forge resumes at plan");
});

test("the written requirements carry the objective and the resolved task's evidence", () => {
  const root = seedRun(workspace());
  runPromote("cache-warmup", root);

  const written = readFileSync(join(root, ".sdd", "cache-warmup", "requirements.md"), "utf8");
  assert.ok(written.includes("Serve the first request from a warm cache."));
  assert.ok(written.includes("node --test src/boot.test.ts"));
  assert.match(written, /not be redone/i);
});

// ---------------------------------------------------------------------------
// Never an overwrite
// ---------------------------------------------------------------------------
test("an existing requirements.md is refused, not overwritten", () => {
  const root = seedRun(workspace());
  const target = join(root, ".sdd", "cache-warmup", "requirements.md");
  mkdirSync(join(root, ".sdd", "cache-warmup"), { recursive: true });
  writeFileSync(target, "HAND WRITTEN, DO NOT CLOBBER\n", "utf8");

  const result = runPromote("cache-warmup", root);
  assert.equal(result.ok, false);
  assert.match(result.message, /ya existe|already exists/i);
  assert.equal(readFileSync(target, "utf8"), "HAND WRITTEN, DO NOT CLOBBER\n", "byte-identical after the refusal");
});

test("a missing run is reported, not thrown", () => {
  const root = workspace();
  const result = runPromote("no-such-run", root);
  assert.equal(result.ok, false);
  assert.ok(result.message.includes("no-such-run"));
});

test("an empty slug is refused with usage", () => {
  assert.equal(runPromote("", workspace()).ok, false);
});

// ---------------------------------------------------------------------------
// Forge is optional
// ---------------------------------------------------------------------------
test("with forge absent the artifact is still written and the manual step reported", () => {
  const root = seedRun(workspace());
  const result = runPromote("cache-warmup", root, { forgeAvailable: false });

  assert.equal(result.ok, true);
  assert.ok(existsSync(join(root, ".sdd", "cache-warmup", "requirements.md")), "the artifact is written regardless");
  assert.match(result.message, /forge --continue cache-warmup/, "it names the exact command to run by hand");
});

test("with forge present the message still names the continue command and never runs it", () => {
  const root = seedRun(workspace());
  const result = runPromote("cache-warmup", root, { forgeAvailable: true });
  assert.equal(result.ok, true);
  assert.match(result.message, /forge --continue cache-warmup/);
});

// ---------------------------------------------------------------------------
// REQ: no-sdd-artifacts-off-route
// ---------------------------------------------------------------------------
test("this is the only module in the package that writes under .sdd/", () => {
  const roots = ["../src", "../src/gates", "../src/models", "."];
  const offenders: string[] = [];

  for (const root of roots) {
    const dir = new URL(`${root}/`, import.meta.url);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      if (name === "nodd-promote.ts") continue;
      const source = readFileSync(new URL(name, dir), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      if (source.includes(".sdd")) offenders.push(`${root}/${name}`);
    }
  }

  assert.deepEqual(offenders, [], "only /nodd-promote may write under .sdd/");
});

test("the tracked route leaves .sdd/ untouched across many file writes", () => {
  const root = seedRun(workspace());
  mkdirSync(join(root, ".sdd"), { recursive: true });
  writeFileSync(join(root, ".sdd", "sentinel.md"), "untouched\n", "utf8");

  // A `tracked` run touching ten files: the feature doc is rewritten each time
  // and nothing reaches .sdd/.
  const { writeFeatureDoc } = register;
  for (let i = 0; i < 10; i++) {
    writeFeatureDoc(root, { ...sampleDoc(), objective: `revision ${i}` });
  }

  assert.deepEqual(readdirSync(join(root, ".sdd")), ["sentinel.md"], ".sdd/ gained nothing");
  assert.equal(readFileSync(join(root, ".sdd", "sentinel.md"), "utf8"), "untouched\n");
});

test("the command registers as /nodd-promote", () => {
  const commands = new Map<string, unknown>();
  register({ registerCommand: (name: string, options: unknown) => commands.set(name, options) } as never);
  assert.ok(commands.has("nodd-promote"));
});
