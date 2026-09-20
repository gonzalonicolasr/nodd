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
  // --- mutating: an interpreter running a script file as its first argument ---
  ["node script.js", "mutating"],
  ["python3 file.py", "mutating"],
  ["bash script.sh", "mutating"],
  ["sh ./run.sh", "mutating"],
  ["node ./bin/cli.mjs", "mutating"],
  ["python3 manage.py migrate", "mutating"],
  ["ruby rakefile.rb", "mutating"],
  ["perl script.pl", "mutating"],
  ["sudo bash install.sh", "mutating"],
  ["ls && node build.js", "mutating"],

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
  // --- non-mutating: the interpreter row must not reach these ---
  ["node --test --experimental-strip-types", "non-mutating"],
  ["node --test test/parity-matrix.test.ts", "non-mutating"],
  ["node --version", "non-mutating"],
  ["python3 -m pytest", "non-mutating"],
  ["python3 -m http.server", "non-mutating"],
  ["bash -lc 'grep x'", "non-mutating"],
  ["bun test", "non-mutating"],
  ["deno task build", "non-mutating"],
  ["shellcheck script.sh", "non-mutating"],
  ["nodemon server.js", "non-mutating"],
  ["python3-config --includes", "non-mutating"],
  ["cat gen.py | python3", "non-mutating"],
  ["./run.sh", "non-mutating"],
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

// ---------------------------------------------------------------------------
// /dev/null is a sink, not a file. Treating a redirect into it as a workspace
// write blocked `grep … 2>/dev/null` and `cat … 2>/dev/null` — pure reads —
// four times in one session, on the author's own repo.
// ---------------------------------------------------------------------------
test("discarding stderr is not a write", () => {
  assert.equal(classifyBash("grep -rn foo src 2>/dev/null"), "non-mutating");
  assert.equal(classifyBash("cat ~/.config/app.json 2>/dev/null"), "non-mutating");
});

test("discarding stdout is not a write either", () => {
  assert.equal(classifyBash("ls -la > /dev/null"), "non-mutating");
  assert.equal(classifyBash("command -v node >/dev/null 2>&1"), "non-mutating");
});

test("the other standard sinks are not files", () => {
  assert.equal(classifyBash("echo hi > /dev/stdout"), "non-mutating");
  assert.equal(classifyBash("echo hi > /dev/stderr"), "non-mutating");
});

test("a real file is still a write, even beside a sink", () => {
  // The fix must not become a hole: a command that discards stderr *and*
  // writes a file is still a write.
  assert.equal(classifyBash("build 2>/dev/null > out.txt"), "mutating");
  assert.equal(classifyBash("echo hi > f.txt 2>/dev/null"), "mutating");
});

test("a mutating command is still caught when its output is discarded", () => {
  assert.equal(classifyBash("rm -rf build > /dev/null 2>&1"), "mutating");
});

// ---------------------------------------------------------------------------
// The script has to be the interpreter's *first* argument. Scanning past flags
// to find it would classify this repository's own way of running one test file
// — `node --test test/parity-matrix.test.ts` — as a write, and the gate would
// refuse the suite it exists to protect.
// ---------------------------------------------------------------------------
test("a flag is not a script file: the interpreter row stops at the first argument", () => {
  assert.equal(classifyBash("node --test test/parity-matrix.test.ts"), "non-mutating");
  assert.equal(classifyBash("node --experimental-strip-types src/bash-classifier.test.ts"), "non-mutating");
  assert.equal(classifyBash("bash -lc 'grep x'"), "non-mutating");
});

test("a command that merely contains an interpreter's name is not an interpreter", () => {
  assert.equal(classifyBash("shellcheck script.sh"), "non-mutating");
  assert.equal(classifyBash("nodemon server.js"), "non-mutating");
  assert.equal(classifyBash("python3-config --includes"), "non-mutating");
});
