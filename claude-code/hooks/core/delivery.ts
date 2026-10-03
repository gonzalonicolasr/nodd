// Delivery strategy: recorded and measured, never enforced.
//
// `routing.go:103` gives ODD's delivery vocabulary. NODD splits it honestly
// instead of pretending one mechanism covers it:
//
//   - **record** (here): a `## Delivery` section holding strategy, chain,
//     forecast, running count and the slice boundaries with their commits. Both
//     choices are cached so they are asked once.
//   - **measure** (here): the running count is additions plus deletions parsed
//     from observed `git` diffstat output, with a documented generated-file
//     exclusion list. Unparseable output leaves it `unknown` — same fail-closed
//     rule as the command outcomes (T019). A guessed number would be worse than
//     no number, because it would look like a measurement.
//   - **ask** (prose): asking is conversation.
//   - **execute** (out of scope): `/zero-branch` and `/zero-pr` already do it,
//     and ODD itself says push, PR and merge stay the user's (`routing.go:50`).
//
// The ~400-line crossing **emits no block**. `routing.go:95` calls the figure a
// planning heuristic and explicitly not a hard cap, not an automatic stop and
// not a forced split. Turning it into a gate would violate the very clause it
// comes from, so `crossedForecast` returns a fact for the prompt to mention and
// nothing in `src/gates/` may import this module at all.

export type Strategy = "ask-on-risk" | "auto-chain" | "single-pr" | "exception-ok";
export type Chain = "stacked-to-main" | "feature-branch-chain";

const STRATEGIES: readonly string[] = ["ask-on-risk", "auto-chain", "single-pr", "exception-ok"];
const CHAINS: readonly string[] = ["stacked-to-main", "feature-branch-chain"];

export function isStrategy(value: string): value is Strategy {
  return STRATEGIES.includes(value);
}

export function isChain(value: string): value is Chain {
  return CHAINS.includes(value);
}

/** A slice's (base, head) pair. Chained by `src/review-candidate.ts`. */
export type DeliveryBoundary = { base: string; head: string };

export type Delivery = {
  strategy: Strategy;
  chain: Chain;
  /** Authored changed lines forecast at feature-doc creation. */
  forecast: number;
  /** Measured so far, or `unknown` when no diffstat has been parsed. */
  running: number | "unknown";
  boundaries: DeliveryBoundary[];
};

export function defaultDelivery(): Delivery {
  return {
    // `ask-on-risk` is the default because the asking is the part NODD does not
    // mechanize: defaulting to `auto-chain` would decide it silently.
    strategy: "ask-on-risk",
    chain: "stacked-to-main",
    forecast: 0,
    running: "unknown",
    boundaries: [],
  };
}

/**
 * Paths whose churn is not authored work. Documented rather than inferred: a
 * heuristic nobody can read is a heuristic nobody can correct.
 */
export const GENERATED_PATHS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)(dist|build|out|coverage|node_modules|vendor)\//,
  /\.min\.(js|css)$/,
  /\.(snap|lock)$/,
];

function isGenerated(path: string): boolean {
  return GENERATED_PATHS.some((pattern) => pattern.test(path));
}

/**
 * Additions plus deletions of authored lines, from observed `git diff --stat`
 * output. Per-file rows are the source: the summary line cannot be attributed to
 * a path, so it cannot honour the exclusion list.
 *
 * Returns `unknown` when no per-file row parses. A diffstat whose every row is
 * generated returns `0` — that is a measurement, not an absence.
 */
export function countAuthoredLines(gitOutput: string): number | "unknown" {
  const rows = /^\s*(\S.*?)\s+\|\s+(\d+)\s*([+-]*)\s*$/gm;
  let total = 0;
  let parsedAny = false;

  for (const match of (gitOutput ?? "").matchAll(rows)) {
    const [, path, , marks] = match;
    parsedAny = true;
    if (isGenerated(path)) continue;
    // The bar graph is scaled for wide diffs, so `+`/`-` counts are only
    // trustworthy when they add up to the row's own total.
    const changed = Number(match[2]);
    const plus = (marks.match(/\+/g) ?? []).length;
    const minus = (marks.match(/-/g) ?? []).length;
    total += plus + minus === changed ? plus + minus : changed;
  }

  return parsedAny ? total : "unknown";
}

/**
 * Whether the measured count passed the forecast. A fact for the dynamic prompt
 * to mention. `unknown` never claims a crossing — fail-closed both ways.
 */
export function crossedForecast(delivery: Delivery): boolean {
  return delivery.running !== "unknown" && delivery.forecast > 0 && delivery.running > delivery.forecast;
}

export function renderDelivery(delivery: Delivery): string[] {
  return [
    `- strategy: ${delivery.strategy}`,
    `- chain: ${delivery.chain}`,
    `- forecast: ${delivery.forecast}`,
    `- running: ${delivery.running}`,
    ...delivery.boundaries.map((b) => `- boundary: ${b.base}..${b.head}`),
  ];
}

export function parseDelivery(block: string): Delivery {
  const field = (name: string): string | null => {
    const match = new RegExp(`^- ${name}: (.+)$`, "m").exec(block);
    return match ? match[1].trim() : null;
  };

  const strategy = field("strategy");
  const chain = field("chain");
  const running = field("running");
  const forecast = Number(field("forecast"));

  const boundaries: DeliveryBoundary[] = [];
  for (const match of block.matchAll(/^- boundary: (\S+)\.\.(\S+)$/gm)) {
    boundaries.push({ base: match[1], head: match[2] });
  }

  return {
    strategy: strategy && isStrategy(strategy) ? strategy : "ask-on-risk",
    chain: chain && isChain(chain) ? chain : "stacked-to-main",
    forecast: Number.isFinite(forecast) ? forecast : 0,
    running: running !== null && /^\d+$/.test(running) ? Number(running) : "unknown",
    boundaries,
  };
}
