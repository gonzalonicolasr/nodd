import { test } from "node:test";
import assert from "node:assert/strict";
import { createKernel } from "./kernel.ts";
import { parseFeatureDoc } from "./feature-doc.ts";
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

test("a write to a file declared as relative after the green run makes the evidence stale", () => {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  let id = 0;
  const tool = (toolName: string, input: Record<string, unknown>) => {
    const toolCallId = `d${++id}`;
    kernel.onToolCall({ toolName, toolCallId, input });
    kernel.onToolResult({ toolName, toolCallId, input, isError: false, content: "ok" });
  };
  const declaration = { intent: "change", route: "tracked", slug: "demo", summary: "s", runner: "npm test", files: ["src/a.ts"] } as const;
  tool("nodd_declare", declaration);
  kernel.declare(declaration);
  kernel.task({ action: "add", id: "T1", title: "t", slug: "demo" });
  tool("bash", { command: "npm test" });
  tool("write", { path: "src/a.ts" });
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
  const sameName = kernel.checkCall({ toolName: "write", input: { path: "spec.md" } });
  assert.ok(sameName, "a relative path resolves against cwd, not against the tail of a declared file");
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

function session(declaration?: Record<string, unknown>) {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  let id = 0;
  const tool = (toolName: string, input: Record<string, unknown>, isError = false) => {
    const toolCallId = `s${++id}`;
    kernel.onToolCall({ toolName, toolCallId, input });
    kernel.onToolResult({ toolName, toolCallId, input, isError, content: isError ? "FAIL\nCommand exited with code 1" : "ok" });
  };
  if (declaration) {
    tool("nodd_declare", declaration);
    kernel.declare(declaration as never);
  }
  return { kernel, tool, files };
}

test("a slug that is not one plain name is refused and writes nothing", () => {
  const { kernel, files } = session();
  for (const slug of ["../../tmp/x", "a/b", "..", ".hidden"]) {
    const r = kernel.declare({ intent: "change", route: "tracked", slug, summary: "s" });
    assert.equal(r.ok, false, slug);
  }
  assert.deepEqual([...files.keys()], []);
  assert.equal(kernel.declare({ intent: "change", route: "tracked", slug: "audit-2.v1_x", summary: "s" }).ok, true);
});

test("a task title is one line, so it cannot forge a checked task", () => {
  const { kernel, files } = session({ intent: "change", route: "tracked", slug: "demo", summary: "s", runner: "npm test" });
  const r = kernel.task({ action: "add", id: "T1", title: "legit\n- [x] T2. fake\n  - observed: `npm test` → success\n  - candidate: x", slug: "demo" });
  assert.equal(r.ok, false);
  assert.doesNotMatch(files.get("/repo/.nodd/demo/feature.md") ?? "", /T2/);
});

test("a runner run inside another directory is not the runner", () => {
  const { kernel, tool } = session({ intent: "change", route: "tracked", slug: "demo", summary: "s", runner: "npm test" });
  kernel.task({ action: "add", id: "T1", title: "t", slug: "demo" });
  tool("write", { path: "/repo/a.ts" });
  tool("bash", { command: "cd /tmp && npm test" });
  assert.equal(kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, false);
  tool("bash", { command: "cd /repo && npm test" });
  assert.equal(kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, true);
});

test("a declared file covers its own path, not every path that ends the same", () => {
  const { kernel } = session({ intent: "change", route: "inline", slug: "s", summary: "s", files: ["src/a.ts"] });
  assert.equal(kernel.checkCall({ toolName: "write", input: { path: "/repo/src/a.ts" } }), null);
  const other = kernel.checkCall({ toolName: "write", input: { path: "/repo/other/src/a.ts" } });
  assert.ok(other && other.reason.startsWith("nodd/promotion"), other?.reason);
});

test("without a runner, a test script is not its own last write", () => {
  const { kernel, tool } = session({ intent: "change", route: "tracked", slug: "demo", summary: "s" });
  kernel.task({ action: "add", id: "T1", title: "t", slug: "demo" });
  tool("write", { path: "/repo/a.ts" });
  tool("bash", { command: "bash run_tests.sh" });
  const check = kernel.task({ action: "check", id: "T1", slug: "demo" });
  assert.equal(check.ok, true, check.text);
});

test("in strict TDD the RED has to belong to the task being checked", () => {
  const { kernel, tool } = session({ intent: "change", route: "tracked", slug: "demo", summary: "s", runner: "npm test", tdd: "strict" });
  kernel.task({ action: "add", id: "T1", title: "t", slug: "demo" });
  kernel.task({ action: "add", id: "T2", title: "t", slug: "demo" });
  tool("bash", { command: "npm test" }, true);
  tool("write", { path: "/repo/a.ts" });
  tool("bash", { command: "npm test" });
  assert.equal(kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, true);
  tool("write", { path: "/repo/b.ts" });
  tool("bash", { command: "npm test" });
  const second = kernel.task({ action: "check", id: "T2", slug: "demo" });
  assert.equal(second.ok, false);
  assert.match(second.text, /RED/);
});

test("promotion sees the file a bash command writes", () => {
  const { kernel } = session({ intent: "change", route: "inline", slug: "s", summary: "s", files: ["src/a.ts"] });
  assert.equal(kernel.checkCall({ toolName: "bash", input: { command: "echo x > src/a.ts" } }), null);
  const outside = kernel.checkCall({ toolName: "bash", input: { command: "echo x > src/c.ts" } });
  assert.ok(outside && outside.reason.startsWith("nodd/promotion") && /src\/c\.ts/.test(outside.reason), outside?.reason);
});

test("files written by bash count toward the delegate threshold", () => {
  const { kernel, tool } = session({ intent: "change", route: "inline", slug: "s", summary: "s" });
  tool("bash", { command: "echo x > /repo/f1.ts" });
  const second = kernel.checkCall({ toolName: "bash", input: { command: "echo x > /repo/f2.ts" } });
  assert.ok(second && second.reason.startsWith("nodd/delegate"), second?.reason);
});

test("the files that decide whether NODD looks are not written by a tool", () => {
  // With a declaration in place every gate allows the write, and `$HOME` is
  // outside the roots the destructive guard knows. Turning the evidence gate off
  // from here is how a checkoff was obtained with no run observed.
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo", home: "/home/g" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  kernel.onToolResult({ toolName: "nodd_declare", toolCallId: "d", input: { intent: "change", route: "inline", slug: "s", summary: "s" }, isError: false, content: "ok" });

  for (const command of [
    `echo '{"gates":{"evidence":{"enabled":false}}}' > /home/g/.pi/nodd.json`,
    `echo x > ~/.pi/nodd.json`,
    `printf '{}' >> $HOME/.pi/nodd-hatch.json`,
    `rm -f /home/g/.local/state/nodd/switch.json`,
  ]) {
    const decision = kernel.checkCall({ toolName: "bash", input: { command } });
    assert.ok(decision && decision.reason.startsWith("nodd/config"), `${command} -> ${decision?.reason}`);
  }
  const typed = kernel.checkCall({ toolName: "write", input: { file_path: "/home/g/.pi/nodd.json" } });
  assert.ok(typed && typed.reason.startsWith("nodd/config"), typed?.reason);
  // Reading it is not writing it.
  assert.equal(kernel.checkCall({ toolName: "bash", input: { command: "cat /home/g/.pi/nodd.json" } }), null);
});

test("a declaration can name the root where the work happens, outside the session's repo", () => {
  // The session runs in one repository and the work is in another. Anchoring
  // only to the session root made the runner acceptable only from a directory
  // the work never ran in, so no checkoff could pass.
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/session/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  const input = {
    intent: "change",
    route: "tracked",
    slug: "cross",
    summary: "x",
    runner: "npm test",
    root: "/work/project",
    files: ["src/a.ts"],
  };
  const reply = kernel.declare(input);
  assert.ok(reply.ok, reply.text);
  assert.match(reply.text, /anchored at \/work\/project/, reply.text);

  const doc = parseFeatureDoc(files.get("/session/repo/.nodd/cross/feature.md")!).doc;
  assert.equal(doc.verification.root, "/work/project");
  assert.deepEqual(doc.verification.files, ["/work/project/src/a.ts"], "declared files anchor at the declared root");

  // The document still lives where the session declares, so `track` finds it.
  kernel.onToolResult({ toolName: "nodd_declare", toolCallId: "d", input, isError: false, content: reply.text });
  kernel.onToolResult({ toolName: "nodd_task", toolCallId: "t", input: { action: "add", slug: "cross", id: "T1", title: "x" }, isError: false, content: "ok" });
  kernel.task({ action: "add", slug: "cross", id: "T1", title: "x" });

  // A runner reached through its own `cd` into the declared root is a run of it.
  const run = (id: string, command: string) =>
    kernel.onToolResult({ toolName: "bash", toolCallId: id, input: { command }, isError: false, content: "" });
  run("b1", "cd /work/project && npm test");
  assert.match(kernel.task({ action: "check", slug: "cross", id: "T1" }).text, /checked in/, "the declared root is where the runner is accepted");
});

test("a declaration that names files outside the session root says so", () => {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/session/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  const reply = kernel.declare({ intent: "change", route: "tracked", slug: "out", summary: "x", files: ["/elsewhere/a.ts"] });
  assert.ok(reply.ok, "a legitimate absolute declaration is not refused");
  assert.match(reply.text, /outside `\/session\/repo`/, reply.text);
  assert.match(reply.text, /pass `root`/, "the reply names the remedy");
});

test("a declared root is pinned, like the runner", () => {
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/session/repo" });
  kernel.setPolicy({ config: {}, flags: {}, hatches: {} });
  assert.ok(kernel.declare({ intent: "change", route: "tracked", slug: "p", summary: "x", root: "/one" }).ok);
  const again = kernel.declare({ intent: "change", route: "tracked", slug: "p", summary: "x", root: "/two" });
  assert.ok(!again.ok, "a root chosen after the work is a root chosen to fit it");
  assert.match(again.text, /pinned to root `\/one`/);
  assert.ok(!kernel.declare({ intent: "change", route: "tracked", slug: "p", summary: "x", root: "relative/path" }).ok);
});

test("the config one-shot override is spent by the write it lets through", () => {
  const spent: string[] = [];
  const files = new Map<string, string>();
  const kernel = createKernel({ fs: memoryFs(files), cwd: "/repo", home: "/home/g", spendHatch: (gate) => spent.push(gate) });
  kernel.setPolicy({ config: {}, flags: {}, hatches: { config: { reason: "user asked" } } });
  const first = kernel.checkCall({ toolName: "write", input: { file_path: "/home/g/.pi/nodd.json" } });
  assert.ok(!first?.reason.startsWith("nodd/config"), `the granted override clears its own gate: ${first?.reason}`);
  const second = kernel.checkCall({ toolName: "write", input: { file_path: "/home/g/.pi/nodd.json" } });
  assert.ok(second && second.reason.startsWith("nodd/config"), second?.reason);
  assert.deepEqual(spent, ["config"]);
});

