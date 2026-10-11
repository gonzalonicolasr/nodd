import type { Committed } from "./state.ts";
import { isDeclaredRunner, masksExitStatus, splitCd, writesByBash } from "./gates/evidence.ts";
import { describeOutcome, isSuccess, parseOutcome } from "./outcome.ts";
import { isDeclaredPath } from "./gates/request.ts";
import { testCounts } from "./test-counts.ts";
import { writesOnlyUnder } from "./scratch.ts";

export type TestEdit = { path: string; seq: number; addedMarkers: string[]; droppedAssertions: number };

export type CloseInput = {
  committed: Committed;
  since: number;
  slug: string | null;
  runner: string | null;
  declaredFiles: string[];
  answer: string;
  testEdits: TestEdit[];
  home?: string;
};

export type CloseReport = { line: string; warnings: string[]; verified: boolean };

const MARKER = /\.(skip|only|todo)\(|\bx(it|describe|test)\(|\bf(it|describe)\(|\bt\.Skip(Now|f)?\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip/g;
const ASSERTION = /\bexpect\s*\(|\bassert\w*\s*[(.\s]|\bt\.(Error|Fatal)f?\s*\(|\brequire\.\w+\s*\(/g;
const CLAIM_TESTS = /\b(pasan (los |todos los )?(\d+ )?tests?|(los |todos los |\d+ )?tests (pasan|pasaron|pass(es|ed)?|passing|en verde|verdes)|(suite|todo) (en )?verde|all (the )?tests pass(ed)?|all green|veredicto:\s*pasa)\b/gi;
const CLAIM_DONE = /(^|\n)\s*[*#>-]*\s*(listo|lista|hecho|done|fixed)\b(?!\s+(de|para|los|las|el|la|que)\b)|\b(está|quedó|quedaron|queda|quedan)\s+(listo|lista|listos|listas|arreglad[oa]s?|resuelt[oa]s?|terminad[oa]s?|funcionando)\b|\b(it works|now works|is fixed|is done)\b/gi;
const NEGATED = /\b(no|not|ni|sin|nunca|never)\b[^.!?\n]{0,20}$/i;
const TEST_RUN = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(node|deno|bun)\s+(--)?test\b|\b(pytest|vitest|jest|rspec|phpunit|tox|nox)\b|\bgo\s+test\b|\bcargo\s+test\b|\bmvn\s+\S*\s*test\b|\bgradlew?\s+\S*test\b|\bmake\s+test\b|\bclaude\s+plugin\s+test\b|\bgh\s+pr\s+checks\b|\bgh\s+run\s+watch\b[^\n]*--exit-status|[\w./-]*_test\.sh\b|\btest_[\w-]*\.py\b/;
const ARTIFACT = /(^|\/)(\.next|dist|build|coverage|node_modules|target|__pycache__|\.cache|\.turbo|out)(\/|$)/;
const PATH_LITERAL = /["']((?:~|\.{0,2}\/|\/)[^"'\s]*\.[A-Za-z0-9]+)["']/g;
const OTHER_WRITES = /\bsubprocess\b|\bshutil\b|\bos\.(remove|rename|replace|system|makedirs|mkdir|unlink)\b|\bchild_process\b|writeFileSync|\bsed\s+-i\b/;
const STRING = /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g;
const AGENT_OWN = /^\/tmp\/claude-\d+\/|\/\.claude[^/]*\//;
const HARMLESS = (path: string) => AGENT_OWN.test(path) || ARTIFACT.test(path) || /\.(md|mdx|txt|rst|adoc|png|jpe?g|gif|svg|webp)$/i.test(path);

function withoutData(command: string): string {
  const lines = command.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const opener = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(lines[i]);
    if (!opener) continue;
    const end = lines.findIndex((line, at) => at > i && line.trim() === opener[2]);
    if (end === -1) break;
    i = end;
  }
  return kept.join("\n").replace(STRING, '""');
}

function isTestRun(command: string): boolean {
  return TEST_RUN.test(splitCd(withoutData(command)).rest);
}

function onlyTouchesHarmless(command: string): boolean {
  if (OTHER_WRITES.test(command)) return false;
  const paths = [...command.matchAll(PATH_LITERAL)].map((match) => match[1]);
  return paths.length > 0 && paths.every(HARMLESS);
}

type RunnerView = { command: string; runner: string };

function runnerView(command: string, runner: string): RunnerView | null {
  if (isDeclaredRunner(command, runner)) return { command, runner };
  const segments = splitCd(runner).rest.split("&&").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2) return null;
  const tail = segments[segments.length - 1];
  const parts = command.split(/&&|;|\n/);
  for (let i = 0; i < parts.length; i += 1) {
    const rest = parts.slice(i).join("&&").trim();
    if (isDeclaredRunner(rest, tail)) return { command: rest, runner: tail };
  }
  return null;
}

function claimIn(text: string, pattern: RegExp): string | undefined {
  for (const match of text.matchAll(pattern)) {
    if (!NEGATED.test(text.slice(Math.max(0, match.index - 30), match.index))) return match[0];
  }
  return undefined;
}

export function isTestFile(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(path)
    || /[._](test|spec)\.[cm]?[jt]sx?$/.test(path)
    || /_test\.(go|py)$/.test(path)
    || /(^|\/)test_[^/]+\.py$/.test(path);
}

function counts(text: string, pattern: RegExp): Map<string, number> {
  const found = new Map<string, number>();
  for (const match of text.matchAll(pattern)) found.set(match[0], (found.get(match[0]) ?? 0) + 1);
  return found;
}

function total(found: Map<string, number>): number {
  return [...found.values()].reduce((sum, count) => sum + count, 0);
}

export function testEditSignals(oldText: string, newText: string): { addedMarkers: string[]; droppedAssertions: number } {
  const before = counts(oldText.replace(STRING, '""'), MARKER);
  const after = counts(newText.replace(STRING, '""'), MARKER);
  const addedMarkers = [...after].filter(([marker, count]) => count > (before.get(marker) ?? 0)).map(([marker]) => marker);
  const droppedAssertions = Math.max(0, total(counts(oldText, ASSERTION)) - total(counts(newText, ASSERTION)));
  return { addedMarkers, droppedAssertions };
}

function isPartial(command: string, runner: string): boolean {
  let rest = splitCd(command).rest;
  for (const token of splitCd(runner).rest.trim().split(/\s+/)) rest = rest.trimStart().slice(token.length);
  const own = rest.split("&&")[0];
  return own.replace(/\s*\d*&?>>?&?\s*\S+/g, "").trim() !== "";
}

type Verdict = "green" | "red" | null;

function hiddenVerdict(command: string, output: string): Verdict {
  const echo = /echo\s+["']?([^"'$\n]*)\$\?/.exec(command);
  if (echo) {
    const prefix = echo[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const code = new RegExp(`${prefix}\\s*(\\d+)`).exec(output)?.[1];
    if (code !== undefined) return code === "0" ? "green" : "red";
  }
  if (/^(--- FAIL|FAIL\s)/m.test(output)) return "red";
  if (/^ok\s+\S+/m.test(output)) return "green";
  const count = testCounts(output);
  if (!count) return null;
  if (count.failed > 0) return "red";
  return count.passed > 0 ? "green" : null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function closeReport(input: CloseInput): CloseReport | null {
  const { committed, since, runner } = input;
  const written = [...committed.filesWritten].filter(([, write]) => write.seq > since);
  const runs = committed.commandResults.filter((run) => run.seq > since);
  const bashWrites = runs.filter((run) => writesByBash(run.command, runner) && !isTestRun(run.command));
  if (written.length === 0 && bashWrites.length === 0) return null;

  const codeWritten = written.filter(([path]) => !HARMLESS(path));
  const codeBash = bashWrites.filter((run) => !writesOnlyUnder(run.command, HARMLESS) && !onlyTouchesHarmless(run.command));
  const codeChanged = codeWritten.length > 0 || codeBash.length > 0;
  const lastWrite = codeChanged ? Math.max(...codeWritten.map(([, write]) => write.seq), ...codeBash.map((run) => run.seq)) : since;
  const views = new Map(runs.map((run) => [run, runner === null ? null : runnerView(run.command, runner)]));
  const runnerRuns = runner === null ? [] : runs.filter((run) => views.get(run) !== null);
  const view = (run: (typeof runs)[number]) => views.get(run)!;
  const after = runnerRuns.filter((run) => run.seq > lastWrite);
  const trusted = after.filter((run) => !masksExitStatus(view(run).command, view(run).runner));
  const last = trusted[trusted.length - 1];
  const lastOutcome = last ? parseOutcome(last.isError, last.resultText) : null;
  const masked = (run: (typeof runs)[number]) => {
    const rest = splitCd(run.command).rest;
    return masksExitStatus(rest, rest.split(/\s+/)[0]);
  };
  const verdictOf = (run: (typeof runs)[number]): Verdict => masked(run) ? hiddenVerdict(run.command, run.resultText) : isSuccess(parseOutcome(run.isError, run.resultText)) ? "green" : "red";
  const testRuns = runner !== null ? [] : runs.filter((run) => run.seq > lastWrite && isTestRun(run.command));
  const testRun = [...testRuns].reverse().find((run) => verdictOf(run) !== null) ?? testRuns[testRuns.length - 1];
  const testRunMasked = testRun !== undefined && masked(testRun);
  const testRunGreen = testRun !== undefined && verdictOf(testRun) === "green";
  const hiddenLast = runner !== null && after.length > 0 && after[after.length - 1] !== last ? after[after.length - 1] : undefined;
  const hiddenGreen = hiddenLast !== undefined && hiddenVerdict(hiddenLast.command, hiddenLast.resultText) === "green" && !isPartial(view(hiddenLast).command, view(hiddenLast).runner);
  const verified = runner === null ? testRunGreen : hiddenGreen || (hiddenLast === undefined && lastOutcome !== null && isSuccess(lastOutcome) && !isPartial(view(last).command, view(last).runner));

  let status: string;
  if (!codeChanged) status = "sólo docs o archivos del agente: nada que verificar";
  else if (runner === null && testRunGreen) status = `✓ \`${testRun!.command}\` verde${testRunMasked ? " según el resumen (el exit status quedó escondido)" : ""} (sin runner declarado)`;
  else if (hiddenGreen) status = `✓ \`${hiddenLast!.command}\` verde según el resumen (el exit status quedó escondido)`;
  else if (runner === null && testRun && testRunMasked) status = `\`${testRun.command}\` escondió su exit status y su salida no confirma un verde (sin runner declarado)`;
  else if (runner === null && testRun) status = `✗ \`${testRun.command}\` → ${describeOutcome(parseOutcome(testRun.isError, testRun.resultText))} (sin runner declarado)`;
  else if (runner === null) status = "sin runner declarado: NODD no puede decir si esto quedó verificado";
  else if (hiddenLast || (!last && after.length > 0)) status = `\`${after[after.length - 1].command}\` escondió su exit status y su salida no confirma un verde`;
  else if (!last) status = `\`${runner}\` sin correr después de la última escritura`;
  else if (!isSuccess(lastOutcome!)) status = `✗ \`${last.command}\` → ${describeOutcome(lastOutcome!)}`;
  else if (isPartial(view(last).command, view(last).runner)) status = `verde parcial: \`${last.command}\`, no la suite declarada (\`${runner}\`)`;
  else {
    const count = testCounts(last.resultText);
    status = `✓ \`${last.command}\` verde${count ? ` (${count.passed} tests)` : ""} después de la última escritura`;
  }

  const warnings: string[] = [];
  const testClaim = codeChanged ? claimIn(input.answer, CLAIM_TESTS) : undefined;
  const claim = codeChanged ? testClaim ?? claimIn(input.answer, CLAIM_DONE) : undefined;
  if (runner !== null && claim && !verified) {
    warnings.push(`la respuesta afirma «${claim}», pero NODD no vio \`${runner}\` completo y verde después de la última escritura`);
  } else if (runner === null && testClaim && !verified) {
    warnings.push(`la respuesta afirma «${testClaim}», pero no se vio ninguna corrida de tests verde después de la última escritura`);
  }

  if (verified && runner !== null && !hiddenGreen) {
    const full = runnerRuns
      .filter((run) => !masksExitStatus(view(run).command, view(run).runner) && !isPartial(view(run).command, view(run).runner))
      .map((run) => ({ run, count: testCounts(run.resultText) }))
      .filter((entry): entry is { run: typeof entry.run; count: NonNullable<typeof entry.count> } => entry.count !== null);
    const current = full.find((entry) => entry.run === last);
    const earlier = full.filter((entry) => entry.run.seq < last.seq);
    if (current && earlier.length > 0) {
      const most = Math.max(...earlier.filter((entry) => isSuccess(parseOutcome(entry.run.isError, entry.run.resultText))).map((entry) => entry.count.passed), 0);
      if (current.count.passed < most) warnings.push(`la última corrida verde pasó ${current.count.passed} tests; antes, en este pedido, pasaban ${most}`);
      const first = earlier[0].count.skipped;
      if (current.count.skipped > first) warnings.push(`los tests salteados subieron de ${first} a ${current.count.skipped}`);
    }
  }

  if (input.declaredFiles.length > 0) {
    const outside = written
      .map(([path]) => path)
      .filter((path) => !isDeclaredPath(path, input.declaredFiles) && !AGENT_OWN.test(path));
    if (outside.length > 0) warnings.push(`${plural(outside.length, "archivo")} fuera de lo declarado: ${outside.join(", ")}`);
  }

  for (const edit of input.testEdits.filter((e) => e.seq > since)) {
    const redBefore = runnerRuns.some((run) => run.seq < edit.seq && !isSuccess(parseOutcome(run.isError, run.resultText)));
    const greenAfter = runnerRuns.some((run) => run.seq > edit.seq && isSuccess(parseOutcome(run.isError, run.resultText)));
    if (redBefore && greenAfter) warnings.push(`se editó ${edit.path} después de que el runner fallara y antes del verde: revisá que el arreglo esté en el código y no en el test`);
    if (edit.addedMarkers.length > 0) warnings.push(`${edit.path}: se agregó ${edit.addedMarkers.join(", ")}`);
    if (edit.droppedAssertions > 0) warnings.push(`${edit.path}: se sacaron ${edit.droppedAssertions} assertions`);
  }

  const files = plural(written.length, "archivo") + (bashWrites.length > 0 ? " + escrituras por bash" : "");
  return { line: `◆ NODD · ${input.slug ?? "sin declarar"} · ${files} · ${status}`, warnings, verified };
}
