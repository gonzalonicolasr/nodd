import { test } from "node:test";
import assert from "node:assert/strict";
import { createKernel } from "./kernel.ts";
import type { Fs } from "./io-core.ts";
import type { Policy } from "./gates/policy.ts";

function memoryFs(files = new Map<string, string>()): Fs {
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  return {
    existsSync: (path) => files.has(path),
    readFileSync: (path) => {
      const text = files.get(path);
      if (text === undefined) throw missing(path);
      return text;
    },
    writeFileSync: (path, data) => void files.set(path, data),
    renameSync: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw missing(from);
      files.set(to, text);
      files.delete(from);
    },
    unlinkSync: (path) => void files.delete(path),
    mkdirSync: () => {},
  };
}

function kernelWithHatch(hatches: Policy["hatches"]) {
  const spent: string[] = [];
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo", spendHatch: (gate) => spent.push(gate) });
  kernel.setPolicy({ config: {}, flags: {}, hatches });
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "s", runner: "npm test" });
  kernel.task({ action: "add", id: "T1", title: "t", slug: "demo" });
  return { kernel, spent, doc: () => files.get("/repo/.nodd/demo/feature.md") ?? "" };
}

test("an evidence override checks one task off, says so, and is spent", () => {
  const { kernel, spent, doc } = kernelWithHatch({ evidence: { reason: "ci is down" } });
  const first = kernel.task({ action: "check", id: "T1", slug: "demo" });
  assert.equal(first.ok, true, first.text);
  assert.match(doc(), /- \[x\] T1[\s\S]*observed: `none` → none \(override: ci is down\)/);
  assert.deepEqual(spent, ["evidence"]);
  kernel.task({ action: "add", id: "T2", title: "t", slug: "demo" });
  const second = kernel.task({ action: "check", id: "T2", slug: "demo" });
  assert.equal(second.ok, false);
  assert.match(second.text, /nodd\/evidence/);
});

test("without an override a task with no observed run stays unchecked", () => {
  const { kernel, spent } = kernelWithHatch({});
  assert.equal(kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, false);
  assert.deepEqual(spent, []);
});
