import { test } from "node:test";
import assert from "node:assert/strict";

import { statusLine } from "./status.ts";
import { emptyCommitted, type Committed, type Declaration } from "./state.ts";

function committed(over: Partial<Committed> = {}): Committed {
  return { ...emptyCommitted(), ...over };
}

function declared(over: Partial<Declaration> = {}): Declaration {
  return { intent: "change", route: "inline", slug: "demo", runner: null, tdd: "off", files: [], ...over };
}

// ---------------------------------------------------------------------------
// The whole point of the footer line is answering "is this thing on?" without
// running a command. That answer has to survive the case where nothing has
// happened yet, which is exactly when the user is wondering.
// ---------------------------------------------------------------------------
test("a fresh session still says nodd is on", () => {
  assert.equal(statusLine(committed(), true), "nodd · sin declarar");
});

test("gates off is visible, not silent", () => {
  // A disabled kernel that renders the same as an enabled one is how someone
  // spends an afternoon wondering why nothing is being enforced.
  assert.equal(statusLine(committed(), false), "nodd · apagado");
});

test("a declared route shows the route and the slug", () => {
  const state = committed({ declaration: declared({ route: "tracked", slug: "auth" }) });
  assert.equal(statusLine(state, true), "nodd · tracked · auth");
});

test("tracked work counts verified tasks against the total", () => {
  // `tracked` is the route with a task list, so its progress is the useful
  // thing to show; inline work has no tasks to count.
  const state = committed({ declaration: declared({ route: "tracked", slug: "auth" }) });
  assert.equal(statusLine(state, true, { done: 1, total: 3 }), "nodd · tracked · auth · 1/3");
});

test("a task list that is fully verified is still shown", () => {
  const state = committed({ declaration: declared({ route: "tracked", slug: "auth" }) });
  assert.equal(statusLine(state, true, { done: 2, total: 2 }), "nodd · tracked · auth · 2/2");
});

test("an empty task list does not render a meaningless 0/0", () => {
  const state = committed({ declaration: declared({ route: "tracked", slug: "auth" }) });
  assert.equal(statusLine(state, true, { done: 0, total: 0 }), "nodd · tracked · auth");
});

test("inline work does not show a task count it does not have", () => {
  const state = committed({ declaration: declared({ route: "inline", slug: "mul" }) });
  assert.equal(statusLine(state, true, { done: 0, total: 0 }), "nodd · inline · mul");
});

test("the line stays short enough for a footer", () => {
  // The footer is shared with the model name, token counts and the diff stat.
  // A status that pushes those off screen is worse than no status.
  const state = committed({
    declaration: declared({ route: "tracked", slug: "a-rather-long-feature-slug-here" }),
  });
  const line = statusLine(state, true, { done: 12, total: 34 });
  assert.ok(line.length <= 48, `too long for a footer: ${line.length} chars — ${line}`);
});
