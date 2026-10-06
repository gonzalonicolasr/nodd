import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCommitted, fold, type Committed } from "./state.ts";
import { observation } from "./observations.ts";
import { closeReport, isTestFile, testEditSignals, type CloseInput } from "./close-report.ts";

let n = 0;
function step(committed: Committed, toolName: string, input: Record<string, unknown>, isError = false, resultText = ""): Committed {
  n += 1;
  return fold(committed, observation({ toolCallId: `c${n}`, toolName, input, isError, resultText, at: `2026-10-06T10:00:${String(n).padStart(2, "0")}.000Z` }));
}

const write = (c: Committed, path: string) => step(c, "write", { file_path: path });
const run = (c: Committed, command: string, ok = true) => step(c, "bash", { command }, !ok, ok ? "ok" : "FAIL\nCommand exited with code 1");

function input(committed: Committed, extra: Partial<CloseInput> = {}): CloseInput {
  return { committed, since: 0, slug: "auth", runner: "npm test", declaredFiles: [], answer: "", testEdits: [], ...extra };
}

test("without writes in the request there is nothing to report", () => {
  assert.equal(closeReport(input(run(emptyCommitted(), "npm test"))), null);
});

test("a green runner after the last write reads as verified", () => {
  const c = run(write(emptyCommitted(), "/r/a.ts"), "npm test");
  const report = closeReport(input(c))!;
  assert.match(report.line, /auth · 1 archivo · ✓ `npm test` verde después de la última escritura/);
  assert.deepEqual(report.warnings, []);
});

test("a write after the green run leaves it unverified", () => {
  const c = write(run(write(emptyCommitted(), "/r/a.ts"), "npm test"), "/r/b.ts");
  assert.match(closeReport(input(c))!.line, /sin correr después de la última escritura/);
});

test("a red run, a masked run and a partial run are told apart", () => {
  const base = write(emptyCommitted(), "/r/a.ts");
  assert.match(closeReport(input(run(base, "npm test", false)))!.line, /✗ `npm test` → exit 1/);
  assert.match(closeReport(input(run(base, "npm test 2>&1 | tail -5")))!.line, /escondió su exit status/);
  assert.match(closeReport(input(run(base, "npm test -- a.test.ts")))!.line, /verde parcial: `npm test -- a\.test\.ts`/);
  assert.match(closeReport(input(run(base, "npm test 2>&1 && echo ok")))!.line, /✓ `npm test 2>&1 && echo ok` verde/);
});

test("only what happened in this request counts", () => {
  const before = run(write(emptyCommitted(), "/r/a.ts"), "npm test");
  const now = write(before, "/r/b.ts");
  const report = closeReport(input(now, { since: before.toolCalls }))!;
  assert.match(report.line, /1 archivo · /);
  assert.match(report.line, /sin correr/);
});

test("a claim of success without an observed green run is flagged", () => {
  const c = write(emptyCommitted(), "/r/a.ts");
  for (const answer of ["Listo, pasan todos los tests.", "Done — all tests pass.", "Quedó arreglado y verificado."]) {
    const report = closeReport(input(c, { answer }))!;
    assert.ok(report.warnings.some((w) => /la respuesta afirma/.test(w)), answer);
  }
  const verified = closeReport(input(run(c, "npm test"), { answer: "Listo, pasan todos los tests." }))!;
  assert.deepEqual(verified.warnings, []);
});

test("without a runner the report says the work cannot be called verified", () => {
  const c = run(write(emptyCommitted(), "/r/a.ts"), "npm test");
  const report = closeReport(input(c, { runner: null, answer: "listo, anda" }))!;
  assert.match(report.line, /sin runner declarado/);
  assert.ok(report.warnings.some((w) => /la respuesta afirma/.test(w)));
});

test("files outside the declared ones are named", () => {
  const c = run(write(write(emptyCommitted(), "/r/src/a.ts"), "/r/src/extra.ts"), "npm test");
  const report = closeReport(input(c, { declaredFiles: ["src/a.ts"] }))!;
  assert.ok(report.warnings.some((w) => w.includes("fuera de lo declarado") && w.includes("/r/src/extra.ts")));
});

test("a test edited between a red and a green run is flagged, and so are added skips", () => {
  const red = run(write(emptyCommitted(), "/r/a.ts"), "npm test", false);
  const edited = write(red, "/r/a.test.ts");
  const green = run(edited, "npm test");
  const report = closeReport(input(green, {
    testEdits: [{ path: "/r/a.test.ts", seq: edited.toolCalls, addedMarkers: [".skip("], droppedAssertions: 2 }],
  }))!;
  assert.ok(report.warnings.some((w) => w.includes("/r/a.test.ts") && /después de que el runner fallara/.test(w)));
  assert.ok(report.warnings.some((w) => w.includes(".skip(")));
  assert.ok(report.warnings.some((w) => /2 assertions/.test(w)));
});

test("test files and edit signals are recognised across languages", () => {
  for (const path of ["src/a.test.ts", "a.spec.jsx", "pkg/x_test.go", "tests/test_api.py", "app/__tests__/b.js", "x_test.py"]) assert.ok(isTestFile(path), path);
  for (const path of ["src/a.ts", "contest.ts", "latest/notes.md"]) assert.ok(!isTestFile(path), path);
  assert.deepEqual(testEditSignals("it('a', () => { expect(x).toBe(1) })", "it.skip('a', () => {})"), { addedMarkers: [".skip("], droppedAssertions: 1 });
  assert.deepEqual(testEditSignals("func TestA(t *testing.T) {}", "func TestA(t *testing.T) { t.Skip() }"), { addedMarkers: ["t.Skip("], droppedAssertions: 0 });
  assert.deepEqual(testEditSignals("def test_a():\n    assert f() == 1", "@pytest.mark.skip\ndef test_a():\n    pass"), { addedMarkers: ["@pytest.mark.skip"], droppedAssertions: 1 });
  assert.deepEqual(testEditSignals("expect(a).toBe(1)", "expect(a).toBe(2)"), { addedMarkers: [], droppedAssertions: 0 });
});

test("a bash write after the green run leaves the request unverified, and a bash-only request is reported", () => {
  const c = run(run(write(emptyCommitted(), "/r/a.ts"), "npm test"), "sed -i 's/a/b/' /r/a.ts");
  assert.match(closeReport(input(c))!.line, /sin correr después de la última escritura/);
  const bashOnly = run(emptyCommitted(), "echo x > /r/gen.ts");
  assert.match(closeReport(input(bashOnly))!.line, /0 archivos \+ escrituras por bash · `npm test` sin correr/);
  const committed = run(run(write(emptyCommitted(), "/r/a.ts"), "npm test"), "git commit -am x");
  assert.match(closeReport(input(committed))!.line, /✓ `npm test` verde/);
});
