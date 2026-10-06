import type { Committed } from "./state.ts";
import { isDeclaredRunner, masksExitStatus } from "./gates/evidence.ts";
import { describeOutcome, isSuccess, parseOutcome } from "./outcome.ts";

export type TestEdit = { path: string; seq: number; addedMarkers: string[]; droppedAssertions: number };

export type CloseInput = {
  committed: Committed;
  since: number;
  slug: string | null;
  runner: string | null;
  declaredFiles: string[];
  answer: string;
  testEdits: TestEdit[];
};

export type CloseReport = { line: string; warnings: string[]; verified: boolean };

const MARKER = /\.(skip|only|todo)\(|\bx(it|describe|test)\(|\bf(it|describe)\(|\bt\.Skip(Now|f)?\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip/g;
const ASSERTION = /\bexpect\s*\(|\bassert\w*\s*[(.\s]|\bt\.(Error|Fatal)f?\s*\(|\brequire\.\w+\s*\(/g;
const CLAIM = /(?<!\bno\s)(?<!\bnot\s)\b(pasan|verdes?|anda|funciona|listo|lista|arreglad[oa]|resuelt[oa]|verificad[oa]|terminad[oa]|tests? pass(es)?|passing|fixed|done|works|verified|all green)\b/i;

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
  const before = counts(oldText, MARKER);
  const after = counts(newText, MARKER);
  const addedMarkers = [...after].filter(([marker, count]) => count > (before.get(marker) ?? 0)).map(([marker]) => marker);
  const droppedAssertions = Math.max(0, total(counts(oldText, ASSERTION)) - total(counts(newText, ASSERTION)));
  return { addedMarkers, droppedAssertions };
}

function isPartial(command: string, runner: string): boolean {
  let rest = command;
  for (const token of runner.trim().split(/\s+/)) rest = rest.trimStart().slice(token.length);
  const own = rest.split("&&")[0];
  return own.replace(/\s*\d*&?>>?&?\s*\S+/g, "").trim() !== "";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function closeReport(input: CloseInput): CloseReport | null {
  const { committed, since, runner } = input;
  const written = [...committed.filesWritten].filter(([, write]) => write.seq > since);
  if (written.length === 0) return null;

  const lastWrite = Math.max(...written.map(([, write]) => write.seq));
  const runs = committed.commandResults.filter((run) => run.seq > since);
  const runnerRuns = runner === null ? [] : runs.filter((run) => isDeclaredRunner(run.command, runner));
  const after = runnerRuns.filter((run) => run.seq > lastWrite);
  const trusted = after.filter((run) => !masksExitStatus(run.command, runner!));
  const last = trusted[trusted.length - 1];
  const lastOutcome = last ? parseOutcome(last.isError, last.resultText) : null;
  const verified = lastOutcome !== null && isSuccess(lastOutcome) && !isPartial(last.command, runner!);

  let status: string;
  if (runner === null) status = "sin runner declarado: NODD no puede decir si esto quedó verificado";
  else if (!last && after.length > 0) status = `\`${after[after.length - 1].command}\` escondió su exit status: no cuenta como verificación`;
  else if (!last) status = `\`${runner}\` sin correr después de la última escritura`;
  else if (!isSuccess(lastOutcome!)) status = `✗ \`${last.command}\` → ${describeOutcome(lastOutcome!)}`;
  else if (isPartial(last.command, runner)) status = `verde parcial: \`${last.command}\`, no la suite declarada (\`${runner}\`)`;
  else status = `✓ \`${last.command}\` verde después de la última escritura`;

  const warnings: string[] = [];
  const claim = CLAIM.exec(input.answer)?.[0];
  if (claim && !verified) {
    warnings.push(runner === null
      ? `la respuesta afirma «${claim}», pero no hay runner declarado contra el cual verificarlo`
      : `la respuesta afirma «${claim}», pero NODD no vio \`${runner}\` completo y verde después de la última escritura`);
  }

  if (input.declaredFiles.length > 0) {
    const outside = written
      .map(([path]) => path)
      .filter((path) => !input.declaredFiles.some((file) => path === file || path.endsWith(`/${file}`)));
    if (outside.length > 0) warnings.push(`${plural(outside.length, "archivo")} fuera de lo declarado: ${outside.join(", ")}`);
  }

  for (const edit of input.testEdits.filter((e) => e.seq > since)) {
    const redBefore = runnerRuns.some((run) => run.seq < edit.seq && !isSuccess(parseOutcome(run.isError, run.resultText)));
    const greenAfter = runnerRuns.some((run) => run.seq > edit.seq && isSuccess(parseOutcome(run.isError, run.resultText)));
    if (redBefore && greenAfter) warnings.push(`se editó ${edit.path} después de que el runner fallara y antes del verde: revisá que el arreglo esté en el código y no en el test`);
    if (edit.addedMarkers.length > 0) warnings.push(`${edit.path}: se agregó ${edit.addedMarkers.join(", ")}`);
    if (edit.droppedAssertions > 0) warnings.push(`${edit.path}: se sacaron ${edit.droppedAssertions} assertions`);
  }

  return { line: `◆ NODD · ${input.slug ?? "sin declarar"} · ${plural(written.length, "archivo")} · ${status}`, warnings, verified };
}
