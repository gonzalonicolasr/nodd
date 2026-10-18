import { commandHeads, gitSubcommand, type CommandHead } from "./bash-classifier.ts";
import { joinPath } from "./path.ts";

function placed(path: string, cwd: string, home: string): string | null {
  const expanded = home === "" ? path : path.replace(/^(~|\$HOME)(?=\/|$)/, home);
  if (/^(~|\$)/.test(expanded)) return /^(~|\$HOME)/.test(expanded) ? expanded : null;
  return joinPath(expanded.startsWith("/") ? "" : cwd, expanded);
}

function harmful(path: string, roots: readonly string[], rootItself: boolean): boolean {
  if (/^(~|\$HOME)/.test(path)) return true;
  const clean = path.replace(/\/+$/, "") || "/";
  return !roots.some((root) => {
    const base = root.replace(/\/+$/, "");
    return clean.startsWith(`${base}/`) || (!rootItself && clean === base);
  });
}

function deletedOutside(head: CommandHead, cwd: string, roots: readonly string[], home: string): string | null {
  const target = (words: string[], rootItself: boolean) => words.find((word) => {
    const where = placed(word, cwd, home);
    return where !== null && harmful(where, roots, rootItself);
  }) ?? null;
  if (head.name === "rm") {
    const flags = head.args.filter((word) => word.startsWith("-"));
    const recursive = flags.some((f) => f === "--recursive" || /^-[a-zA-Z]*[rR]/.test(f));
    const force = flags.some((f) => f === "--force" || /^-[a-zA-Z]*f/.test(f));
    if (!recursive || !force) return null;
    const hit = target(head.args.filter((word) => !word.startsWith("-")), true);
    return hit && `\`rm -rf ${hit}\` deletes outside the project`;
  }
  if (head.name === "find") {
    const deletes = head.args.some((a, i) => a === "-delete" || ["-exec", "-execdir", "-ok", "-okdir"].includes(a) && /(^|\/)rm$/.test(head.args[i + 1] ?? ""));
    if (!deletes) return null;
    const starts = head.args.slice(0, Math.max(0, head.args.findIndex((a) => /^[-(!]/.test(a))));
    const hit = target(starts.length > 0 ? starts : ["."], false);
    return hit && `\`find ${hit} … -delete\` deletes outside the project`;
  }
  return null;
}

function gitReason(head: CommandHead): string | null {
  const sub = head.name === "git" ? gitSubcommand(head.args) : null;
  if (!sub) return null;
  const rest = ` ${sub.rest.join(" ")} `;
  if (sub.name === "reset" && rest.includes(" --hard ")) return "`git reset --hard` discards uncommitted work and moves the branch; `git reset --keep <ref>` moves it the same way but refuses instead of discarding";
  if (sub.name === "clean" && sub.rest.some((a) => a === "--force" || /^-[a-zA-Z]*f/.test(a))) return "`git clean -f` deletes untracked files for good; `git clean -n` lists them first";
  if (sub.name === "checkout" && /^ (-- )?\. /.test(rest)) return "`git checkout -- .` throws away every uncommitted change; `git stash` keeps them recoverable";
  if (sub.name === "restore" && !sub.rest.includes("--staged") && / (-- )?\. /.test(rest)) return "`git restore .` throws away every uncommitted change; `git stash` keeps them recoverable";
  return null;
}

const SQL_CLIENT = /^\s*(sudo\s+)?(\w+=\S*\s+)*(psql|mysql|mariadb|sqlite3|clickhouse-client)\b/;
const LOCAL_HOST = /(-h\s*|--host[= ])(127\.0\.0\.1|localhost)\b/;

export function destructiveReason(command: string, roots: readonly string[], home = "", cwd = roots[0] ?? "/"): string | null {
  let dir = cwd;
  for (const head of commandHeads(command ?? "")) {
    if (head.name === "cd") {
      const where = head.args[0] === undefined ? home : placed(head.args[0], dir, home);
      if (where) dir = where;
      continue;
    }
    const git = gitReason(head);
    if (git) return git;
    if (head.name === "terraform" && head.args[0] === "destroy") return "`terraform destroy` tears down real infrastructure";
    if (head.name === "kubectl" && head.args[0] === "delete") return "`kubectl delete` removes cluster resources";
    const outside = deletedOutside(head, dir, roots, home);
    if (outside) return outside;
  }
  for (const line of (command ?? "").split(/\n|&&/)) {
    if (SQL_CLIENT.test(line) && !LOCAL_HOST.test(line) && /\b(drop\s+(table|database|schema)|truncate)\b/i.test(line)) {
      return "a DROP or TRUNCATE sent to a database that is not local";
    }
  }
  return null;
}
