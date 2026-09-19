import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import register, { createKernel, featureDocPath } from "./nodd-kernel.ts";
import { parseFeatureDoc } from "../src/feature-doc.ts";

function fakePi() {
  const tools = new Map<string, any>();
  return {
    tools,
    on() {},
    appendEntry() {},
    registerTool(name: string, options: any) { tools.set(name, options); },
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

test("checkoff refusal wiring is present but open until the evidence gate lands", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });

  const checked = kernel.task({ action: "check", id: "T1", slug: "demo" });
  assert.equal(checked.ok, true);
  const parsed = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8"));
  assert.equal(parsed.doc.tasks[0].checked, true);
});

test("a checkoff with no observed commit records pending-commit", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });
  kernel.task({ action: "check", id: "T1", slug: "demo" });

  const task = parseFeatureDoc(readFileSync(featureDocPath(cwd, "demo"), "utf8")).doc.tasks[0];
  assert.equal(task.checked && task.candidate, "pending-commit");
});

test("nodd_task reopen without a reason is refused; with one it records under Progress", () => {
  const cwd = tmp();
  const kernel = createKernel(undefined, cwd);
  kernel.declare({ intent: "change", route: "tracked", slug: "demo", summary: "obj", title: "Demo" });
  kernel.task({ action: "add", id: "T1", title: "First", slug: "demo" });
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
