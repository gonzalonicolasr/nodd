import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCK_A_BUDGET, BLOCK_B_BUDGET } from "../src/prompt.ts";
import register from "./nodd-kernel.ts";

type Handler = (event: unknown) => unknown;

function host() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerTool: () => {},
    appendEntry: () => {},
  };
  const kernel = register(pi as never, mkdtempSync(join(tmpdir(), "nodd-prompt-")));
  return { handlers, kernel };
}

function fire(incoming: string | null | undefined): string {
  const { handlers } = host();
  const handler = handlers.get("before_agent_start");
  assert.ok(handler, "the kernel must register a before_agent_start handler");
  const result = handler!({ systemPrompt: incoming }) as { systemPrompt?: string } | undefined;
  return result?.systemPrompt ?? "";
}

// ---------------------------------------------------------------------------
// Chained, never replaced
// ---------------------------------------------------------------------------
test("the handler is registered on before_agent_start", () => {
  assert.ok(host().handlers.has("before_agent_start"));
});

test("the result starts with the incoming prompt, byte for byte", () => {
  const incoming = "ANOTHER EXTENSION'S CONTRIBUTION\nwith two lines.";
  const result = fire(incoming);
  assert.ok(result.startsWith(incoming), `other extensions' contributions must survive:\n${result.slice(0, 120)}`);
  assert.ok(result.length > incoming.length, "NODD appends its own blocks");
});

test("both blocks are appended", () => {
  const result = fire("base");
  assert.match(result, /NODD/, "block A is present");
  assert.match(result, /ODD · guía|gates disabled/, "block B or the disabled line is present");
});

test("an empty incoming prompt still yields NODD's blocks", () => {
  const result = fire("");
  assert.match(result, /NODD/);
  assert.ok(result.length > 0);
});

test("a null or missing incoming prompt drops no content", () => {
  for (const incoming of [null, undefined]) {
    const result = fire(incoming);
    assert.match(result, /NODD/, `incoming=${incoming} must still produce NODD's blocks`);
    assert.ok(!result.includes("null") && !result.includes("undefined"), "no stringified nullish leaks in");
  }
});

test("the appended content respects the budgets", () => {
  const incoming = "base prompt";
  const appended = fire(incoming).slice(incoming.length);
  assert.ok(
    appended.length <= BLOCK_A_BUDGET + BLOCK_B_BUDGET + 8,
    `appended ${appended.length} exceeds the two budgets plus separators`,
  );
});

test("firing twice does not accumulate: the prompt is rebuilt, not appended to itself", () => {
  const { handlers } = host();
  const handler = handlers.get("before_agent_start")!;
  const first = (handler({ systemPrompt: "base" }) as { systemPrompt: string }).systemPrompt;
  const second = (handler({ systemPrompt: "base" }) as { systemPrompt: string }).systemPrompt;
  assert.equal(first, second, "a second turn with the same state renders the same prompt");
});

test("the handler never throws, whatever the event shape", () => {
  const { handlers } = host();
  const handler = handlers.get("before_agent_start")!;
  for (const event of [undefined, null, {}, { systemPrompt: 42 }, "nonsense"]) {
    assert.doesNotThrow(() => handler(event as never), `event ${JSON.stringify(event)} must not throw`);
  }
});
