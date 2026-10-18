import { classifyBash, commandHeads, type CommandHead } from "./bash-classifier.ts";
import { joinPath } from "./path.ts";

function assignments(command: string): Map<string, string> {
  const found = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const m of command.matchAll(/(?:^|[;&|\n(]\s*|\bexport\s+)([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|()]*)/g)) {
    const value = m[2].replace(/^(["'])(.*)\1$/, "$2");
    if (found.has(m[1]) && found.get(m[1]) !== value) ambiguous.add(m[1]);
    found.set(m[1], value);
  }
  for (const name of ambiguous) found.delete(name);
  return found;
}

function expander(vars: Map<string, string>): (text: string) => string {
  const once = (text: string) => text.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, a, b) => vars.get(a ?? b) ?? match);
  return (text) => once(once(text));
}

function quoteWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

const NAMED_WRITERS = new Set(["rm", "rmdir", "touch", "mkdir", "truncate", "tee", "chmod", "chown", "dd", "cp", "mv", "install", "ln", "sed", "perl"]);

/**
 * True when every write this command makes provably lands where `isInside`
 * says, and it makes at least one. A writer whose targets NODD cannot name
 * (an interpreter, `npm install`, a glob, a variable it cannot resolve) makes
 * the answer false: this is an exemption, so doubt keeps the gates on.
 * `onTarget` hears each real target, never the value of an assignment.
 */
export function writesOnlyUnder(command: string, isInside: (path: string) => boolean, onTarget?: (path: string) => void): boolean {
  if (classifyBash(command ?? "") !== "mutating") return false;
  const expand = expander(assignments(command));
  const place = (raw: string, dir: string | null): string | null => {
    const path = expand(raw);
    if (path === "" || /[$*?[\]`]/.test(path) || path.startsWith("~")) return null;
    if (path.startsWith("/")) return joinPath(path);
    return dir === null ? null : joinPath(dir, path);
  };
  let dir: string | null = null;
  const checked: string[] = [];
  for (const head of commandHeads(command)) {
    if (head.name === "cd") {
      dir = head.args[0] === undefined ? null : place(head.args[0], dir);
      continue;
    }
    const { targets, rest } = redirectTargets(head.args);
    const paths = [...targets];
    if (NAMED_WRITERS.has(head.name)) {
      paths.push(...(head.name === "ln" ? operands("ln", rest) : headTargets({ name: head.name, args: rest })));
    } else if (classifyBash([head.name, ...rest].map(quoteWord).join(" ")) === "mutating") {
      return false;
    }
    for (const raw of paths) {
      const where = place(raw, dir);
      if (where === null || !isInside(where)) return false;
      checked.push(where);
    }
  }
  if (checked.length === 0) return false;
  for (const path of checked) onTarget?.(path);
  return true;
}

const SINKS = /^(\/dev\/(null|stdout|stderr)|&\d*|-)$/;
const VALUE_FLAGS: Record<string, string[]> = { truncate: ["-s", "--size"], mkdir: ["-m", "--mode"], install: ["-m", "-o", "-g", "--mode", "--owner", "--group"], tee: [] };

function redirectTargets(args: string[]): { targets: string[]; rest: string[] } {
  const targets: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const glued = /^(\d|&)?>>?(.+)$/.exec(args[i]);
    if (glued && !glued[2].startsWith("&")) { targets.push(glued[2]); continue; }
    if (/^(\d|&)?>>?$/.test(args[i])) { if (args[i + 1] !== undefined) targets.push(args[++i]); continue; }
    rest.push(args[i]);
  }
  return { targets: targets.filter((t) => !SINKS.test(t)), rest };
}

function operands(name: string, args: string[]): string[] {
  const values = VALUE_FLAGS[name] ?? [];
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (values.includes(args[i])) { i += 1; continue; }
    if (!args[i].startsWith("-") || args[i] === "-") out.push(args[i]);
  }
  return out;
}

function headTargets(head: CommandHead): string[] {
  const { name, args } = head;
  const plain = operands(name, args);
  if (["rm", "rmdir", "touch", "mkdir", "truncate", "tee"].includes(name)) return plain;
  if (name === "chmod" || name === "chown") return plain.slice(1);
  if (name === "dd") return args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
  if (["cp", "mv", "install", "ln"].includes(name)) {
    const t = args.findIndex((a) => a === "-t" || a === "--target-directory");
    const glued = args.find((a) => a.startsWith("--target-directory="));
    const dir = glued?.slice(19) ?? (t >= 0 ? args[t + 1] : undefined);
    const sources = dir === undefined ? plain.slice(0, -1) : plain.filter((p) => p !== dir);
    const target = dir ?? plain[plain.length - 1];
    return [...(target === undefined ? [] : [target]), ...(name === "mv" ? sources : [])];
  }
  if ((name === "sed" || name === "perl") && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
    const script = ["-e", "-f", "--expression", "--file"];
    const files = operands(name, args.filter((a, i) => !script.includes(a) && !script.includes(args[i - 1])));
    return args.some((a) => script.includes(a)) ? files : files.slice(1);
  }
  return [];
}

/**
 * The paths a bash command writes, when its shape names them: redirections,
 * the operands of the covered movers and removers, `-t DIR`, `dd of=`, and the
 * files of an in-place `sed`/`perl`. Relative paths resolve against `cwd` and
 * any `cd` before them; a path NODD cannot pin down (a variable, a glob) is
 * left out, because a guess here would refuse or excuse the wrong file.
 */
export function bashWriteTargets(command: string, cwd: string): string[] {
  let dir: string | null = cwd;
  const found: string[] = [];
  for (const head of commandHeads(command ?? "")) {
    if (head.name === "cd") {
      const to = head.args[0];
      dir = to === undefined || /[$*?[\]`]/.test(to) || to.startsWith("~") ? null : to.startsWith("/") ? joinPath(to) : dir === null ? null : joinPath(dir, to);
      continue;
    }
    const { targets, rest } = redirectTargets(head.args);
    for (const path of [...targets, ...headTargets({ name: head.name, args: rest })]) {
      if (/[$*?[\]`]/.test(path) || path === "" || path.startsWith("~")) continue;
      if (path.startsWith("/")) found.push(joinPath(path));
      else if (dir !== null && dir !== "") found.push(joinPath(dir, path));
    }
  }
  return [...new Set(found)];
}
