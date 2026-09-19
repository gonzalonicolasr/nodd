// Terminal-layout helpers for the `/nodd-models` picker.
//
// Adapted from `zero-tui-layout.ts` — adapted, never imported: NODD is a
// standalone package.
//
// pi has no windows. `ctx.ui.custom()` hands a component `render(width):
// string[]` and pi prints those lines into the terminal flow; it never clips
// them. So a block returning more lines than the terminal has rows scrolls its
// own top — frame border and title first — off the screen, and a line wider than
// the terminal wraps and breaks the box. Fitting the viewport is the block's own
// job, and this module is where that job lives.
//
// Zero imports, on purpose: no `node:*`, no pi, no TUI package. The terminal
// size always arrives as an argument, so `node --test` exercises every helper
// with no terminal at all.
//
// Unlike forge's version there is no `setWidthFns` injection hook. That hook
// exists so a real session can swap in pi-tui's own width functions, and NODD
// may not import that package under any spelling — an injection point nobody can
// reach would be dead configuration.

/** The escape byte, spelled as a unicode escape so the source stays printable. */
const ESC = "\u001b";

/** ANSI CSI/SGR sequences and OSC strings — they occupy zero display cells. */
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^]*?(?:\\u0007|${ESC}\\\\)`, "g");

/** The reset appended when a truncation cuts inside a styled run. */
const ANSI_RESET = `${ESC}[0m`;

/** Strip every ANSI escape, leaving only the characters that occupy cells. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * How many terminal cells one code point occupies: combining marks and
 * zero-width joiners none, East-Asian Wide/Fullwidth and emoji two, the rest
 * one. A range table rather than a dependency, because the no-TUI-import rule
 * leaves nothing to delegate to.
 */
function codePointWidth(cp: number): number {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f7e0 && cp <= 0x1f7eb) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Printable width of `text` in terminal cells, ANSI escapes excluded. */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += codePointWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/**
 * Cut `text` to at most `maxWidth` cells, marking the cut with `ellipsis`.
 *
 * Iterates by code point, never by UTF-16 unit, so a surrogate pair is never
 * split in half, and accounts for wide glyphs so the result cannot overshoot the
 * budget. ANSI escapes pass through verbatim and a reset is appended when the
 * cut lands inside a styled run, so a truncated coloured label cannot bleed its
 * colour into the rest of the frame.
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;

  const mark = visibleWidth(ellipsis) <= maxWidth ? ellipsis : "";
  const budget = maxWidth - visibleWidth(mark);

  let out = "";
  let width = 0;
  let styled = false;
  let index = 0;

  while (index < text.length) {
    ANSI_RE.lastIndex = index;
    const match = ANSI_RE.exec(text);
    if (match && match.index === index) {
      out += match[0];
      styled = match[0] !== ANSI_RESET;
      index += match[0].length;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(index) ?? 0);
    const cells = codePointWidth(ch.codePointAt(0) ?? 0);
    if (width + cells > budget) break;
    out += ch;
    width += cells;
    index += ch.length;
  }

  return out + mark + (styled ? ANSI_RESET : "");
}

/** Truncate *and* space-pad `text` so it occupies exactly `width` cells. */
export function padToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = truncateToWidth(text, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** The slice of a long list that is actually drawn, plus what it hides. */
export type RowWindow = {
  /** First drawn index, inclusive. */
  start: number;
  /** Last drawn index, exclusive. */
  end: number;
  /** How many items sit above `start`. */
  hiddenBefore: number;
  /** How many items sit below `end`. */
  hiddenAfter: number;
};

/**
 * Pick the slice of `total` items to draw so `cursor` is always visible.
 *
 * Centred on the cursor and clamped at both ends, so moving through a long list
 * scrolls only once the cursor reaches the edge instead of jumping the viewport
 * on every keystroke.
 */
export function windowRows(total: number, cursor: number, capacity: number): RowWindow {
  if (capacity <= 0 || total <= 0) {
    return { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: Math.max(0, total) };
  }
  if (total <= capacity) return { start: 0, end: total, hiddenBefore: 0, hiddenAfter: 0 };

  const safeCursor = Math.min(Math.max(0, cursor), total - 1);
  const start = Math.min(Math.max(0, safeCursor - Math.floor(capacity / 2)), total - capacity);
  const end = start + capacity;
  return { start, end, hiddenBefore: start, hiddenAfter: total - end };
}

/** Rows pi's own chrome (input box, status line, spacing) takes off the top. */
const PI_CHROME_ROWS = 8;

/** Never render a block shorter than this, whatever the terminal claims. */
const MIN_BLOCK_ROWS = 8;

/**
 * How many rows the picker may use in a terminal of `terminalRows` rows. A
 * terminal too short to host the reserve still gets `MIN_BLOCK_ROWS`: a
 * slightly-too-tall block beats an empty frame.
 */
export function usableRows(terminalRows: number | undefined): number {
  if (!terminalRows || !Number.isFinite(terminalRows) || terminalRows <= 0) return MIN_BLOCK_ROWS * 2;
  return Math.max(MIN_BLOCK_ROWS, terminalRows - PI_CHROME_ROWS);
}

/**
 * Last-resort height clamp for an already-rendered block. Keeps the *first*
 * `maxRows` lines: when something still overflows, losing the bottom border
 * beats losing the frame top and the title, which is exactly what the terminal's
 * own scroll takes away.
 */
export function fitRows(lines: readonly string[], maxRows: number): string[] {
  if (maxRows <= 0) return [];
  return lines.length <= maxRows ? [...lines] : lines.slice(0, maxRows);
}
