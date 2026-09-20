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
  /** True when the pattern parses quotes itself and needs the raw command. */
  tokenises?: boolean;
  test(command: string): boolean;
};

/**
 * Blank the contents of quoted runs, keeping the quotes as empty markers.
 *
 * Quoted text is data, not syntax: `grep -rn 'then install' docs/` is a read
 * and `grep -rn 'a>b' src` is a read. Every pattern here matches against the
 * blanked form, because a gate that refuses reads is a gate people turn off.
 */
function blankQuotedData(command: string): string {
  return command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/**
 * A command word at the start of the string or after a shell separator.
 *
 * A newline separates commands exactly as `;` does, and a multi-line block is
 * the ordinary shape of agent work — without it, everything after line one was
 * invisible to every pattern here, not just the interpreter row. `then`, `do`
 * and `{` open a command for the same reason.
 */
function commandWord(words: string[]): RegExp {
  return new RegExp(
    String.raw`(^|[;&|\n({]|&&|\|\||\bthen\b|\bdo\b)\s*(sudo\s+)?(${words.join("|")})\b`,
  );
}

/**
 * Output redirection, excluding the fd-only forms. `2>&1` and `>&2` redirect a
 * descriptor, they do not create a file; treating them as writes would block
 * `npm test 2>&1`, which is the single most common harmless command there is.
 */
function redirectsToFile(command: string): boolean {
  const withoutFdDuplication = command.replace(/\d*>&\d+/g, "").replace(/&>/g, ">");
  // A `>` inside quotes is data, not redirection (`grep -rn 'a>b' src`).
  const unquoted = blankQuotedData(withoutFdDuplication);
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
  { label: "an interpreter running a script file as its first argument (`node script.js`, `deno run main.ts`)", example: "node script.js", tokenises: true, test: (c) => runsScriptFile(c) },
];

/**
 * The mutation vectors this classifier does **not** catch. Shipped in README.md
 * beside the covered table, because a partial mechanism that presents itself as
 * total is how ODD ended up promising compliance while shipping delivery.
 */
const WRAPPERS = new Set([
  "sudo", "env", "time", "nohup", "nice", "xargs", "command", "exec", "setsid", "timeout", "stdbuf",
]);
const INTERPRETERS = new Set(["node", "deno", "bun", "python", "python3", "ruby", "perl", "bash", "sh", "zsh"]);
const SCRIPT_FILE = /\.(js|cjs|mjs|ts|mts|cts|py|sh|bash|rb|pl)$|\//;

/**
 * Split a command into tokens, keeping a quoted run — spaces and all — as one
 * token, and remembering where each one started.
 *
 * Content cannot tell a grep needle from a script path: `'my script.sh'` is
 * both the shape of a pattern and the shape of a real filename. Position can.
 * So the tokens carry whether they open a command, and nothing else is guessed.
 */
function tokenise(command: string): { text: string; startsCommand: boolean }[] {
  const tokens: { text: string; startsCommand: boolean }[] = [];
  let text = "";
  let quote: string | null = null;
  let startsCommand = true;
  let pendingBreak = true;

  const flush = () => {
    if (text === "") return;
    tokens.push({ text, startsCommand });
    text = "";
    startsCommand = false;
    pendingBreak = false;
  };

  let escaped = false;
  for (const ch of command) {
    if (escaped) { text += ch; escaped = false; continue; }
    if (ch === "\\" && !quote) { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else text += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    // `(`, `)` and a backtick open a command just as `;` does: a subshell is
    // still a place where an interpreter can be the command word.
    if (";&|()`{}\n".includes(ch)) { flush(); pendingBreak = true; startsCommand = true; continue; }
    if (/\s/.test(ch)) { flush(); startsCommand = pendingBreak; continue; }
    text += ch;
  }
  flush();
  return tokens;
}

/**
 * An interpreter invoked with a script file, which is the form a model reaches
 * for the moment `node -e` is refused.
 *
 * The interpreter must be a **command word** — the start of the command line or
 * of a `;`/`&&`/`|` segment. An interpreter's name inside someone else's
 * argument is data: `grep -rn ';node' src/` is a read, and a gate that refuses
 * reads is a gate people turn off.
 *
 * The script must be the interpreter's first argument, or the first argument
 * after `run` and its flags — `deno run main.ts` is the only way to execute a
 * file with that runtime. Flags are never skipped for a bare interpreter:
 * scanning past them would classify `node --test test/x.test.ts`, this
 * project's own way of running one test file, as a write.
 */
function runsScriptFile(command: string): boolean {
  const tokens = tokenise(command);
  for (let i = 0; i < tokens.length; i += 1) {
    let head = tokens[i];
    // `then` and `do` are keywords, not commands: what follows them starts one.
    if (!head.startsCommand && !["then", "do"].includes(tokens[i - 1]?.text ?? "")) continue;
    // A prefix that runs its argument is transparent: `env node x.js` is
    // `node x.js`. `env`'s VAR=value assignments are skipped with it.
    // A wrapper is recognised by basename too: `/usr/bin/env node x.js`.
    const baseOf = (t: string) => t.slice(t.lastIndexOf("/") + 1);
    while (WRAPPERS.has(baseOf(head.text)) && tokens[i + 1]) {
      head = tokens[++i];
      // `timeout 10 node …` and `nice -n 10 node …` take an argument of their
      // own before the command they run.
      if (baseOf(head.text) === "env" || head.text.includes("=")) continue;
      if (/^\d+[smhd]?$/.test(head.text) && tokens[i + 1]) { head = tokens[++i]; continue; }
      break;
    }
    while (head.text.includes("=") && !head.text.startsWith("-") && tokens[i + 1]) head = tokens[++i];
    // `/usr/bin/env node x.js` is the most ordinary interpreter line there is,
    // so an interpreter is recognised by the last path segment of its command
    // word. `/usr/bin/grep` is unaffected: grep is not an interpreter.
    if (!INTERPRETERS.has(baseOf(head.text))) continue;

    let arg = tokens[i + 1];
    if (arg?.text === "run") {
      let k = i + 2;
      while (tokens[k]?.text.startsWith("--")) k += 1;
      arg = tokens[k];
    }
    // A flag is not a script, and its own value is not one either.
    if (arg?.text === "--") arg = tokens[i + 2];
    if (!arg || arg.text.startsWith("-")) continue;
    if (SCRIPT_FILE.test(arg.text)) return true;
  }
  return false;
}

export const NOT_COVERED: string[] = [
  "a script run without naming an interpreter, or a build target: `./build.sh`, `make`, `npm run build`",
  "an interpreter whose script follows a bare flag, or is passed as a string: `node --import=./r.mjs app.js`, `bash -lc '…'` (flags after `run` *are* covered: `deno run --allow-write main.ts`)",
  "a script piped into an interpreter: `cat gen.py | python3`, or an argument NODD cannot see is a file: `node x` (no extension, no path)",
  "an interpreter reached through a variable or an alias: `I=node; $I x.js`",
  "a wrapper carrying its own flag before the command: `nice -n 10 node x.js`, `sudo -u root node x.js`",
  "a covered word inside a comment, or inside a heredoc body: `ls` then `# rm later`",
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
  // Patterns see the command with quoted data blanked out. `redirectsToFile`
  // has done this since it was written; `commandWord` did not, and once `\n`,
  // `(`, `{`, `then` and `do` became separators, that blind spot turned every
  // covered word inside a string or a comment into a refusal.
  // The interpreter row is exempt: it tokenises quotes itself, and needs the
  // filename in `bash "my script.sh"` to survive. Every other row is a regex
  // that cannot tell data from syntax on its own.
  const syntax = blankQuotedData(text);
  return COVERED_PATTERNS.some((pattern) =>
    pattern.tokenises ? pattern.test(text) : pattern.test(syntax),
  )
    ? "mutating"
    : "non-mutating";
}
