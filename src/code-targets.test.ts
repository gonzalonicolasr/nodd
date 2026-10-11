import { test } from "node:test";
import assert from "node:assert/strict";
import { bashChangesCode } from "./code-targets.ts";

const harmless = (path: string) => /^\/tmp\/claude-\d+\/|\/\.claude[^/]*\/(projects|plans|todos|tasks|shell-snapshots)\/|\.(md|txt|log)$/.test(path);
const git = (rest: string) => `git ${rest}`;
const changes = (command: string) => bashChangesCode(command, harmless, "/home/gon");

test("a > inside a string or an arrow is not a redirect", () => {
  assert.equal(changes('echo "worktree -> $(git log --oneline -1)"'), false);
  assert.equal(changes("node -e 'fetch(u).then(r=>r.json()).then(j=>console.log(j))'"), false);
  assert.equal(changes('grep "^>" src/a.ts'), false);
  assert.equal(changes('python3 -c "import json\nprint(1 > 0)\n" > /tmp/r.json'), false);
});

test("writes to /tmp, /dev and harmless extensions behind an unresolved variable are not code", () => {
  assert.equal(changes("curl -s $U > /tmp/req.json"), false);
  assert.equal(changes('rm -f "jx$L.txt"'), false);
  assert.equal(changes("terraform init >/tmp/init-$d.log 2>&1"), false);
});

test("git read commands that share a prefix with a writing one are not code", () => {
  assert.equal(changes(git("merge-tree --write-tree a b")), false);
  assert.equal(changes(git("merge-base --is-ancestor master feature")), false);
  assert.equal(changes(git("merge --no-edit origin/feature")), true);
  assert.equal(changes("git checkout -q -- internal/a.go"), true);
});

test("a worktree under .claude is project code, the memory under .claude is not", () => {
  assert.equal(changes("cd /r/.claude/worktrees/agent-1 && python3 - <<'PY'\nopen('internal/a.go','w').write('x')\nPY"), true);
  assert.equal(changes("cd /home/gon/.claude/projects/x/memory && cat >> notes.json <<'EOF'\n{}\nEOF"), false);
});

test("a quoted redirect target and a subshell cd are resolved", () => {
  assert.equal(changes('S=/tmp/claude-1000/x/scratchpad; go test ./... > "$S/out.json"'), false);
  assert.equal(changes("(cd server && echo x > src/a.js)"), true);
});

test("a python path built from a variable assigned in the same code is resolved", () => {
  assert.equal(changes("python3 - <<'EOF'\nP='/tmp/claude-1000/x/scratchpad/'\nopen(P+'mine.patch','w').write('x')\nEOF"), false);
  assert.equal(changes("python3 - <<'EOF'\nR='/r/src/'\nopen(R+'a.py','w').write('x')\nEOF"), true);
  assert.equal(changes("python3 - <<'EOF'\nimport os\nopen(os.environ['ROOT']+'/a.py','w').write('x')\nEOF"), true);
});
