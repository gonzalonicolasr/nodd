import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDoc, parseFeatureDoc, renderFeatureDoc } from "./feature-doc.ts";
import {
  GENERATED_PATHS,
  countAuthoredLines,
  crossedForecast,
  defaultDelivery,
  isChain,
  isStrategy,
  type Delivery,
} from "./delivery.ts";

const full: Delivery = {
  strategy: "auto-chain",
  chain: "feature-branch-chain",
  forecast: 400,
  running: 612,
  boundaries: [
    { base: "origin/main", head: "1a2b3c4" },
    { base: "1a2b3c4", head: "5d6e7f8" },
  ],
};

test("the Delivery section round-trips with all five fields", () => {
  const doc = emptyDoc({ slug: "demo", title: "Demo" });
  doc.delivery = full;

  const parsed = parseFeatureDoc(renderFeatureDoc(doc));
  assert.deepEqual(parsed.defects, []);
  assert.deepEqual(parsed.doc.delivery, full);
});

test("an unknown running count round-trips as unknown, never as a number", () => {
  const doc = emptyDoc({ slug: "demo", title: "Demo" });
  doc.delivery = { ...defaultDelivery(), running: "unknown" };
  const parsed = parseFeatureDoc(renderFeatureDoc(doc));
  assert.equal(parsed.doc.delivery.running, "unknown");
});

test("the default strategy is ask-on-risk and both choices are cached in the doc", () => {
  const delivery = defaultDelivery();
  assert.equal(delivery.strategy, "ask-on-risk");
  assert.equal(delivery.chain, "stacked-to-main");
  assert.deepEqual(delivery.boundaries, []);
});

test("invalid strategy and chain values are rejected", () => {
  for (const good of ["ask-on-risk", "auto-chain", "single-pr", "exception-ok"]) {
    assert.equal(isStrategy(good), true, good);
  }
  for (const bad of ["yolo", "", "ASK-ON-RISK", "ask on risk"]) {
    assert.equal(isStrategy(bad), false, bad);
  }
  assert.equal(isChain("stacked-to-main"), true);
  assert.equal(isChain("feature-branch-chain"), true);
  assert.equal(isChain("octopus"), false);
});

// ---------------------------------------------------------------------------
// The running count is measured from observed git output, never estimated.
// ---------------------------------------------------------------------------
test("a normal diffstat counts additions plus deletions", () => {
  const output = [
    " src/a.ts     | 10 ++++++++--",
    " src/b.ts     |  4 ++++",
    " 2 files changed, 12 insertions(+), 2 deletions(-)",
  ].join("\n");
  assert.equal(countAuthoredLines(output), 14);
});

test("generated paths are excluded from the count", () => {
  const output = [
    " src/a.ts          | 10 ++++++++--",
    " package-lock.json | 900 +++++++++++++++++",
    " dist/bundle.js    | 500 +++++++++++",
    " 3 files changed, 1408 insertions(+), 2 deletions(-)",
  ].join("\n");
  // Only src/a.ts survives the exclusion list: 8 added + 2 removed.
  assert.equal(countAuthoredLines(output), 10);
  assert.ok(GENERATED_PATHS.length > 0, "the exclusion list is documented, not implicit");
});

test("unparseable output leaves the count unknown, never guessed", () => {
  assert.equal(countAuthoredLines("fatal: not a git repository"), "unknown");
  assert.equal(countAuthoredLines(""), "unknown");
  assert.equal(countAuthoredLines("everything is fine"), "unknown");
});

test("a diffstat of only generated files counts zero authored lines, not unknown", () => {
  const output = [
    " package-lock.json | 900 +++++++++++++++++",
    " 1 file changed, 900 insertions(+)",
  ].join("\n");
  assert.equal(countAuthoredLines(output), 0, "parsed and measured as zero authored: that is a measurement");
});

// ---------------------------------------------------------------------------
// The crossing NEVER blocks. `routing.go:95` calls the figure a planning
// heuristic; turning it into a gate would violate the clause it comes from.
// ---------------------------------------------------------------------------
test("crossing the forecast is reported for the prompt and is not a decision", () => {
  assert.equal(crossedForecast({ ...full, running: 612, forecast: 400 }), true);
  assert.equal(crossedForecast({ ...full, running: 120, forecast: 400 }), false);
  assert.equal(crossedForecast({ ...full, running: "unknown" }), false, "unknown never claims a crossing");
});

test("a write at 600 running lines is allowed: no gate consults a line count", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const gateFiles = readdirSync(join(root, "gates")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(gateFiles.length >= 6, "the scan must actually cover the gates");

  for (const file of gateFiles) {
    const source = readFileSync(join(root, "gates", file), "utf8");
    assert.ok(!/from "\.\.\/delivery\.ts"/.test(source), `${file} must not import the delivery module`);
    // The structural guarantee: no gate can reach a count, a size or a
    // forecast, so the heuristic cannot become a block by accident.
    assert.ok(
      !/countAuthoredLines|crossedForecast|\.running\b|\bforecast\b|lineCount|byteSize/.test(source),
      `${file} must not read a line count`,
    );
  }
});

// ---------------------------------------------------------------------------
// Execution is out of scope: `/zero-branch` and `/zero-pr` already do it.
// ---------------------------------------------------------------------------
test("no NODD code path pushes, opens a PR or merges", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) walk(fullPath);
      else if (fullPath.endsWith(".ts")) files.push(fullPath);
    }
  };
  walk(join(root, "src"));
  walk(join(root, "extensions"));

  const forbidden = [/git\s+push/, /gh\s+pr\s+create/, /git\s+merge/];
  for (const file of files) {
    // Comments may name what NODD refuses to do; executable lines may not.
    const code = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(code), `${file} must not invoke ${pattern}`);
    }
  }
});
