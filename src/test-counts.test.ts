import { test } from "node:test";
import assert from "node:assert/strict";
import { testCounts } from "./test-counts.ts";

test("reads the summary of the common runners", () => {
  assert.deepEqual(testCounts("ℹ tests 636\nℹ suites 0\nℹ pass 634\nℹ fail 0\nℹ cancelled 0\nℹ skipped 2\nℹ todo 0"), { passed: 634, failed: 0, skipped: 2 });
  assert.deepEqual(testCounts(" 47 pass\n 0 fail\nRan 47 tests across 1 file."), { passed: 47, failed: 0, skipped: 0 });
  assert.deepEqual(testCounts("Tests:       1 failed, 2 skipped, 40 passed, 43 total\nTime: 2s"), { passed: 40, failed: 1, skipped: 2 });
  assert.deepEqual(testCounts(" Test Files  3 passed (3)\n      Tests  12 passed | 1 skipped (13)"), { passed: 12, failed: 0, skipped: 1 });
  assert.deepEqual(testCounts("==== 10 passed, 3 skipped, 1 xfailed in 0.52s ===="), { passed: 10, failed: 0, skipped: 4 });
  assert.deepEqual(testCounts("test result: ok. 5 passed; 0 failed; 2 ignored; 0 measured"), { passed: 5, failed: 0, skipped: 2 });
  assert.deepEqual(testCounts("=== RUN   TestA\n--- PASS: TestA (0.00s)\n--- SKIP: TestB (0.00s)\n--- PASS: TestC (0.00s)\nok  	pkg	0.1s"), { passed: 2, failed: 0, skipped: 1 });
});

test("without a recognisable summary there is no count, never a guess", () => {
  assert.equal(testCounts("ok  	example.com/pkg	0.012s"), null);
  assert.equal(testCounts("build finished"), null);
  assert.equal(testCounts(""), null);
});

test("colored vitest output is read", () => {
  assert.deepEqual(testCounts("\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m154 passed\x1b[39m\x1b[22m\x1b[2m | \x1b[22m\x1b[33m33 skipped\x1b[39m\x1b[90m (187)\x1b[39m"), { passed: 154, failed: 0, skipped: 33 });
});

test("plain vitest summary with skipped tests is read", () => {
  assert.deepEqual(testCounts(" Test Files  12 passed (12)\n      Tests  154 passed | 33 skipped (187)\n   Start at  10:00:00"), { passed: 154, failed: 0, skipped: 33 });
});
