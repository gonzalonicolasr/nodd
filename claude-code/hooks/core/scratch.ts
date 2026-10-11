import { classifyBash } from "./bash-classifier.ts";

const ALL_ARGS = new Set(["mkdir", "touch", "rm", "rmdir", "tee", "chmod", "chown", "truncate"]);
const LAST_ARG = new Set(["cp", "install", "ln"]);
const REDIRECT = /(?<![<>])(?:\d|&)?>>?(?!&)\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/g;
const SINK = /^\/dev\/(null|stdout|stderr)$/;

function withoutHeredocBodies(command: string): string {
  const lines = command.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const opener = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(lines[i]);
    if (!opener) continue;
    const end = lines.findIndex((line, at) => at > i && line.trim() === opener[2]);
    if (end === -1) return command;
    i = end;
  }
  return kept.join("\n");
}

function unquote(word: string): string {
  return word.replace(/^(["'])(.*)\1$/, "$2");
}

function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
}

export function writesOnlyUnder(command: string, isInside: (path: string) => boolean): boolean {
  if (classifyBash(command ?? "") !== "mutating") return false;
  const inside = (path: string) => !/(^|\/)\.\.(\/|$)/.test(path) && isInside(path);
  const vars = new Map<string, string>();
  const expand = (text: string) => text.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, a, b) => vars.get(a ?? b) ?? match);
  let wrote = false;
  for (const raw of withoutHeredocBodies(command ?? "").split(/&&|\|\||[;\n]|\|/)) {
    const segment = raw.trim().replace(/^sudo\s+/, "");
    if (segment === "") continue;
    const assignment = /^(?:export\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S*)$/.exec(segment);
    if (assignment) {
      const value = expand(unquote(assignment[2]));
      if (inside(value)) vars.set(assignment[1], value);
      else vars.delete(assignment[1]);
      continue;
    }
    if (classifyBash(segment) !== "mutating") continue;
    wrote = true;
    const resolved = expand(segment);
    const targets = [...resolved.matchAll(REDIRECT)].map((match) => unquote(match[1])).filter((path) => !SINK.test(path));
    if (!targets.every(inside)) return false;
    const rest = resolved.replace(REDIRECT, " ");
    const [head = "", ...args] = words(rest);
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (ALL_ARGS.has(head)) {
      if (paths.length === 0 || !paths.every(inside)) return false;
    } else if (LAST_ARG.has(head)) {
      if (paths.length === 0 || !inside(paths[paths.length - 1])) return false;
    } else if (classifyBash(rest) === "mutating" || targets.length === 0) {
      return false;
    }
  }
  return wrote;
}
