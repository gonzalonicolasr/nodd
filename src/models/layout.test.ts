import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fitRows,
  frameBox,
  padToWidth,
  sideBySide,
  stripAnsi,
  truncateToWidth,
  usableRows,
  visibleWidth,
  windowRows,
} from "./layout.ts";

const ESC = "\u001b";

// ---------------------------------------------------------------------------
// Measuring what the terminal actually shows
// ---------------------------------------------------------------------------
test("stripAnsi removes CSI colour runs and leaves the printable text", () => {
  assert.equal(stripAnsi(`${ESC}[31mrojo${ESC}[0m`), "rojo");
  assert.equal(stripAnsi("sin escapes"), "sin escapes");
});

test("visibleWidth counts cells, not code units: escapes are free, wide glyphs cost two", () => {
  assert.equal(visibleWidth(`${ESC}[31mrojo${ESC}[0m`), 4);
  assert.equal(visibleWidth("漢字"), 4, "East-Asian wide glyphs take two cells each");
  assert.equal(visibleWidth("e\u0301"), 1, "a combining accent takes no cell of its own");
});

// ---------------------------------------------------------------------------
// Truncating by width, never by index
// ---------------------------------------------------------------------------
test("a line that fits is returned untouched", () => {
  assert.equal(truncateToWidth("corto", 10), "corto");
});

test("truncation marks the cut and never overshoots the budget", () => {
  const cut = truncateToWidth("abcdefghij", 5);
  assert.equal(visibleWidth(cut), 5);
  assert.ok(cut.endsWith("…"), `the cut must be marked: ${cut}`);
});

test("a wide glyph is never split in half by the budget", () => {
  // Budget 4 = ellipsis (1) + 3 cells, and 漢 costs 2: only one glyph fits.
  const cut = truncateToWidth("漢字漢字", 4);
  assert.ok(visibleWidth(cut) <= 4, `overshot the budget: ${visibleWidth(cut)}`);
  assert.ok(!cut.includes("\ufffd"), "no replacement character: a code point was split");
});

test("a cut inside a styled run appends a reset, so the colour cannot bleed", () => {
  const cut = truncateToWidth(`${ESC}[31mabcdefghij`, 5);
  assert.ok(cut.endsWith(`${ESC}[0m`), `a styled cut must close its own run: ${JSON.stringify(cut)}`);
});

test("a non-positive budget yields an empty line", () => {
  assert.equal(truncateToWidth("abc", 0), "");
});

// ---------------------------------------------------------------------------
// Padding to an exact cell count
// ---------------------------------------------------------------------------
test("padToWidth makes a line occupy exactly the width asked for", () => {
  assert.equal(visibleWidth(padToWidth("ab", 6)), 6);
  assert.equal(visibleWidth(padToWidth("abcdefghij", 6)), 6, "too long is truncated, not overflowed");
  assert.equal(visibleWidth(padToWidth("漢字", 6)), 6, "wide glyphs are measured, not counted");
  assert.equal(padToWidth("x", 0), "");
});

// ---------------------------------------------------------------------------
// Windowing a long list around the cursor
// ---------------------------------------------------------------------------
test("a list that fits is drawn whole, with nothing hidden", () => {
  assert.deepEqual(windowRows(5, 0, 10), { start: 0, end: 5, hiddenBefore: 0, hiddenAfter: 0 });
});

test("the window keeps the cursor on screen and reports what it hides", () => {
  for (const cursor of [0, 3, 9, 19]) {
    const win = windowRows(20, cursor, 5);
    assert.ok(cursor >= win.start && cursor < win.end, `cursor ${cursor} fell outside ${win.start}..${win.end}`);
    assert.equal(win.end - win.start, 5, "the window always fills its capacity");
    assert.equal(win.hiddenBefore, win.start);
    assert.equal(win.hiddenAfter, 20 - win.end);
  }
});

test("the window clamps at both ends instead of scrolling past them", () => {
  assert.deepEqual(windowRows(20, 0, 5), { start: 0, end: 5, hiddenBefore: 0, hiddenAfter: 15 });
  assert.deepEqual(windowRows(20, 19, 5), { start: 15, end: 20, hiddenBefore: 15, hiddenAfter: 0 });
});

test("no capacity and no rows are handled, not crashed", () => {
  assert.deepEqual(windowRows(20, 3, 0), { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 20 });
  assert.deepEqual(windowRows(0, 0, 5), { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 0 });
});

// ---------------------------------------------------------------------------
// Fitting the terminal's own height
// ---------------------------------------------------------------------------
test("usableRows leaves room for pi's chrome and never returns a useless height", () => {
  assert.ok(usableRows(40) < 40, "pi's own chrome takes rows off the top");
  assert.ok(usableRows(40) > 20, "a tall terminal gets most of its rows");
  assert.ok(usableRows(4) >= 8, "a tiny terminal still gets a minimum block");
  assert.ok(usableRows(undefined) > 0, "an unknown terminal height still yields a height");
  assert.ok(usableRows(0) > 0);
});

test("fitRows keeps the first rows, because the frame top and title matter most", () => {
  assert.deepEqual(fitRows(["a", "b", "c"], 2), ["a", "b"]);
  assert.deepEqual(fitRows(["a", "b"], 5), ["a", "b"]);
  assert.deepEqual(fitRows(["a"], 0), []);
});

// ---------------------------------------------------------------------------
// The module boundary: pure, so node --test reaches it with no terminal.
// ---------------------------------------------------------------------------
test("the layout helpers import nothing at all", () => {
  const source = readFileSync(new URL("./layout.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.ok(!/^import /m.test(source), "the layout must stay dependency-free: no node:*, no pi, no TUI");
});

// ---------------------------------------------------------------------------
// The boxed two-panel layout
// ---------------------------------------------------------------------------

test("frameBox draws four sides and pads every row to the same width", () => {
  const out = frameBox([{ text: "uno" }, { text: "" }, { text: "dos" }], 20);

  assert.equal(out.length, 5, "top, three rows, bottom");
  assert.ok(out[0].startsWith("┌") && out[0].endsWith("┐"));
  assert.ok(out[4].startsWith("└") && out[4].endsWith("┘"));
  for (const line of out) {
    assert.equal(visibleWidth(line), 20, `every line is the box width: ${JSON.stringify(line)}`);
  }
  assert.ok(out[1].startsWith("│ uno") && out[1].endsWith("│"));
});

test("frameBox truncates on display cells, so the closing edge never moves", () => {
  const out = frameBox([{ text: "una fila larguísima que no entra de ningún modo" }], 20);
  assert.equal(visibleWidth(out[1]), 20);
  assert.ok(out[1].endsWith("│"), "the right edge survives the cut");
});

test("below the split width only the menu is rendered", () => {
  const menu = [{ text: "menu" }];
  const preview = [{ text: "preview" }];
  const narrow = sideBySide(menu, preview, 40);

  assert.ok(narrow.every((line) => !line.includes("preview")), "no room: the preview is dropped, not squeezed");
  assert.ok(narrow.some((line) => line.includes("menu")));
});

test("side by side, both panels are framed and equally tall", () => {
  const out = sideBySide([{ text: "a" }, { text: "b" }, { text: "c" }], [{ text: "p" }], 100);

  assert.ok(out.every((line) => visibleWidth(line) <= 100), "the pair never exceeds the terminal");
  const joined = out.join("\n");
  assert.ok(joined.includes("a") && joined.includes("p"), "both panels are present");
  // Five rows: the taller panel is three rows plus its two frame lines, and the
  // shorter one is padded to match rather than leaving a ragged edge.
  assert.equal(out.length, 5);
  for (const line of out) assert.equal(visibleWidth(line), visibleWidth(out[0]), "rows are flush");
});
