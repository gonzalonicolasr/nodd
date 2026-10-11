import { test } from "node:test";
import assert from "node:assert/strict";
import { writesOnlyUnder } from "./scratch.ts";

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
    `sed -i 's/a/b/' ${S}/f`,
    `echo hi`,
    `rm -rf ${S}/../../../home/gon/x`,
    `D=${S}/..; mkdir -p $D/y`,
  ]) assert.equal(writesOnlyUnder(command, inside), false, command);
});
