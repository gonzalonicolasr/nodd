import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { MECHANISM_PLACEHOLDER } from "../src/models/slots.ts";
import register, { runModelsCommand, type ConfigIo } from "./nodd-models.ts";
import type { EnterResult, PickerState } from "../src/models/picker.ts";

const registry = {
  getAll: () => [
    { provider: "anthropic", id: "claude-sonnet-4-5" },
    { provider: "anthropic", id: "claude-opus-4-1" },
    { provider: "openai-codex", id: "gpt-5-codex" },
  ],
};

function memoryIo(initial: Record<string, unknown> = {}): ConfigIo & { writes: Record<string, unknown>[] } {
  let data = { ...initial };
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    readConfig: () => ({ ...data }),
    writeConfig: (next) => {
      data = next;
      writes.push(next);
    },
  };
}

// ---------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------
test("the no-arg output lists all seven steps with the four mechanisms marked", () => {
  const io = memoryIo({ models: { implement: "anthropic/claude-opus-4-1" } });
  const output = runModelsCommand("", io, registry);

  for (const step of ["authorize", "explore", "resolve-uncertainty", "classify", "track", "implement", "close"]) {
    assert.ok(output.includes(step), `${step} must be listed`);
  }
  for (const mechanism of ["authorize", "classify", "track", "close"]) {
    const row = output.split("\n").find((line) => line.includes(mechanism))!;
    assert.ok(row.includes(MECHANISM_PLACEHOLDER), `${mechanism} must be marked as a mechanism: ${row}`);
  }
  assert.ok(output.includes("anthropic/claude-opus-4-1"), "an assigned slot shows its model");
  assert.equal(io.writes.length, 0, "displaying writes nothing");
});

test("the two global slots are listed alongside the steps", () => {
  const output = runModelsCommand("", memoryIo(), registry);
  assert.ok(output.includes("default"));
  assert.ok(output.includes("orchestrator"));
});

// ---------------------------------------------------------------------------
// Direct assignment
// ---------------------------------------------------------------------------
test("a valid assignment writes only models.implement and preserves unrelated keys", () => {
  const io = memoryIo({
    models: { explore: "anthropic/claude-sonnet-4-5" },
    gates: { track: { enabled: false } },
    somethingElse: { deep: [1, 2, 3] },
  });

  const output = runModelsCommand("implement=anthropic/claude-opus-4-1", io, registry);
  assert.equal(io.writes.length, 1, "a valid assignment writes exactly once");

  const written = io.writes[0];
  assert.deepEqual(written.models, {
    explore: "anthropic/claude-sonnet-4-5",
    implement: "anthropic/claude-opus-4-1",
  });
  assert.deepEqual(written.gates, { track: { enabled: false } }, "gate flags survive a model write");
  assert.deepEqual(written.somethingElse, { deep: [1, 2, 3] }, "an unknown key survives byte-for-byte");
  assert.match(output, /implement/);
});

test("classify=x/y is rejected as a mechanism and writes nothing", () => {
  const io = memoryIo();
  const output = runModelsCommand("classify=anthropic/claude-opus-4-1", io, registry);
  assert.match(output, /mecanismo/);
  assert.equal(io.writes.length, 0);
});

test("an unknown model is rejected against the live registry and writes nothing", () => {
  const io = memoryIo();
  assert.match(runModelsCommand("implement=unknown/model", io, registry), /provider desconocido/);
  assert.match(runModelsCommand("implement=anthropic/gpt-9", io, registry), /modelo desconocido/);
  assert.equal(io.writes.length, 0);
});

test("an unparseable argument reports usage and writes nothing", () => {
  const io = memoryIo();
  assert.match(runModelsCommand("implement", io, registry), /uso/i);
  assert.equal(io.writes.length, 0);
});

// ---------------------------------------------------------------------------
// Profiles, through the same command
// ---------------------------------------------------------------------------
test("profile new writes once and activates the profile", () => {
  const io = memoryIo({ models: { implement: "anthropic/claude-opus-4-1" } });
  const output = runModelsCommand("profile new fast", io, registry);
  assert.equal(io.writes.length, 1);
  assert.equal(io.writes[0].activeProfile, "fast");
  assert.match(output, /fast/);
});

test("profile list writes nothing", () => {
  const io = memoryIo({ profiles: { fast: { models: {} } }, activeProfile: "fast" });
  const output = runModelsCommand("profile list", io, registry);
  assert.ok(output.includes("fast"));
  assert.equal(io.writes.length, 0);
});

test("editing a slot with a profile active mirrors into that profile", () => {
  const io = memoryIo({
    models: { implement: "anthropic/claude-sonnet-4-5" },
    profiles: { fast: { models: { implement: "anthropic/claude-sonnet-4-5" } } },
    activeProfile: "fast",
  });
  runModelsCommand("implement=anthropic/claude-opus-4-1", io, registry);
  assert.deepEqual(
    (io.writes[0].profiles as Record<string, unknown>).fast,
    { models: { implement: "anthropic/claude-opus-4-1" } },
  );
});

// ---------------------------------------------------------------------------
// The picker host
// ---------------------------------------------------------------------------

/** Drive the real picker to a save carrying one staged model. */
function stageOneModel(): { type: "save"; state: PickerState } {
  let captured: EnterResult | null = null;
  const component = register.createComponent(
    {
      models: { implement: "anthropic/claude-opus-4-1" },
      thinking: {},
      groups: new Map([["anthropic", ["claude-opus-4-1"]]]),
    },
    (result: EnterResult) => {
      captured = result;
    },
  );
  // The menu opens on "nuevo perfil"; save is two rows down.
  component.handleInput?.("\u001b[B");
  component.handleInput?.("\u001b[B");
  component.handleInput?.("\r");
  assert.ok(captured, "the picker must close with a result");
  assert.equal(captured!.type, "save");
  return captured as { type: "save"; state: PickerState };
}
test("quitting the picker produces zero writes; saving writes once", async () => {
  const quitIo = memoryIo();
  await register.runPicker({ type: "quit" }, quitIo);
  assert.equal(quitIo.writes.length, 0, "quit writes nothing");

  // A save carries the whole staged state, so it is built from the picker
  // itself rather than hand-written: a literal would drift from the real shape.
  const saved = stageOneModel();
  const saveIo = memoryIo({ unrelated: true });
  await register.runPicker(saved, saveIo);
  assert.equal(saveIo.writes.length, 1);
  assert.deepEqual(saveIo.writes[0].models, { implement: "anthropic/claude-opus-4-1" });
  assert.equal(saveIo.writes[0].unrelated, true, "the picker's save preserves unrelated keys");
});

test("the handler opens the picker on the saved profiles, not on an empty menu", async () => {
  // The host built the picker from `models` and `groups` only, so the profiles
  // on disk never reached it: a user with six saved profiles opened
  // /nodd-models and the menu offered to create the first one.
  const commands = new Map<string, any>();
  register({ registerCommand: (name: string, options: unknown) => commands.set(name, options) } as never);

  const config = {
    models: { implement: "cliproxy/personal/claude-opus-5" },
    thinking: { implement: "high" },
    profiles: {
      rapido: { models: { implement: "cliproxy/ds/deepseek-flash" }, thinking: { implement: "low" } },
      lento: { models: { implement: "cliproxy/personal/claude-opus-5" }, thinking: { implement: "high" } },
    },
    activeProfile: "rapido",
  };

  const home = mkdtempSync(join(tmpdir(), "nodd-models-"));
  mkdirSync(join(home, ".pi"), { recursive: true });
  writeFileSync(join(home, ".pi", "nodd.json"), JSON.stringify(config));
  const previousHome = process.env.HOME;
  process.env.HOME = home;

  let rendered: string[] = [];
  try {
    await commands.get("nodd-models").handler("", {
      ui: {
        notify() {},
        // Stand in for pi's custom-UI host: build the component, render it, and
        // quit without saving.
        async custom(build: any) {
          let result: unknown;
          const component = build({ requestRender() {} }, {}, {}, (r: unknown) => { result = r; });
          rendered = component.render(80);
          component.handleInput?.("q");
          return result ?? { type: "quit" };
        },
      },
      modelRegistry: { getAll: () => [{ provider: "cliproxy", id: "personal/claude-opus-5" }] },
    } as never);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }

  const screen = rendered.join("\n");
  assert.match(screen, /rapido/, "a saved profile is on the opening screen");
  assert.match(screen, /lento/, "and so is the other one");
  assert.doesNotMatch(screen, /modelos sin perfil/, "with profiles saved, the menu is not the no-profile one");
});

test("the picker input carries the profiles and the active one", () => {
  const input = register.pickerInput(
    {
      models: { implement: "cliproxy/personal/claude-opus-5" },
      thinking: { implement: "high" },
      profiles: { rapido: { models: { implement: "cliproxy/ds/deepseek-flash" } } },
      activeProfile: "rapido",
    },
    new Map([["cliproxy", ["personal/claude-opus-5"]]]),
  );

  assert.deepEqual(Object.keys(input.profiles), ["rapido"], "saved profiles reach the picker");
  assert.equal(input.activeProfile, "rapido", "and so does the active one");
  assert.deepEqual(input.thinking, { implement: "high" }, "and the levels, so editing does not wipe them");
});

test("the command is registered with pi under its own name", () => {
  const commands = new Map<string, unknown>();
  register({ registerCommand: (name: string, options: unknown) => commands.set(name, options) } as never);
  assert.ok(commands.has("nodd-models"), "the command must be /nodd-models, never /zero-models");
  assert.ok(!commands.has("zero-models"));
});

test("the picker component renders rows and is a plain object, no TUI import", () => {
  const component = register.createComponent(
    {
      models: { implement: "anthropic/claude-opus-4-1" },
      thinking: {},
      groups: new Map([["anthropic", ["claude-opus-4-1"]]]),
    },
    () => {},
  );
  const lines = component.render(80);
  assert.ok(Array.isArray(lines), "render returns string[]");
  assert.ok(lines.some((line) => line.includes("guardar y salir")), "the menu offers save");

  // The slots are one screen in, behind the loose-config row, which is what the
  // menu offers while no profile exists.
  component.handleInput?.("\u001b[B");
  component.handleInput?.("\r");
  const slots = component.render(80);
  assert.ok(slots.length > 7, "every slot row is rendered");
  assert.ok(slots.some((line) => line.includes(MECHANISM_PLACEHOLDER)), "mechanism rows are visible in the picker");
  assert.ok(slots.some((line) => line.includes("anthropic/claude-opus-4-1")));
});

// ---------------------------------------------------------------------------
// The absolute rule
// ---------------------------------------------------------------------------
test("this extension imports no TUI package, as a value or as a type", () => {
  const source = readFileSync(new URL("./nodd-models.ts", import.meta.url), "utf8");
  const forbidden = `@earendil-works/${["pi", "tui"].join("-")}`;
  assert.ok(!source.includes(forbidden), "not a value import, not an import type, not a string");
  assert.ok(/interface Component/.test(source), "the component contract is declared locally");
});

test("nothing in this extension names forge's config file", () => {
  const source = readFileSync(new URL("./nodd-models.ts", import.meta.url), "utf8");
  assert.ok(!source.includes(`zero${"."}json`), "NODD never opens forge's config");
  assert.ok(source.includes("nodd.json") || source.includes("noddConfigPath"), "it uses its own");
});

test("the picker offers the providers you can actually use, not the whole catalogue", () => {
  // pi's registry carries every provider it knows how to speak to — bedrock,
  // baseten, huggingface, cloudflare — whether or not you have credentials for
  // any of them. Browsing all of it meant scrolling past dozens of providers
  // that cannot answer. `getAvailable()` is pi's own answer to "which of these
  // has configured auth", so that is what the picker lists.
  const registry = {
    getAll: () => [
      { provider: "cliproxy", id: "ds/deepseek-flash" },
      { provider: "amazon-bedrock", id: "claude-3" },
      { provider: "huggingface", id: "meta-llama/x" },
    ],
    getAvailable: () => [{ provider: "cliproxy", id: "ds/deepseek-flash" }],
  };

  const groups = register.groupsFrom(registry);
  assert.deepEqual([...groups.keys()], ["cliproxy/ds"], "only the configured provider is browsable");
});

test("with no availability information the full registry is still offered", () => {
  // An older host, or one that cannot answer, must not leave the picker empty:
  // showing everything beats showing nothing.
  const groups = register.groupsFrom({ getAll: () => [{ provider: "anthropic", id: "claude-opus-4-1" }] });
  assert.deepEqual([...groups.keys()], ["anthropic"]);
});

test("an empty availability list falls back rather than offering nothing", () => {
  // Availability is refreshed asynchronously, so early in a session it can be
  // legitimately empty. Trusting it blindly would show an empty provider list.
  const groups = register.groupsFrom({
    getAll: () => [{ provider: "anthropic", id: "claude-opus-4-1" }],
    getAvailable: () => [],
  });
  assert.deepEqual([...groups.keys()], ["anthropic"], "an empty answer is not an answer");
});
