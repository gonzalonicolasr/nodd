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

test("a cwd given as a function is read when the document is written, not when the kernel is made", () => {
  const files = new Map<string, string>();
  let root = "/home";
  const kernel = createKernel({ fs: memoryFs(files), cwd: () => root });
  root = "/repo";
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "s" });
  assert.ok(files.has("/repo/.nodd/demo/feature.md"));
  assert.ok(![...files.keys()].some((path) => path.startsWith("/home/")));
});

function observedKernel(runner: string) {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  let id = 0;
  const tool = (toolName: string, input: Record<string, unknown>, isError = false) => {
    const toolCallId = `k${++id}`;
    kernel.onToolCall({ toolName, toolCallId, input });
    kernel.onToolResult({ toolName, toolCallId, input, isError, content: isError ? "FAIL\nCommand exited with code 1" : "ok" });
  };
  tool("nodd_declare", { intent: "change", route: "tracked", slug: "demo", summary: "s", runner });
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "s", runner });
  kernel.task({ action: "add", id: "T1", title: "t", slug: "demo" });
  tool("write", { path: "/repo/a.ts" });
  return { kernel, tool };
}

test("a mutating bash after the green run makes the evidence stale", () => {
  const { kernel, tool } = observedKernel("npm test");
  tool("bash", { command: "npm test" });
  tool("bash", { command: "sed -i 's/a/b/' src/a.ts" });
  const check = kernel.task({ action: "check", id: "T1", slug: "demo" });
  assert.equal(check.ok, false);
  assert.match(check.text, /before the last write/);
});

test("committing after the green run does not make it stale, and a runner the classifier calls mutating still counts", () => {
  const committed = observedKernel("npm test");
  committed.tool("bash", { command: "npm test" });
  committed.tool("bash", { command: "git add -A && git commit -m 'x'" });
  assert.equal(committed.kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, true);

  const script = observedKernel("python3 manage.py test");
  script.tool("bash", { command: "python3 manage.py test" });
  assert.equal(script.kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, true);
});

test("promotion compares the declared set with what this declaration wrote", () => {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  let id = 0;
  const tool = (toolName: string, input: Record<string, unknown>) => {
    const toolCallId = `p${++id}`;
    kernel.onToolCall({ toolName, toolCallId, input });
    kernel.onToolResult({ toolName, toolCallId, input, isError: false, content: "ok" });
  };
  tool("write", { path: "/repo/old.ts" });
  tool("nodd_declare", { intent: "change", route: "inline", slug: "s", summary: "s", files: ["src/a.ts", "src/b.ts"] });
  tool("write", { path: "/repo/src/a.ts" });
  assert.equal(kernel.checkCall({ toolName: "write", input: { path: "/repo/src/b.ts" } }), null);
  const outside = kernel.checkCall({ toolName: "write", input: { path: "/repo/src/c.ts" } });
  assert.ok(outside && /src\/c\.ts/.test(outside.reason) && outside.reason.startsWith("nodd/promotion"));
});

test("a relative write matches the absolute path it was declared as", () => {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  let id = 0;
  const tool = (toolName: string, input: Record<string, unknown>) => {
    const toolCallId = `r${++id}`;
    kernel.onToolCall({ toolName, toolCallId, input });
    kernel.onToolResult({ toolName, toolCallId, input, isError: false, content: "ok" });
  };
  tool("nodd_declare", { intent: "change", route: "inline", slug: "plan", summary: "s", files: ["/repo/.sdd/x/spec.md", "/repo/.sdd/x/tasks.md"] });
  for (let i = 0; i < 6; i += 1) tool("read", { path: `/repo/src/f${i}.ts` });
  assert.equal(kernel.checkCall({ toolName: "write", input: { path: ".sdd/x/spec.md" } }), null);
  tool("write", { path: ".sdd/x/spec.md" });
  assert.equal(kernel.checkCall({ toolName: "write", input: { path: "./.sdd/x/tasks.md" } }), null);
  const other = kernel.checkCall({ toolName: "write", input: { path: ".sdd/x/notes.md" } });
  assert.ok(other, "an undeclared relative path is still refused");
});

test("a task added without an id gets the next free one, and check without an id is refused", () => {
  const { kernel, doc } = kernelWithHatch({});
  const added = kernel.task({ action: "add", title: "segunda", slug: "demo" } as never);
  assert.equal(added.text, "T2 added to .nodd/demo/feature.md");
  kernel.task({ action: "add", id: "T4", title: "cuarta", slug: "demo" });
  kernel.task({ action: "add", id: "", title: "tercera", slug: "demo" });
  assert.match(kernel.task({ action: "add", title: "quinta", slug: "demo" } as never).text, /^T6 added/);
  assert.match(doc(), /- \[ \] T2\. segunda\n- \[ \] T4\. cuarta\n- \[ \] T5\. tercera\n- \[ \] T6\. quinta/);
  assert.ok(!doc().includes("undefined"));
  const check = kernel.task({ action: "check", slug: "demo" } as never);
  assert.equal(check.ok, false);
  assert.match(check.text, /needs the task id/);
});
