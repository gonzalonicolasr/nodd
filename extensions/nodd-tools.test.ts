import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register, { createKernel, featureDocPath } from "./nodd-kernel.ts";
import { loadPiToolWrapper } from "./pi-tool-wrapper.ts";
import { parseFeatureDoc } from "../src/feature-doc.ts";

function fakePi() {
  const tools = new Map<string, any>();
  return {
    tools,
    on() {},
    appendEntry() {},
    // Replica `loader.js:215-222`: pi pasa UN objeto y hace `tools.set(tool.name, …)`.
    registerTool(tool: any) { tools.set(tool.name, tool); },
  };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nodd-tools-"));
}

test("both tools are registered with pi", () => {
  const pi = fakePi();
  register(pi as never);
  assert.ok(pi.tools.has("nodd_declare"), "nodd_declare must be registered");
  assert.ok(pi.tools.has("nodd_task"), "nodd_task must be registered");
});

test("route: tracked creates the feature doc and reports it in one line", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  const result = kernel.declare({
    intent: "change", route: "tracked", slug: "demo",
    summary: "Make the thing work", title: "Demo feature",
  });

  const path = featureDocPath(cwd, "demo");
  assert.ok(existsSync(path), `${path} must exist`);
  const parsed = parseFeatureDoc(readFileSync(path, "utf8"));
  assert.deepEqual(parsed.defects, []);
  assert.equal(parsed.doc.objective, "Make the thing work");
  assert.deepEqual(parsed.doc.tasks, [], "a fresh doc has an empty Tasks section");
  assert.equal(result.text, ".nodd/demo/feature.md created with 0 tasks");
});

// A runner is pinned once. `tdd: strict` was not: re-declaring while omitting
// `tdd` rewrote the document to `- tdd: off`, with no refusal and no trace, and
// a GREEN with no RED then checked the task off. Dropping a discipline is as
// much a change to how the work is judged as swapping the runner is.
test("strict TDD cannot be dropped by re-declaring without it", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({
    intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo",
    runner: "npm test", tdd: "strict",
  } as never);

  const second = kernel.declare({
    intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo",
    runner: "npm test",
  } as never);

  assert.equal(second.ok, false, "omitting tdd must not silently downgrade strict to off");
  const parsed = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8"));
  assert.equal(parsed.doc.verification.tdd, "strict", "the pinned discipline must survive the refused re-declaration");
});

test("route: inline creates no durable artifact", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "inline", slug: "small", summary: "one-liner", title: "Small" });
  assert.equal(existsSync(featureDocPath(cwd, "small")), false, "small understood work stays small");
});

test("invalid enum values are rejected before any file write", () => {
  const cwd = tmp();
  const pi = fakePi();
  const kernel = register(pi as never, cwd);
  const declare = pi.tools.get("nodd_declare")!;

  assert.deepEqual(declare.parameters.properties.route.enum, ["inline", "tracked", "forge"]);
  assert.deepEqual(declare.parameters.properties.intent.enum, ["read-only", "change"]);

  const result = kernel.declare({ intent: "change", route: "sideways" as never, slug: "x", summary: "s", title: "T" });
  assert.equal(result.ok, false);
  assert.match(result.text, /route/);
  assert.equal(existsSync(featureDocPath(cwd, "x")), false, "a rejected declaration writes nothing");
});

test("nodd_task add appends a task and the count is reported from the doc", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });

  const added = kernel.task({ action: "add", id: "T1", title: "First task", slug: "demo" });
  assert.equal(added.ok, true);
  const parsed = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8"));
  assert.deepEqual(parsed.doc.tasks, [{ id: "T1", title: "First task", checked: false }]);

  const second = kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  assert.match(second.text, /with 1 tasks?$/);
});

test("the model never writes the doc: the extension does", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  const before = readFileSync(featureDocPath(cwd, "demo"), "utf8");
  // There is no API that accepts doc text from the caller.
  assert.ok(!("writeDoc" in kernel), "the kernel exposes no raw doc writer");
  assert.equal(readFileSync(featureDocPath(cwd, "demo"), "utf8"), before);
});

/** Observe a successful bash run, so the evidence gate has something to see. */
function observeGreen(kernel: ReturnType<typeof createKernel>, command: string, id = "v1"): void {
  kernel.onToolResult({ toolCallId: id, toolName: "bash", input: { command }, isError: false, content: "ok" });
}

test("a checkoff with no observed run is refused by the evidence gate", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });

  const checked = kernel.task({ action: "check", id: "T1", slug: "demo" });
  assert.equal(checked.ok, false, "nothing was observed, so nothing may be claimed");
  assert.match(checked.text, /nodd\/evidence/);
  assert.equal(
    parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc.tasks[0].checked,
    false,
    "a refused checkoff changes nothing on disk",
  );
});

test("a checkoff records the observed command, never an invented one", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  // The runner is pinned here because that is the ordinary tracked declaration:
  // an unpinned one records `success (runner not pinned)` instead, which is a
  // different claim and has its own tests.
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo", runner: "node --test" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });
  observeGreen(kernel, "node --test");

  assert.equal(kernel.task({ action: "check", id: "T1", slug: "demo" }).ok, true);
  const task = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc.tasks[0];
  assert.equal(task.checked && task.evidence.command, "node --test");
  assert.equal(task.checked && task.evidence.outcome, "success");
});

test("a checkoff with no observed commit records pending-commit", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });
  observeGreen(kernel, "node --test");
  kernel.task({ action: "check", id: "T1", slug: "demo" });

  const task = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc.tasks[0];
  assert.equal(task.checked && task.candidate, "pending-commit");
});

test("nodd_task reopen without a reason is refused; with one it records under Progress", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });
  observeGreen(kernel, "node --test");
  kernel.task({ action: "check", id: "T1", slug: "demo" });

  const bare = kernel.task({ action: "reopen", id: "T1", slug: "demo" });
  assert.equal(bare.ok, false);
  assert.match(bare.text, /reason/i);
  assert.equal(
    parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc.tasks[0].checked,
    true,
    "a refused reopen changes nothing on disk",
  );

  const withReason = kernel.task({ action: "reopen", id: "T1", slug: "demo", reason: "the check ran against stale code" });
  assert.equal(withReason.ok, true);
  const doc = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc;
  assert.equal(doc.tasks[0].checked, false);
  assert.match(doc.progress, /T1 reopened: the check ran against stale code/);
});

test("the reopen action is in the tool schema so the model can name it", () => {
  const pi = fakePi();
  register(pi as never, tmp());
  assert.deepEqual(pi.tools.get("nodd_task")!.parameters.properties.action.enum, ["add", "check", "reopen"]);
});

test("a checkoff after an observed commit records that SHA as the candidate", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });

  kernel.onToolResult({
    toolCallId: "g1",
    toolName: "bash",
    input: { command: "git commit -m 'feat: first'" },
    isError: false,
    content: "[main 7c0ffee] feat: first\n 1 file changed",
  });
  kernel.task({ action: "check", id: "T1", slug: "demo" });

  const task = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc.tasks[0];
  assert.equal(task.checked && task.candidate, "7c0ffee");
});

// ---------------------------------------------------------------------------
// The tools as pi runs them.
//
// Every test above this line calls `kernel.declare()` directly, which is the
// layer *below* the defect: pi never calls that. It calls `definition.execute`
// through `wrapToolDefinition`, and NODD registered `handler`, so both tools
// threw `definition.execute is not a function` for every published version.
//
// This is the third defect of that family — after the `registerTool` signature
// and `file_path` vs `path` — and all three escaped for the same reason: the
// double copied the wrong shape from the code it was checking. These tests go
// through pi's own wrapper instead.
// ---------------------------------------------------------------------------
test("the registered tools run through pi's own wrapper", async (t) => {
  const wrap = loadPiToolWrapper();
  if (!wrap) return t.skip("pi is not installed beside us");

  const pi = fakePi();
  const cwd = tmp();
  register(pi as never, cwd, tmp());

  const wrapped = wrap(pi.tools.get("nodd_declare"), () => ({}));
  const result = await wrapped.execute(
    "call-1",
    { intent: "change", route: "tracked", slug: "demo", title: "Demo", summary: "make it work" },
    undefined,
    undefined,
    {},
  );

  assert.ok(existsSync(featureDocPath(cwd, "demo")), "the feature doc must exist after pi runs the tool");
  assert.equal(result.content?.[0]?.type, "text", "pi renders `content`, not a bare string");
  assert.match(String(result.content?.[0]?.text), /demo/);
});

test("nodd_task runs through pi's wrapper too", async (t) => {
  const wrap = loadPiToolWrapper();
  if (!wrap) return t.skip("pi is not installed beside us");

  const pi = fakePi();
  const cwd = tmp();
  register(pi as never, cwd, tmp());

  const declare = wrap(pi.tools.get("nodd_declare"), () => ({}));
  await declare.execute("c1", { intent: "change", route: "tracked", slug: "demo", title: "D", summary: "s" }, undefined, undefined, {});

  const task = wrap(pi.tools.get("nodd_task"), () => ({}));
  const result = await task.execute("c2", { action: "add", slug: "demo", id: "T1", title: "first" }, undefined, undefined, {});

  const { doc } = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8"));
  assert.equal(doc.tasks.length, 1, "the task must reach the document");
  assert.match(String(result.content?.[0]?.text), /T1/);
});

test("every registered tool satisfies pi's ToolDefinition contract", () => {
  // `types.d.ts:344-372`. `label` is what pi shows in the UI, and it was
  // missing on both tools; `execute` is what pi calls.
  const pi = fakePi();
  register(pi as never, tmp(), tmp());

  for (const [name, tool] of pi.tools) {
    assert.equal(typeof tool.name, "string", `${name}: name`);
    assert.equal(typeof tool.label, "string", `${name}: label is required and was missing`);
    assert.equal(typeof tool.description, "string", `${name}: description`);
    assert.equal(typeof tool.execute, "function", `${name}: pi calls execute, not handler`);
    assert.equal(tool.parameters?.type, "object", `${name}: parameters`);
  }
});
