const COPY_LAST = new Set(["cp", "mv", "install", "ln", "rsync"]);
const ALL_ARGS = new Set(["tee", "touch", "truncate", "rm", "patch"]);
const REDIRECT = /(?<![<>=-])(?:\d|&)?>>?(?!&)\s*/g;
const TARGET = /^("[^"]*"|'[^']*'|[^\s;&|<>()]+)/;
const SCRATCH = /^\/(tmp|dev)\//;
const GIT_CODE = /^git\s+(?:-C\s+\S+\s+)?(?:-\S+\s+)*(?:(apply|am|merge|rebase|cherry-pick|pull|restore|revert)(?![\w-])|reset\s+--hard|checkout\s+(?:-\S+\s+)*--(?:\s|$))/;
const FORMATTER = /\b(eslint\b[^|;&]*--fix|prettier\b[^|;&]*(--write|-w\b)|biome\b[^|;&]*(--write|--apply)|ruff\b[^|;&]*(--fix|\bformat\b)|black\s|isort\s|gofmt\b[^|;&]*-w|goimports\b[^|;&]*-w|cargo\s+fmt|rustfmt\s)/;
const INTERPRETER = /^(python3?|node|deno|bun|ruby|perl)$/;
const WRITE_CALL = /\bopen\([^)]*,\s*['"][wax]|\.write_(text|bytes)\(|\b(writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|renameSync|unlinkSync|rmSync)\(|\bshutil\.|\bos\.(replace|rename|remove|unlink)\(/;
const OPEN_TARGET = /\bopen\(\s*(['"])([^'"]+)\1\s*,\s*['"][wax]/g;
const PATH_STRING = /(['"])([^'"\s]*\.[A-Za-z0-9]{1,8})\1/g;
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;

type Segment = { text: string; syntax: string; body: string | null };

const blank = (text: string) => text.replace(/[^\n]/g, " ");

function split(command: string): Segment[] {
  const lines = command.split("\n");
  const heredocs: Array<{ at: number; body: string }> = [];
  let masked = "";
  for (let i = 0; i < lines.length; i += 1) {
    const opener = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(lines[i]);
    if (opener) heredocs.push({ at: masked.length + opener.index, body: "" });
    masked += lines[i] + (i < lines.length - 1 ? "\n" : "");
    if (!opener) continue;
    const end = lines.findIndex((line, at) => at > i && line.trim() === opener[2]);
    const stop = end === -1 ? lines.length - 1 : end;
    heredocs[heredocs.length - 1].body = lines.slice(i + 1, end === -1 ? lines.length : end).join("\n");
    for (let j = i + 1; j <= stop; j += 1) masked += blank(lines[j]) + (j < lines.length - 1 ? "\n" : "");
    i = stop;
  }
  const syntax = masked.replace(QUOTED, (match: string, at: number) =>
    /[<>]\s*$/.test(masked.slice(0, at)) ? match.replace(/\n/g, " ") : blank(match).replace(/\n/g, " "));
  const found: Segment[] = [];
  let from = 0;
  const cut = (to: number) => {
    found.push({
      text: command.slice(from, to),
      syntax: syntax.slice(from, to),
      body: heredocs.find((doc) => doc.at >= from && doc.at < to)?.body ?? null,
    });
  };
  for (const match of syntax.matchAll(/&&|\|\||[;|\n]/g)) {
    cut(match.index);
    from = match.index + match[0].length;
  }
  cut(command.length);
  return found;
}

function unquote(word: string): string {
  return word.replace(/^(["'])(.*)\1$/s, "$2");
}

function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
}

function join(dir: string, path: string): string {
  const kept: string[] = [];
  for (const part of `${dir}/${path}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") kept.pop();
    else kept.push(part);
  }
  return `/${kept.join("/")}`;
}

export function bashChangesCode(command: string, isHarmless: (path: string) => boolean, home = ""): boolean {
  let dir = "";
  const vars = new Map<string, string>(home ? [["HOME", home]] : []);
  const expand = (text: string) => text.replace(/^~(?=\/|$)/, home || "~").replace(/\$\{(\w+)\}|\$(\w+)/g, (match, a, b) => vars.get(a ?? b) ?? match);
  const resolve = (path: string) => {
    const full = expand(path);
    return full.startsWith("/") || full.startsWith("$") || dir === "" ? full : join(dir, full);
  };
  const isCode = (path: string) => {
    const full = resolve(path);
    return !SCRATCH.test(full) && !isHarmless(full);
  };

  for (const segment of split(command ?? "")) {
    const lead = segment.syntax.length - segment.syntax.trimStart().length;
    let text = segment.text.slice(lead).trimEnd();
    let syntax = segment.syntax.slice(lead).trimEnd();
    const strip = (pattern: RegExp) => {
      const match = pattern.exec(syntax);
      if (!match) return;
      text = text.slice(match[0].length);
      syntax = syntax.slice(match[0].length);
    };
    strip(/^[({]\s*/);
    strip(/^sudo\s+/);
    const assignment = /^(?:export\s+)?([A-Za-z_]\w*)=(\S*)$/.exec(syntax);
    if (assignment) {
      vars.set(assignment[1], expand(unquote(text.slice(text.indexOf("=") + 1).trim())));
      continue;
    }
    strip(/^(?:[A-Za-z_]\w*=\S*\s+)+/);
    if (syntax === "") continue;
    if (/^cd(\s|$)/.test(syntax)) {
      const target = text.slice(2).trim().replace(/[)}]$/, "").trim();
      dir = target ? resolve(unquote(target)) : home;
      continue;
    }
    const targets: string[] = [];
    let plain = text;
    for (const match of [...syntax.matchAll(REDIRECT)].reverse()) {
      const start = match.index + match[0].length;
      const target = TARGET.exec(text.slice(start))?.[1];
      if (!target) continue;
      targets.push(unquote(target));
      plain = plain.slice(0, match.index) + " ".repeat(match[0].length + target.length) + plain.slice(start + target.length);
    }
    if (targets.some(isCode)) return true;
    const [head = "", ...args] = words(plain);
    const name = head.split("/").pop() ?? "";
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (COPY_LAST.has(name) && paths.length > 0 && isCode(paths[paths.length - 1])) return true;
    if (ALL_ARGS.has(name) && paths.some(isCode)) return true;
    if ((name === "sed" || name === "perl") && args.some((arg) => /^-(\w*i|-in-place)/.test(arg))) {
      const files = args.includes("-e") ? paths : paths.slice(1);
      if (files.some(isCode)) return true;
    }
    if (GIT_CODE.test(syntax) || (FORMATTER.test(syntax) && !/--check\b/.test(syntax))) return true;
    if (INTERPRETER.test(name)) {
      const inline = args.findIndex((arg) => arg === "-c" || arg === "-e");
      const code = segment.body ?? (inline === -1 ? null : args[inline + 1] ?? "");
      if (code === null || !WRITE_CALL.test(code)) continue;
      const opened = [...code.matchAll(OPEN_TARGET)].map((match) => match[2]);
      const known = new Map([...code.matchAll(/^\s*(?:const\s+|let\s+)?([A-Za-z_]\w*)\s*=\s*(['"])([^'"\n]*)\2\s*;?\s*$/gm)].map((match) => [match[1], match[3]]));
      const joined = [...code.matchAll(/\b(?:open|Path|writeFileSync|appendFileSync)\(\s*([A-Za-z_]\w*)\s*\+\s*(['"])([^'"\n]+)\2/g)].map((match) => known.has(match[1]) ? known.get(match[1])! + match[3] : null);
      const loose = [...code.matchAll(PATH_STRING)]
        .filter((match) => !/\+\s*$/.test(code.slice(0, match.index)) && !/^\s*\+/.test(code.slice(match.index + match[0].length)))
        .map((match) => match[2]);
      if (joined.includes(null) && opened.length === 0) return true;
      const named = opened.length > 0 ? opened : [...loose, ...joined.filter((path): path is string => path !== null)];
      if (named.length === 0 || named.some(isCode)) return true;
    }
  }
  return false;
}
