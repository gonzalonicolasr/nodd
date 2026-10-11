export type TestCounts = { passed: number; failed: number; skipped: number };

function lastValue(text: string, pattern: RegExp): number | null {
  let value: number | null = null;
  for (const match of text.matchAll(pattern)) value = Number(match[1]);
  return value;
}

export function testCounts(output: string): TestCounts | null {
  const text = (output ?? "").replace(/\x1b\[[0-9;]*m/g, "");

  const nodePass = lastValue(text, /^ℹ pass (\d+)$/gm);
  if (nodePass !== null) {
    return {
      passed: nodePass,
      failed: lastValue(text, /^ℹ fail (\d+)$/gm) ?? 0,
      skipped: (lastValue(text, /^ℹ skipped (\d+)$/gm) ?? 0) + (lastValue(text, /^ℹ todo (\d+)$/gm) ?? 0),
    };
  }

  const bunPass = lastValue(text, /^\s*(\d+) pass$/gm);
  if (bunPass !== null) {
    return {
      passed: bunPass,
      failed: lastValue(text, /^\s*(\d+) fail$/gm) ?? 0,
      skipped: (lastValue(text, /^\s*(\d+) skip$/gm) ?? 0) + (lastValue(text, /^\s*(\d+) todo$/gm) ?? 0),
    };
  }

  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const passed = /\b(\d+) passed\b/.exec(line);
    if (!passed || /Test Files/.test(line)) continue;
    let skipped = 0;
    for (const match of line.matchAll(/\b(\d+) (skipped|ignored|todo|xfailed)\b/g)) skipped += Number(match[1]);
    return { passed: Number(passed[1]), failed: Number(/\b(\d+) failed\b/.exec(line)?.[1] ?? 0), skipped };
  }

  const goPass = (text.match(/^\s*--- PASS/gm) ?? []).length;
  const goFail = (text.match(/^\s*--- FAIL/gm) ?? []).length;
  const goSkip = (text.match(/^\s*--- SKIP/gm) ?? []).length;
  if (goPass + goFail + goSkip > 0) return { passed: goPass, failed: goFail, skipped: goSkip };

  return null;
}
