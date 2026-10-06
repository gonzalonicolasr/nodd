function blankQuotes(command: string): string {
  return command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

function segments(text: string): string[] {
  return text.split(/&&|\|\||[;|\n]/).map((segment) => segment.trim().replace(/^sudo\s+/, ""));
}

function outsideRoots(path: string, roots: readonly string[], home: string): boolean {
  if (!/^(\/|~|\$HOME)/.test(path)) return false;
  const expanded = home === "" ? path : path.replace(/^(~|\$HOME)(?=\/|$)/, home);
  if (/^(~|\$HOME)/.test(expanded)) return true;
  const clean = expanded.replace(/\/+$/, "");
  return !roots.some((root) => clean === root || clean.startsWith(`${root.replace(/\/+$/, "")}/`));
}

function rmOutside(segment: string, roots: readonly string[], home: string): string | null {
  const words = segment.split(/\s+/);
  if (words[0] !== "rm") return null;
  const flags = words.slice(1).filter((word) => word.startsWith("-")).join("");
  if (!/r/i.test(flags) || !/f/.test(flags)) return null;
  return words.slice(1).find((word) => !word.startsWith("-") && outsideRoots(word, roots, home)) ?? null;
}

const SQL_CLIENT = /^\s*(sudo\s+)?(\w+=\S*\s+)*(psql|mysql|mariadb|sqlite3|clickhouse-client)\b/;
const LOCAL_HOST = /(-h\s*|--host[= ])(127\.0\.0\.1|localhost)\b/;

export function destructiveReason(command: string, roots: readonly string[], home = ""): string | null {
  const syntax = blankQuotes(command ?? "");
  for (const segment of segments(syntax)) {
    if (/^git\s+reset\b.*--hard\b/.test(segment)) return "`git reset --hard` discards uncommitted work and moves the branch";
    if (/^git\s+clean\b.*\s-[a-zA-Z]*f/.test(segment)) return "`git clean -f` deletes untracked files for good";
    if (/^git\s+checkout\s+(--\s+)?\.(\s|$)/.test(segment)) return "`git checkout -- .` throws away every uncommitted change";
    if (/^git\s+restore\b/.test(segment) && !/--staged\b/.test(segment) && /\s(--\s+)?\.(\s|$)/.test(segment)) return "`git restore .` throws away every uncommitted change";
    if (/^terraform\s+destroy\b/.test(segment)) return "`terraform destroy` tears down real infrastructure";
    if (/^kubectl\s+delete\b/.test(segment)) return "`kubectl delete` removes cluster resources";
    const outside = rmOutside(segment, roots, home);
    if (outside) return `\`rm -rf ${outside}\` deletes outside the project`;
  }
  for (const line of (command ?? "").split(/\n|&&/)) {
    if (SQL_CLIENT.test(line) && !LOCAL_HOST.test(line) && /\b(drop\s+(table|database|schema)|truncate)\b/i.test(line)) {
      return "a DROP or TRUNCATE sent to a database that is not local";
    }
  }
  return null;
}
