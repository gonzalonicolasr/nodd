import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBash, COVERED_PATTERNS, NOT_COVERED } from "./bash-classifier.ts";

const CASES: Array<[string, "mutating" | "non-mutating"]> = [
  // --- mutating ---
  ["echo hi > f.txt", "mutating"],
  ["cat a >> b", "mutating"],
  ["ls | tee out.txt", "mutating"],
  ["sed -i 's/a/b/' f.ts", "mutating"],
  ["perl -i -pe 's/x/y/' f.ts", "mutating"],
  ["mv a b", "mutating"],
  ["cp a b", "mutating"],
  ["rm -rf build", "mutating"],
  ["rmdir empty", "mutating"],
  ["ln -s a b", "mutating"],
  ["install -m 755 a /usr/local/bin/a", "mutating"],
  ["dd if=/dev/zero of=f bs=1M count=1", "mutating"],
  ["truncate -s 0 log", "mutating"],
  ["touch newfile", "mutating"],
  ["mkdir -p src/new", "mutating"],
  ["chmod +x run.sh", "mutating"],
  ["chown gon:gon f", "mutating"],
  ["patch -p1 < fix.diff", "mutating"],
  ["git apply fix.patch", "mutating"],
  ["git checkout -- src/a.ts", "mutating"],
  ["git restore src/a.ts", "mutating"],
  ["git reset --hard HEAD", "mutating"],
  ["git commit -m 'x'", "mutating"],
  ["git stash", "mutating"],
  ["git clean -fd", "mutating"],
  ["npm install lodash", "mutating"],
  ["pnpm add -D vitest", "mutating"],
  ["yarn add react", "mutating"],
  ["pip install requests", "mutating"],
  ["cargo add serde", "mutating"],
  ["node -e \"require('fs').writeFileSync('f','x')\"", "mutating"],
  ["python -c \"open('f','w').write('x')\"", "mutating"],
  ["ls && echo x > f", "mutating"],

  // --- non-mutating: the ones a wrong gate would break ---
  ["ls -la", "non-mutating"],
  ["grep -rn 'a>b' src", "non-mutating"],
  ["cmd 2>&1", "non-mutating"],
  ["npm test 2>&1 | tail -5", "non-mutating"],
  ["git status", "non-mutating"],
  ["git log --oneline -5", "non-mutating"],
  ["git diff", "non-mutating"],
  ["git show HEAD", "non-mutating"],
  ["npm test", "non-mutating"],
  ["node --test", "non-mutating"],
  ["cat package.json", "non-mutating"],
  ["find . -name '*.ts'", "non-mutating"],
  ["echo hello", "non-mutating"],
  ["pwd", "non-mutating"],
  ["wc -l src/*.ts", "non-mutating"],
  ["rg 'pattern' --files-with-matches", "non-mutating"],
];

test(`the classifier labels ${CASES.length} commands correctly`, () => {
  for (const [command, expected] of CASES) {
    assert.equal(classifyBash(command), expected, `"${command}" should be ${expected}`);
  }
});

test("the covered pattern list is non-empty and every pattern matches something", () => {
  assert.ok(COVERED_PATTERNS.length > 0);
  for (const entry of COVERED_PATTERNS) {
    assert.ok(entry.label.length > 0, "every covered row carries a label");
    assert.ok(entry.example.length > 0, "every covered row carries an example");
    assert.equal(classifyBash(entry.example), "mutating", `the example "${entry.example}" must classify as mutating`);
  }
});

test("the not-covered list is non-empty and names scripts and indirect writers", () => {
  assert.ok(NOT_COVERED.length > 0);
  const all = NOT_COVERED.join(" ").toLowerCase();
  for (const word of ["script", "make", "compiler", "eval", "background", "outside pi"]) {
    assert.ok(all.includes(word), `the not-covered list must name "${word}"`);
  }
});

const README = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "README.md"), "utf8");

function bashSection(): string {
  const start = README.indexOf("## The bash gate");
  assert.ok(start >= 0, "README must carry a `## The bash gate` section");
  const rest = README.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end < 0 ? rest : rest.slice(0, end);
}

test("every covered row in the README matches the classifier's own pattern list", () => {
  const section = bashSection();
  for (const entry of COVERED_PATTERNS) {
    assert.ok(section.includes(entry.label), `README's covered table is missing "${entry.label}"`);
  }
  for (const item of NOT_COVERED) {
    assert.ok(section.includes(item), `README's not-covered list is missing "${item}"`);
  }
});

// ODD's original sin was claiming compliance while shipping delivery. A
// denylist is a partial mechanism, and the documentation says so in the same
// place it lists what is covered.
test("the bash-gate section claims no guarantee it cannot keep", () => {
  const section = bashSection().toLowerCase();
  for (const word of ["guarantees", "garantiza", "exhaustive", "all writes"]) {
    assert.ok(!section.includes(word), `the bash-gate section must not contain "${word}"`);
  }
});
