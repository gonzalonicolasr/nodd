import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs, writeVerified, type Fs } from "./io.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nodd-io-"));
}

test("a verified write lands on disk and reports success", () => {
  const dir = tmp();
  const target = join(dir, "feature.md");
  const result = writeVerified(target, "hello\n", { fs: nodeFs });
  assert.equal(result.ok, true);
  assert.equal(readFileSync(target, "utf8"), "hello\n");
  assert.deepEqual(readdirSync(dir), ["feature.md"], "the temp file must not survive");
});

test("a failing writer leaves the previous file intact and reports the limitation", () => {
  const dir = tmp();
  const target = join(dir, "feature.md");
  writeFileSync(target, "original\n", "utf8");
  const failing: Fs = { ...nodeFs, writeFileSync: () => { throw new Error("ENOSPC: disk full"); } };

  const result = writeVerified(target, "replacement\n", { fs: failing });
  assert.equal(result.ok, false);
  assert.match(result.limitation, /ENOSPC/);
  assert.equal(readFileSync(target, "utf8"), "original\n", "the previous file must survive");
});

test("a read-back mismatch is reported as a failure, not as success", () => {
  const dir = tmp();
  const target = join(dir, "feature.md");
  writeFileSync(target, "original\n", "utf8");
  // A writer that silently truncates: the write "succeeds" and the content is wrong.
  const lying: Fs = { ...nodeFs, readFileSync: () => "trunca" };

  const result = writeVerified(target, "replacement\n", { fs: lying });
  assert.equal(result.ok, false);
  assert.match(result.limitation, /read-back/);
});

test("an interrupted write leaves no partial file behind", () => {
  const dir = tmp();
  const target = join(dir, "feature.md");
  const interrupted: Fs = { ...nodeFs, renameSync: () => { throw new Error("interrupted"); } };

  const result = writeVerified(target, "half", { fs: interrupted });
  assert.equal(result.ok, false);
  assert.deepEqual(readdirSync(dir), [], "no partial and no temp file may remain");
});

test("divergent on-disk content is preserved alongside, losing neither version", () => {
  const dir = tmp();
  const target = join(dir, "feature.md");
  writeFileSync(target, "edited by hand\n", "utf8");

  const result = writeVerified(target, "nodd version\n", {
    fs: nodeFs,
    expectedPrevious: "what nodd last wrote\n",
    now: () => "20260919T100000",
  });

  assert.equal(result.ok, true);
  assert.equal(result.conflictPath, join(dir, "feature.conflict-20260919T100000.md"));
  assert.equal(readFileSync(target, "utf8"), "nodd version\n");
  assert.equal(readFileSync(result.conflictPath!, "utf8"), "edited by hand\n");
});

test("matching previous content produces no conflict file", () => {
  const dir = tmp();
  const target = join(dir, "feature.md");
  writeFileSync(target, "same\n", "utf8");

  const result = writeVerified(target, "next\n", { fs: nodeFs, expectedPrevious: "same\n" });
  assert.equal(result.ok, true);
  assert.equal(result.conflictPath, undefined);
  assert.deepEqual(readdirSync(dir), ["feature.md"]);
});
