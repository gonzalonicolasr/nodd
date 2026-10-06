import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import register from "./nodd-kernel.ts";

type Handler = (event: unknown, ctx?: unknown) => unknown;

function pi() {
  const handlers = new Map<string, Handler>();
  const api = { on: (event: string, handler: Handler) => handlers.set(event, handler), registerTool: () => {}, appendEntry: () => {} };
  const cwd = mkdtempSync(join(tmpdir(), "nodd-close-"));
  const home = mkdtempSync(join(tmpdir(), "nodd-close-home-"));
  const kernel = register(api as never, cwd, home);
  const notes: Array<{ text: string; type?: string }> = [];
  const ctx = { ui: { notify: (text: string, type?: string) => notes.push({ text, type }), setStatus: () => {} } };
  let id = 0;
  const fire = (name: string, event: unknown) => handlers.get(name)?.(event, ctx);
  const tool = (toolName: string, input: Record<string, unknown>, isError = false, text = "ok") => {
    const toolCallId = `t${++id}`;
    fire("tool_call", { toolName, toolCallId, input });
    if (toolName === "nodd_declare") kernel.declare(input as never);
    fire("tool_result", { toolName, toolCallId, input, isError, content: [{ type: "text", text }] });
  };
  const prompt = (text: string) => fire("before_agent_start", { prompt: text, systemPrompt: "" }) as { systemPrompt: string };
  const end = (answer: string) => fire("agent_end", { messages: [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: answer }] }] });
  return { cwd, notes, tool, prompt, end };
}

test("pi shows the observed close after a request that wrote, and flags an unverified claim", () => {
  const s = pi();
  s.prompt("hacé el login");
  s.tool("nodd_declare", { intent: "change", route: "inline", slug: "auth", summary: "login", runner: "npm test" });
  s.tool("write", { path: join(s.cwd, "a.ts"), content: "x" });
  s.end("Listo, pasan los tests.");
  assert.equal(s.notes.length, 1);
  assert.match(s.notes[0].text, /◆ NODD · auth · 1 archivo · `npm test` sin correr/);
  assert.match(s.notes[0].text, /la respuesta afirma/);
  assert.equal(s.notes[0].type, "warning");
  assert.match(s.prompt("y ahora?").systemPrompt, /la respuesta afirma/);
  assert.doesNotMatch(s.prompt("otra").systemPrompt, /la respuesta afirma/);
});

test("a green run after the write closes clean, and a request with no writes shows nothing", () => {
  const s = pi();
  s.prompt("arreglá");
  s.tool("nodd_declare", { intent: "change", route: "inline", slug: "fix", summary: "s", runner: "npm test" });
  s.tool("write", { path: join(s.cwd, "a.ts"), content: "x" });
  s.tool("bash", { command: "npm test" });
  s.end("Listo.");
  assert.match(s.notes[0].text, /✓ `npm test` verde después de la última escritura/);
  assert.equal(s.notes[0].type, "info");
  s.prompt("qué hace esto?");
  s.end("explicación");
  assert.equal(s.notes.length, 1);
});

test("an edit that skips a test is named in the close", () => {
  const s = pi();
  const path = join(s.cwd, "a.test.ts");
  writeFileSync(path, "it('x', () => { expect(f()).toBe(1) })");
  s.prompt("que pase");
  s.tool("nodd_declare", { intent: "change", route: "inline", slug: "t", summary: "s", runner: "npm test" });
  s.tool("bash", { command: "npm test" }, true, "FAIL\nCommand exited with code 1");
  s.tool("edit", { path, edits: [{ oldText: "it('x', () => { expect(f()).toBe(1) })", newText: "it.skip('x', () => {})" }] });
  s.tool("bash", { command: "npm test" });
  s.end("ya pasan");
  assert.match(s.notes[0].text, /se agregó \.skip\(/);
  assert.match(s.notes[0].text, /después de que el runner fallara/);
});
