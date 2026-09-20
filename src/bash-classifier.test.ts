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

// ---------------------------------------------------------------------------
// Three defects the round-1 veredicto found in the interpreter row.
// ---------------------------------------------------------------------------

test("the flag guard is pinned: a flag's own argument is not the script", () => {
  // `(?!-)` is the guard the fix is built on — without it the gate would refuse
  // this project's own test command. The mutation survived all 72 table rows,
  // because every case used a flag with no path after it. These have one.
  assert.equal(classifyBash("node --import=./reg.mjs app.js"), "non-mutating");
  assert.equal(classifyBash("node --loader=ts-node/esm x.ts"), "non-mutating");
});

test("an interpreter reached through its run subcommand is still an interpreter", () => {
  // `deno run main.ts` and `bun run build.ts` are the only real way to execute
  // a file with those two runtimes — `deno main.ts` is not valid CLI. The row
  // named deno and bun while catching neither, so the published table listed
  // coverage that did not exist.
  assert.equal(classifyBash("deno run main.ts"), "mutating");
  assert.equal(classifyBash("bun run build.ts"), "mutating");
  assert.equal(classifyBash("deno run --allow-write main.ts"), "mutating");
  // The subcommand alone is not a file.
  assert.equal(classifyBash("deno task build"), "non-mutating");
  assert.equal(classifyBash("bun test"), "non-mutating");
});

test("an interpreter named inside quoted data is data, not a command", () => {
  // `redirectsToFile` already strips quotes for exactly this reason (see the note at
  // the top of this file: "a `>` inside quotes is data"). The interpreter row
  // did not, so grepping for a command string was refused as a write — which
  // happened three times to the reviewer who found it.
  assert.equal(classifyBash("grep -rn ';python3 gen.py' src"), "non-mutating");
  assert.equal(classifyBash('rg "&& node cli.js" docs'), "non-mutating");
  assert.equal(classifyBash("git log --grep=';python3 a.py'"), "non-mutating");
});

test("quoting the script name does not hide the write", () => {
  // Quoting an argument is ordinary shell practice, including when the path
  // has a space in it. "Add quotes" must never be the cheapest evasion.
  assert.equal(classifyBash('bash "script.sh"'), "mutating");
  assert.equal(classifyBash("node 'app.js'"), "mutating");
  assert.equal(classifyBash('python3 "gen.py"'), "mutating");
  assert.equal(classifyBash('bash "./install.sh"'), "mutating");
  assert.equal(classifyBash("deno run 'main.ts'"), "mutating");
  assert.equal(classifyBash('bash "my script.sh"'), "mutating");
  assert.equal(classifyBash('node "/home/a b/app.js"'), "mutating");
  assert.equal(classifyBash("sudo bash '/opt/My App/install.sh'"), "mutating");
});

test("an interpreter named inside an argument of another command is data", () => {
  // What separates a needle from a script is *position*, not content: the
  // interpreter has to be the command word. A quoted token with a space is
  // simultaneously the shape of a grep pattern and the shape of a real path,
  // so content cannot tell them apart — round 2 tried and broke both halves.
  assert.equal(classifyBash("grep -rn ';python3 gen.py' src"), "non-mutating");
  assert.equal(classifyBash('rg "&& node cli.js" docs'), "non-mutating");
  assert.equal(classifyBash("git log --grep=';python3 a.py'"), "non-mutating");
  assert.equal(classifyBash("grep -rn ';node' src/lib"), "non-mutating");
  assert.equal(classifyBash("grep -rn '|node' src/"), "non-mutating");
  assert.equal(classifyBash('rg "&&node" docs/'), "non-mutating");
  assert.equal(classifyBash("grep ';sh' /etc/shells"), "non-mutating");
});

test("the not-covered list does not deny coverage the classifier has", () => {
  // The drift test compares README text against code text, never against
  // behaviour, so NOT_COVERED once published "a script that follows a flag is
  // not covered" while `deno run --allow-write main.ts` classified as a write.
  // Naming coverage that does not exist and denying coverage that does are the
  // same defect; only this direction was unguarded.
  const denied = NOT_COVERED.join(" ");
  for (const example of denied.match(/`([^`]+)`/g) ?? []) {
    const command = example.slice(1, -1);
    // Entries name shapes as well as commands; only run the ones that look
    // like a command, and skip anything the list marks as *covered* in an aside.
    if (!/^[a-z.\/]/.test(command) || command.includes("…")) continue;
    if (denied.includes(`covered: \`${command}\``)) continue;
    assert.equal(
      classifyBash(command),
      "non-mutating",
      `NOT_COVERED says "${command}" is not covered, but the classifier treats it as a write`,
    );
  }
});

test("a wrapper or a subshell does not hide the interpreter", () => {
  // The cheapest evasions once a bare `node x.js` is refused, in the order a
  // model would try them. A prefix that runs its argument is transparent, and
  // a subshell opens a command just as `;` does.
  assert.equal(classifyBash("(node x.js)"), "mutating");
  assert.equal(classifyBash("$(node build.js)"), "mutating");
  assert.equal(classifyBash("nohup node x.js &"), "mutating");
  assert.equal(classifyBash("env node x.js"), "mutating");
  assert.equal(classifyBash("time node x.js"), "mutating");
  assert.equal(classifyBash("env FOO=1 node x.js"), "mutating");
  // The wrapper alone is not a write, and the prefix rule must not leak.
  assert.equal(classifyBash("env"), "non-mutating");
  assert.equal(classifyBash("time npm test"), "non-mutating");
  assert.equal(classifyBash("grep '(node x.js)' src"), "non-mutating");
});

test("an interpreter reached by path, or behind one more wrapper, still counts", () => {
  // `/usr/bin/env node` is the most idiomatic interpreter invocation there is,
  // and `timeout N …` is this project's own test idiom. Both evaded on the
  // first try, which is the only standard that matters for a denylist.
  assert.equal(classifyBash("/usr/bin/env node x.js"), "mutating");
  assert.equal(classifyBash("/usr/bin/node x.js"), "mutating");
  assert.equal(classifyBash("/usr/local/bin/python3 gen.py"), "mutating");
  assert.equal(classifyBash("timeout 10 node x.js"), "mutating");
  assert.equal(classifyBash("exec node x.js"), "mutating");
  assert.equal(classifyBash("setsid node x.js"), "mutating");
  assert.equal(classifyBash("node -- x.js"), "mutating");
  assert.equal(classifyBash("bash script\\ name.sh"), "mutating");
  // The path rule must not swallow a command that merely lives in /usr/bin.
  assert.equal(classifyBash("/usr/bin/grep -rn x src"), "non-mutating");
  assert.equal(classifyBash("/bin/ls -la"), "non-mutating");
  assert.equal(classifyBash("timeout 10 npm test"), "non-mutating");
});

test("a script named without an extension is still a script", () => {
  // The slash branch of SCRIPT_FILE is load-bearing and was unpinned: deleting
  // it left the suite green while `bash /usr/local/bin/setup` stopped being a
  // write. Plenty of real scripts carry no extension at all.
  assert.equal(classifyBash("bash /usr/local/bin/setup"), "mutating");
  assert.equal(classifyBash("sh /opt/app/run"), "mutating");
  assert.equal(classifyBash("node ./bin/cli"), "mutating");
  assert.equal(classifyBash("python3 /srv/tools/migrate"), "mutating");
});

test("a newline separates commands, like every other separator", () => {
  // The tenth evasion, and the only one that fires by accident: a multi-line
  // bash block is the ordinary shape of agent work, and the second line was
  // invisible. This is not adversarial — a model writing two lines evaded
  // without trying.
  assert.equal(classifyBash("ls\nnode build.js"), "mutating");
  assert.equal(classifyBash("cd src\nbash install.sh"), "mutating");
  assert.equal(classifyBash("set -e\npython3 migrate.py"), "mutating");
  // The same blind spot degraded every pre-existing row, not just the new one.
  assert.equal(classifyBash("ls\nrm -rf build"), "mutating");
  assert.equal(classifyBash("ls\nchmod +x f"), "mutating");
  assert.equal(classifyBash("ls\necho x > f"), "mutating");
  // A multi-line read is still a read.
  assert.equal(classifyBash("grep -rn x src\nwc -l src/a.ts"), "non-mutating");
  assert.equal(classifyBash("ls -la\ngit log --oneline"), "non-mutating");
});

test("a control-flow body is a place a command can hide", () => {
  assert.equal(classifyBash("if true; then node x.js; fi"), "mutating");
  assert.equal(classifyBash("for f in a b; do node x.js; done"), "mutating");
  assert.equal(classifyBash("ls && { node x.js; }"), "mutating");
  assert.equal(classifyBash("while read l; do rm $l; done"), "mutating");
  // The keywords alone are not writes.
  assert.equal(classifyBash("if true; then ls; fi"), "non-mutating");
});

test("a covered word inside quoted data does not make a read a write", () => {
  // Adding \n ( { then do as separators widened commandWord's quote-blind
  // surface into ordinary prose: searching for the word "install" became a
  // write. This file says twice that a gate refusing reads is a gate people
  // turn off, and these are the commands a person runs while reading a repo.
  assert.equal(classifyBash("grep -rn '(install)' README.md"), "non-mutating");
  assert.equal(classifyBash("grep -rn 'then install' docs/"), "non-mutating");
  assert.equal(classifyBash("jq '{install}' package.json"), "non-mutating");
  assert.equal(classifyBash("git log --grep='then install the deps'"), "non-mutating");
  assert.equal(classifyBash("rg 'do cp' docs/"), "non-mutating");
  assert.equal(classifyBash("grep -n 'then mkdir -p' Makefile"), "non-mutating");
  assert.equal(classifyBash("echo 'build, then install, then test'"), "non-mutating");
});

test("a subshell or a brace group is a place a write can hide", () => {
  // Mutation found `(` and `{` load-bearing in commandWord and pinned by
  // nothing: removing them left all 578 tests green while these four escaped.
  assert.equal(classifyBash("(rm -rf build)"), "mutating");
  assert.equal(classifyBash("{ rm -rf build; }"), "mutating");
  assert.equal(classifyBash("ls && { chmod +x f; }"), "mutating");
  assert.equal(classifyBash("ls | ( tee out.txt )"), "mutating");
});

test("a heredoc body is data, like a quoted string", () => {
  // Reported by three separate reviewers, who each hit it while reading this
  // repo: a heredoc carrying an arrow function or a comparison was refused as
  // a write. Quoted data has been excluded since the beginning; a heredoc is
  // the same thing with different syntax.
  assert.equal(classifyBash("cat <<'EOF'\nconst f = (a) => a + 1;\nEOF"), "non-mutating");
  assert.equal(classifyBash("cat <<'PY'\nprint(1 > 0)\nPY"), "non-mutating");
  assert.equal(classifyBash("cat <<EOF\n# then install the deps\nEOF"), "non-mutating");
  // The command around the heredoc is still read normally.
  assert.equal(classifyBash("cat <<'EOF' > out.txt\nhello\nEOF"), "mutating");
  assert.equal(classifyBash("cat <<'EOF'\nx\nEOF\nrm -rf build"), "mutating");
  // The terminator line itself is kept, so what follows is read as commands
  // rather than swallowed with the body.
  assert.equal(classifyBash("cat <<'EOF'\nx\nEOF\nls"), "non-mutating");
  assert.equal(classifyBash("cat <<'EOF'\ndata\nEOF\nchmod +x f"), "mutating");
});

test("a comment is not a command", () => {
  // The last declared false positive. A `#` comment is the one remaining place
  // where a covered word was read as syntax, and multi-line agent blocks are
  // full of them.
  assert.equal(classifyBash("git log --oneline\n# do rm later"), "non-mutating");
  assert.equal(classifyBash("ls\n# then install the deps"), "non-mutating");
  assert.equal(classifyBash("ls  # rm -rf build"), "non-mutating");
  // A `#` inside a word is not a comment: URLs and filenames survive, and the
  // redirection after one is still a redirection.
  assert.equal(classifyBash("curl http://x/a#b"), "non-mutating");
  assert.equal(classifyBash("echo a#b > f"), "mutating");
  assert.equal(classifyBash("mv a#1.txt b"), "mutating");
  assert.equal(classifyBash("rm -rf build  # cleanup"), "mutating");
  assert.equal(classifyBash("ls\nrm -rf build  # cleanup"), "mutating");
});

test("a heredoc fed to an interpreter is a script, not data", () => {
  // Blanking heredoc bodies stops a read being refused, but the body stops
  // being data the moment something executes it. `cat <<EOF | bash` and
  // `bash <<EOF` are how a shell block smuggles a script inline, and they were
  // the cost of the previous fix.
  assert.equal(classifyBash("cat <<'EOF' | bash\nrm -rf build\nEOF"), "mutating");
  assert.equal(classifyBash("bash <<'EOF'\nrm -rf /\nEOF"), "mutating");
  assert.equal(classifyBash("cat <<'EOF' | sh\nchmod +x f\nEOF"), "mutating");
  // One extra word must not hide the body. `feedsAnInterpreter` walks the same
  // WRAPPERS set the rest of the file already uses; recognising the
  // interpreter only as a bare token made `sudo` a one-word evasion.
  assert.equal(classifyBash("sudo bash <<'EOF'\nrm -rf build\nEOF"), "mutating");
  assert.equal(classifyBash("cat <<'EOF' | sudo bash\nrm -rf build\nEOF"), "mutating");
  assert.equal(classifyBash("cat <<'EOF' | env bash\nrm -rf build\nEOF"), "mutating");
  assert.equal(classifyBash("cat <<'EOF' | timeout 5 bash\nrm -rf build\nEOF"), "mutating");
  assert.equal(classifyBash("cat <<'EOF' | /usr/bin/env bash\nrm -rf build\nEOF"), "mutating");
  // A heredoc opened inside a loop or a conditional is still executed.
  assert.equal(classifyBash("for f in a; do bash <<'EOF'\nrm -rf build\nEOF\ndone"), "mutating");
  assert.equal(classifyBash("if true; then bash <<'EOF'\nrm -rf build\nEOF\nfi"), "mutating");
  assert.equal(classifyBash("while read l; do sh <<'EOF'\nrm -rf build\nEOF\ndone"), "mutating");
  // A full-path interpreter behind a wrapper: recognised by basename.
  assert.equal(classifyBash("sudo /bin/bash <<'EOF'\nrm -rf build\nEOF"), "mutating");
  assert.equal(classifyBash("env /usr/bin/python3 <<'PY'\nrm -rf build\nPY"), "mutating");
  // A pipe into something that only reads is still a read.
  assert.equal(classifyBash("cat <<'EOF' | grep x\na > b\nEOF"), "non-mutating");
  // A wrapper's own long flags go with it, but its argument run is bounded:
  // one step past a flag lands on the flag's value, which names a command
  // instead of running one.
  assert.equal(classifyBash("timeout --preserve-status 5 bash <<'EOF'\nrm -rf build\nEOF"), "mutating");
  // A flag's value is not the command word: `command -v bash` asks where bash
  // is, it does not run it, so the heredoc after it is documentation.
  assert.equal(classifyBash("command -v node && cat <<'EOF'\nnpm install foo\nEOF"), "non-mutating");
  assert.equal(classifyBash("command -v bash && cat <<'EOF'\nrm -rf build\nEOF"), "non-mutating");
  // The interpreter has to be a command word, not a word in someone's argument.
  assert.equal(classifyBash("grep -rn bash src <<'EOF'\nrm -rf build\nEOF"), "non-mutating");
  assert.equal(classifyBash("echo bash <<'EOF'\nrm -rf build\nEOF"), "non-mutating");
  assert.equal(classifyBash("cat <<'EOF' | sudo tee\nplain data\nEOF"), "mutating");
  assert.equal(classifyBash("python3 <<'PY'\nrm -rf build\nPY"), "mutating");
  // An unterminated heredoc must not swallow the commands after it.
  assert.equal(classifyBash("cat <<'EOF'\nx\nNOPE\nrm -rf build"), "mutating");
  // A heredoc that only carries data is still a read.
  assert.equal(classifyBash("cat <<'EOF'\nconst f = (a) => a + 1;\nEOF"), "non-mutating");
  assert.equal(classifyBash("cat <<'PY'\nprint(1 > 0)\nPY"), "non-mutating");
});
