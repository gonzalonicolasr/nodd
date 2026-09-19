// T001 — the package manifest is a contract, so it is asserted like one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("package.json is an ESM pi package", () => {
  assert.equal(pkg.type, "module");
  assert.ok(pkg.keywords.includes("pi-package"), "keywords must carry pi-package");
  assert.equal(pkg.scripts.test, "node --test --experimental-strip-types");
});

test("pi.extensions is non-empty and every listed path exists", () => {
  assert.ok(Array.isArray(pkg.pi?.extensions), "pi.extensions must be an array");
  assert.ok(pkg.pi.extensions.length > 0, "pi.extensions must not be empty");
  for (const rel of pkg.pi.extensions) {
    assert.ok(existsSync(join(root, rel)), `missing extension entrypoint: ${rel}`);
  }
});

test("pi is a peer dependency only", () => {
  assert.ok(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"], "pi must be a peerDependency");
  assert.equal(pkg.dependencies, undefined, "the package ships no runtime dependencies");
});

// The scan covers every code and manifest file NODD ships. Prose files are
// excluded on purpose: README.md must be free to *explain* the rule, and a test
// that forbade naming the package would make the honest documentation
// impossible to write.
const SCANNED_DIRS = ["src", "extensions", "test", "spike"];

function codeFiles(): string[] {
  const out: string[] = [join(root, "package.json")];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  for (const dir of SCANNED_DIRS) walk(join(root, dir));
  return out;
}

test("no code file names the TUI package, not even as a type import", () => {
  const forbidden = ["pi", "tui"].join("-");
  for (const file of codeFiles()) {
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes(`@earendil-works/${forbidden}`), `${file} references the TUI package`);
  }
});

test("no code file imports pi outside extensions/", () => {
  // Assembled at runtime so this assertion does not match its own source.
  const piSpecifier = `@earendil-works/${["pi", "coding", "agent"].join("-")}`;
  for (const file of codeFiles()) {
    if (file.startsWith(join(root, "extensions"))) continue;
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes(`from "${piSpecifier}"`), `${file} imports pi outside extensions/`);
  }
});
