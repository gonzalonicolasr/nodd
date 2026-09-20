// Does this bash command mutate the filesystem?
//
// `tool_call` hands us `input.command` as a string (`types.d.ts:653-656`), not
// a declaration of filesystem intent. `write` and `edit` are typed and gated
// exactly; bash can only be gated by pattern. This is a denylist, and a
// denylist is by construction incomplete.
//
// That incompleteness is shipped as documentation, not buried here:
// `NOT_COVERED` below is rendered into README.md and asserted against by test,
// so the product cannot quietly imply a coverage it does not have. An honest
// partial gate beats a dishonest total one.

export type BashClass = "mutating" | "non-mutating";

export type CoveredPattern = {
  label: string;
  example: string;
  test(command: string): boolean;
};

/** A command word at the start of the string or after a shell separator. */
function commandWord(words: string[]): RegExp {
  return new RegExp(String.raw`(^|[;&|]|&&|\|\|)\s*(sudo\s+)?(${words.join("|")})\b`);
}

/**
 * Output redirection, excluding the fd-only forms. `2>&1` and `>&2` redirect a
 * descriptor, they do not create a file; treating them as writes would block
 * `npm test 2>&1`, which is the single most common harmless command there is.
 */
function redirectsToFile(command: string): boolean {
  const withoutFdDuplication = command.replace(/\d*>&\d+/g, "").replace(/&>/g, ">");
  // A `>` inside quotes is data, not redirection (`grep -rn 'a>b' src`).
  const unquoted = withoutFdDuplication.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  // The standard sinks discard output; they do not create a file. Counting
  // them as writes refused `grep … 2>/dev/null` and `cat … 2>/dev/null` — pure
  // reads — and a gate that blocks reading is a gate people turn off.
  const withoutSinks = unquoted.replace(/>>?\s*\/dev\/(null|stdout|stderr)\b/g, "");
  return />>?\s*\S/.test(withoutSinks);
}

export const COVERED_PATTERNS: CoveredPattern[] = [
  { label: "output redirection (`>`, `>>`), excluding fd-only forms like `2>&1`", example: "echo hi > f.txt", test: redirectsToFile },
  { label: "`tee`", example: "ls | tee out.txt", test: (c) => commandWord(["tee"]).test(c) || /\|\s*(sudo\s+)?tee\b/.test(c) },
  { label: "in-place editors (`sed -i`, `perl -i`)", example: "sed -i 's/a/b/' f.ts", test: (c) => /\b(sed|perl)\b[^;&|]*\s-i\b/.test(c) },
  { label: "movers and removers (`mv`, `cp`, `rm`, `rmdir`, `ln`, `install`, `dd`, `truncate`, `touch`, `mkdir`)", example: "rm -rf build", test: (c) => commandWord(["mv", "cp", "rm", "rmdir", "ln", "install", "dd", "truncate", "touch", "mkdir"]).test(c) },
  { label: "permission changes (`chmod`, `chown`)", example: "chmod +x run.sh", test: (c) => commandWord(["chmod", "chown"]).test(c) },
  { label: "`patch`", example: "patch -p1 < fix.diff", test: (c) => commandWord(["patch"]).test(c) },
  { label: "mutating `git` subcommands (`apply`, `checkout`, `restore`, `reset`, `commit`, `stash`, `clean`, `mv`, `rm`)", example: "git commit -m 'x'", test: (c) => /\bgit\s+(apply|checkout|restore|reset|commit|stash|clean|mv|rm)\b/.test(c) },
  { label: "package installers (`npm`/`pnpm`/`yarn`/`pip`/`cargo` install or add)", example: "npm install lodash", test: (c) => /\b(npm|pnpm|yarn|pip|pip3|cargo)\s+(install|add|i)\b/.test(c) },
  { label: "inline interpreters (`node -e`, `python -c`)", example: "node -e \"require('fs').writeFileSync('f','x')\"", test: (c) => /\b(node|deno|bun)\s+(-e|--eval)\b/.test(c) || /\bpython3?\s+-c\b/.test(c) },
  { label: "an interpreter running a script file as its first argument (`node script.js`, `deno run main.ts`)", example: "node script.js", test: (c) => runsScriptFile(c) },
];

/**
 * The mutation vectors this classifier does **not** catch. Shipped in README.md
 * beside the covered table, because a partial mechanism that presents itself as
 * total is how ODD ended up promising compliance while shipping delivery.
 */
/**
 * An interpreter invoked with a script file, which is the form a model reaches
 * for the moment `node -e` is refused.
 *
 * Quotes are stripped first, for the same reason `redirectsToFile` strips them:
 * an interpreter named inside quoted data is data. Grepping for `node app.js`
 * is a read, and a gate that refuses reads is a gate people turn off.
 *
 * The script must be the interpreter's *first* argument, or the first argument
 * after `run` — `deno run main.ts` and `bun run build.ts` are the only way to
 * execute a file with those runtimes. Flags are never skipped to find it:
 * scanning past them would classify `node --test test/x.test.ts`, this
 * project's own way of running one test file, as a write.
 */
function runsScriptFile(command: string): boolean {
  // Quotes do two opposite jobs here. A quoted run containing whitespace is
  // data — `grep -rn ';python3 gen.py' src` is a read — so it is blanked. A
  // quoted run without whitespace is just an argument someone quoted, which is
  // ordinary shell practice: `bash "script.sh"` is a write, and blanking it
  // would erase the filename and hide it. Whitespace is what tells them apart,
  // and getting this wrong either refuses reads or makes "add quotes" the
  // cheapest evasion in the product.
  const normalised = command.replace(/(['"])(.*?)\1/g, (_m, _q, inner: string) =>
    /\s/.test(inner) ? '""' : inner,
  );
  return /(^|[;&|])\s*(sudo\s+)?(node|deno|bun|python3?|ruby|perl|bash|sh|zsh)\b\s+(run\s+(--[\w-]+(=\S*)?\s+)*)?(?!-)\S*(\.(js|cjs|mjs|ts|mts|cts|py|sh|bash|rb|pl)|\/)/.test(normalised);
}

export const NOT_COVERED: string[] = [
  "a script run without naming an interpreter, or a build target: `./build.sh`, `make`, `npm run build`",
  "an interpreter whose script follows a flag, or is passed as a string: `node --import=./r.mjs app.js`, `bash -lc '…'`",
  "a script piped into an interpreter: `cat gen.py | python3`",
  "compilers, formatters and codegen writing as a side effect",
  "redirection hidden behind a variable or `eval`",
  "a pre-existing background process",
  "writes performed by other extensions' or MCP tools",
  "writes performed outside pi entirely",
  "a delegated child launched with its own `extensions:` list, which pi-subagents starts with `--no-extensions`",
];

export function classifyBash(command: string): BashClass {
  const text = (command ?? "").trim();
  if (!text) return "non-mutating";
  return COVERED_PATTERNS.some((pattern) => pattern.test(text)) ? "mutating" : "non-mutating";
}
