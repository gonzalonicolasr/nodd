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
  for (const answer of ["Listo, pasan todos los tests.", "Done — all tests pass.", "Quedó arreglado y verificado.", "VEREDICTO: pasa"]) {
    const report = closeReport(input(c, { answer }))!;
    assert.ok(report.warnings.some((w) => /la respuesta afirma/.test(w)), answer);
  }
  const verified = closeReport(input(run(c, "npm test"), { answer: "Listo, pasan todos los tests." }))!;
  assert.deepEqual(verified.warnings, []);
});

test("without a runner the report says so, and a green test run is not flagged", () => {
  const c = run(write(emptyCommitted(), "/r/a.ts"), "npm test");
  const report = closeReport(input(c, { runner: null, answer: "listo, anda" }))!;
  assert.match(report.line, /sin runner declarado/);
  assert.deepEqual(report.warnings, []);
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

test("the close shows the count of a green run and flags tests that vanished or got skipped", () => {
  const out = (pass: number, skipped = 0) => `ℹ pass ${pass}\nℹ fail 0\nℹ skipped ${skipped}`;
  const green = (c: Committed, text: string) => step(c, "bash", { command: "npm test" }, false, text);
  const first = green(write(emptyCommitted(), "/r/a.ts"), out(128));
  const second = green(write(first, "/r/a.test.ts"), out(120, 3));
  const report = closeReport(input(second))!;
  assert.match(report.line, /✓ `npm test` verde \(120 tests\) después de la última escritura/);
  assert.ok(report.warnings.some((w) => /pasó 120 tests; antes, en este pedido, pasaban 128/.test(w)));
  assert.ok(report.warnings.some((w) => /salteados subieron de 0 a 3/.test(w)));
  const steady = closeReport(input(green(write(first, "/r/b.ts"), out(130))))!;
  assert.deepEqual(steady.warnings, []);
});

test("a generic 'done' with nothing to verify against is not flagged; a test claim still is", () => {
  const c = write(emptyCommitted(), "/r/manual.html");
  assert.deepEqual(closeReport(input(c, { runner: null, answer: "Listo, quedó el manual." }))!.warnings, []);
  const claimed = closeReport(input(c, { runner: null, answer: "Listo, pasan los tests." }))!;
  assert.ok(claimed.warnings.some((w) => /pasan los tests|ninguna corrida de tests/.test(w)), claimed.warnings.join("|"));
});

test("without a runner, a green test run after the last write backs a test claim", () => {
  const c = run(write(emptyCommitted(), "/r/a.ts"), "cd /r && npm test");
  const report = closeReport(input(c, { runner: null, answer: "Listo, pasan los tests." }))!;
  assert.deepEqual(report.warnings, []);
  assert.match(report.line, /✓ `cd \/r && npm test` verde \(sin runner declarado\)/);
});

test("a declared runner with a cd prefix matches the same run written with ~", () => {
  const c = run(write(emptyCommitted(), "/r/a.ts"), "cd ~/projects/nerv && claude plugin test .");
  const report = closeReport(input(c, { runner: "cd /home/gon/projects/nerv && claude plugin test .", answer: "verde", home: "/home/gon" }))!;
  assert.match(report.line, /✓/);
  assert.deepEqual(report.warnings, []);
});

test("test data that only mentions .skip is not an added skip", () => {
  assert.deepEqual(testEditSignals("", "const cases = [\"it.skip('a')\", 't.Skip()'];\ntest('x', () => { assert.ok(1) })").addedMarkers, []);
  assert.deepEqual(testEditSignals("it('a', () => {})", "it.skip('a', () => {})").addedMarkers, [".skip("]);
});

test("writes to the scratchpad or to Claude's own files are not outside the declaration", () => {
  const c = write(write(write(emptyCommitted(), "/r/src/a.ts"), "/tmp/claude-1000/-r/s1/scratchpad/n.md"), "/home/gon/.claude/projects/-home-gon/memory/x.md");
  assert.deepEqual(closeReport(input(c, { declaredFiles: ["src/a.ts"] }))!.warnings.filter((w) => w.includes("fuera")), []);
});

test("only a claim about tests counts as a test claim", () => {
  const c = write(emptyCommitted(), "/r/a.ts");
  for (const answer of ["Mapeado y verificado contra DynamoDB TEST.", "El botón quedó verde.", "Listo, quedó."]) {
    assert.deepEqual(closeReport(input(c, { runner: null, answer }))!.warnings, [], answer);
  }
  for (const answer of ["Pasan los 12 tests.", "Todos los tests en verde.", "All tests pass.", "Suite verde."]) {
    assert.ok(closeReport(input(c, { runner: null, answer }))!.warnings.length > 0, answer);
  }
});

test("a run whose status is hidden is read from the runner's summary or the printed $?, and says so", () => {
  const base = write(emptyCommitted(), "/r/a.ts");
  const tail = step(base, "bash", { command: "npm test 2>&1 | tail -5" }, false, "Tests  120 passed (120)");
  const r1 = closeReport(input(tail, { runner: null, answer: "Pasan los tests." }))!;
  assert.deepEqual(r1.warnings, []);
  assert.match(r1.line, /verde según el resumen/);
  const echo = step(base, "bash", { command: "npm test > /tmp/u.log 2>&1; echo \"exit=$?\"" }, false, "exit=0");
  assert.deepEqual(closeReport(input(echo, { runner: null, answer: "Pasan los tests." }))!.warnings, []);
  const echoRed = step(base, "bash", { command: "npm test > /tmp/u.log 2>&1; echo \"exit=$?\"" }, false, "exit=1");
  assert.ok(closeReport(input(echoRed, { runner: null, answer: "Pasan los tests." }))!.warnings.length > 0);
  const tailRed = step(base, "bash", { command: "npm test 2>&1 | tail -3" }, false, "Tests  3 failed | 117 passed (120)");
  assert.ok(closeReport(input(tailRed, { runner: "npm test", answer: "Pasan los tests." }))!.warnings.length > 0);
});

test("writing docs, memory or scratch after the green run does not undo it", () => {
  const green = run(write(emptyCommitted(), "/r/src/a.ts"), "npm test");
  const docs = write(write(green, "/r/docs/RFC.md"), "/home/gon/.claude/projects/-home-gon/memory/x.md");
  const notes = run(docs, "cat >> /home/gon/.claude/projects/-home-gon/memory/y.md <<'EOF'\nnota\nEOF");
  const report = closeReport(input(notes, { runner: "npm test", answer: "Listo, pasan los tests." }))!;
  assert.match(report.line, /✓ `npm test` verde/);
  assert.deepEqual(report.warnings, []);
});

test("a request that only touched docs has nothing to re-verify", () => {
  const c = write(emptyCommitted(), "/r/README.md");
  assert.deepEqual(closeReport(input(c, { runner: "npm test", answer: "Listo, quedó. Pasan los tests." }))!.warnings, []);
});

test("passing CI checks back a test claim, and a negated claim is not a claim", () => {
  const c = write(emptyCommitted(), "/r/src/a.ts");
  const ci = run(c, "gh pr checks 71 --watch");
  assert.deepEqual(closeReport(input(ci, { runner: null, answer: "PR 71 arriba, todo verde." }))!.warnings, []);
  assert.deepEqual(closeReport(input(c, { runner: null, answer: "Corrección: la integración falló, no quedó todo verde." }))!.warnings, []);
});

test("any green test run after the last code write counts, not only the last test-looking command", () => {
  const c = run(run(write(emptyCommitted(), "/r/src/a.ts"), "go test ./..."), "cat > /r/pr.md <<'EOF'\nlos tests de go test pasan\nEOF");
  assert.deepEqual(closeReport(input(c, { runner: null, answer: "Listo, pasan los tests." }))!.warnings, []);
});

test("build artifacts and python notes to docs are not code writes", () => {
  const green = run(write(emptyCommitted(), "/r/src/a.ts"), "npm test");
  const c = run(run(green, "rm -rf .next dist coverage"), "python3 - <<'PY'\np='/home/gon/.claude/projects/x/memory/n.md'\ns=open(p).read()\nopen(p,'w').write(s+'x')\nPY");
  assert.deepEqual(closeReport(input(c, { runner: "npm test", answer: "Listo, pasan los tests." }))!.warnings, []);
});

test("shell and python test scripts count as test runs; gh run watch only with --exit-status", () => {
  const c = write(emptyCommitted(), "/r/src/a.ts");
  assert.deepEqual(closeReport(input(run(c, "bash tools/check_test.sh"), { runner: null, answer: "Pasan los tests." }))!.warnings, []);
  assert.deepEqual(closeReport(input(run(c, "python3 tools/test_parser.py"), { runner: null, answer: "Pasan los tests." }))!.warnings, []);
  assert.ok(closeReport(input(run(c, "gh run watch 123"), { runner: null, answer: "Pasan los tests." }))!.warnings.length > 0);
});

test("a chained runner is matched by its last segment", () => {
  const c = run(write(emptyCommitted(), "/r/src/a.ts"), "claude plugin test .");
  const report = closeReport(input(c, { runner: "python3 fix.py && claude plugin validate . --strict && claude plugin test .", answer: "Pasan los tests." }))!;
  assert.deepEqual(report.warnings, []);
});

test("phrases that only look like claims are not claims", () => {
  const c = write(emptyCommitted(), "/r/src/a.ts");
  for (const answer of ["La lista de tareas ahora sale ordenada.", "Cómo funciona: el rayo funciona como ventana.", "Lo tapaba un test en verde.", "Deploy a test en verde.", "Antes de darlo por listo, revisá esto."]) {
    assert.deepEqual(closeReport(input(c, { runner: "npm test", answer }))!.warnings, [], answer);
  }
  for (const answer of ["Listo: quedó el login.", "Quedó arreglado.", "Ya está listo.", "Los tests pasan."]) {
    assert.ok(closeReport(input(c, { runner: "npm test", answer }))!.warnings.length > 0, answer);
  }
});

test("a hidden go test run is read from its package lines", () => {
  const base = write(emptyCommitted(), "/r/a.go");
  const ok = step(base, "bash", { command: "go test ./... 2>&1 | tail -20" }, false, "ok  \texample.com/a\t0.01s\nok  \texample.com/b\t0.02s");
  assert.deepEqual(closeReport(input(ok, { runner: null, answer: "Pasan los tests." }))!.warnings, []);
  const bad = step(base, "bash", { command: "go test ./... 2>&1 | tail -20" }, false, "--- FAIL: TestX\nFAIL\texample.com/a\t0.01s");
  assert.ok(closeReport(input(bad, { runner: null, answer: "Pasan los tests." }))!.warnings.length > 0);
});
