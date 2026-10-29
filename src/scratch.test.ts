import { test } from "node:test";
import assert from "node:assert/strict";
import { bashWriteTargets, writesOnlyUnder } from "./scratch.ts";

const S = "/tmp/claude-1000/-home-gon/s1/scratchpad";
const inside = (path: string) => path === S || path.startsWith(`${S}/`);

test("writes that land only in the scratchpad are recognised, literal or through a variable", () => {
  for (const command of [
    `mkdir -p ${S}/shots && cat > ${S}/a.sh <<'EOF'\necho hi > out.txt\nEOF`,
    `D=${S}; mkdir -p $D/x && echo hi > "$D/x/n.txt"`,
    `S="${S}"; rm -rf \${S}/old; cp src/a.ts $S/a.ts`,
    `curl -s https://x > ${S}/page.html`,
  ]) assert.equal(writesOnlyUnder(command, inside), true, command);
});

test("anything that may write elsewhere is not exempt", () => {
  for (const command of [
    `mkdir -p ${S}/x && echo hi > out.txt`,
    `mv src/a.ts ${S}/a.ts`,
    `bash ${S}/run.sh`,
    `cp ${S}/a.ts src/a.ts`,
    `D=/home/gon/x; mkdir $D/y`,
    `echo hi`,
    `rm -rf ${S}/../../../home/gon/x`,
    `D=${S}/..; mkdir -p $D/y`,
  ]) assert.equal(writesOnlyUnder(command, inside), false, command);
});

test("in-place edits, modes, sizes and a cd into the scratchpad stay recognised", () => {
  for (const command of [
    `sed -i 's/a/b/' ${S}/f`,
    `chmod +x ${S}/run.sh`,
    `truncate -s 0 ${S}/log`,
    `cd ${S} && echo x > n.txt`,
    `D=/repo; echo x > ${S}/a`,
    `echo x > ${S}//b`,
  ]) assert.equal(writesOnlyUnder(command, inside), true, command);
});

test("a target directory flag, a link to outside, a glob, a cd elsewhere or an unknown writer is not exempt", () => {
  for (const command of [
    `cp -t /repo ${S}/a.txt`,
    `cp --target-directory=/repo ${S}/a.txt`,
    `install -t /repo ${S}/a`,
    `ln -s /repo/a ${S}/link`,
    `echo x > ${S}/l*`,
    `cd /repo && echo x > n.txt`,
    `npm install > ${S}/log`,
    `env rm -rf /repo/x`,
    `echo x > n.txt`,
  ]) assert.equal(writesOnlyUnder(command, inside), false, command);
});

test("an append redirect names the file being appended to", () => {
  // The operator is its own token once quotes are gone, so the destination is
  // the next word — not the operator's own second character. Reading it the
  // other way made every `cmd >> f` look like a write to a file called `>`,
  // which then counted as an undeclared file and invalidated the green run.
  const seen: string[] = [];
  assert.equal(writesOnlyUnder(`echo x >> ${S}/log`, inside, (path) => seen.push(path)), true);
  assert.deepEqual(seen, [`${S}/log`]);
  assert.deepEqual(bashWriteTargets("echo x >> src/a.ts", "/repo"), ["/repo/src/a.ts"]);
  assert.deepEqual(bashWriteTargets("echo x >>src/a.ts", "/repo"), ["/repo/src/a.ts"]);
  assert.deepEqual(bashWriteTargets("npm test > out.txt 2>&1", "/repo"), ["/repo/out.txt"]);
});

test("an append outside the scratchpad is not exempt", () => {
  for (const command of [`echo x >> /repo/a.txt`, `echo x >> n.txt`, `cat a >> /repo/b`]) {
    assert.equal(writesOnlyUnder(command, inside), false, command);
  }
  // A descriptor duplication is not a file either way.
  assert.deepEqual(bashWriteTargets("npm test 2>&1", "/repo"), []);
  assert.deepEqual(bashWriteTargets("echo x >&2", "/repo"), []);
});

test("only real write targets are reported, not the values of assignments", () => {
  const seen: string[] = [];
  assert.equal(writesOnlyUnder(`D=/repo; echo x > ${S}/a`, inside, (path) => seen.push(path)), true);
  assert.deepEqual(seen, [`${S}/a`]);
});
