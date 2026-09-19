// Every NODD artifact write goes through here.
//
// `routing.go:98` — "read back both writes; they are not atomic". NODD carries
// the disk half of that clause literally: write to a temp file, rename, read
// back, and compare against what we meant to write. A mismatch preserves the
// previous file and returns a limitation instead of claiming success, because a
// write NODD did not verify is exactly the kind of unearned "done" this product
// exists to refuse.
//
// If the on-disk content diverged from what NODD last wrote, both versions
// survive: the new content lands, the divergent one is kept beside it as
// `<name>.conflict-<ts>.md`. Neither is lost, and only the real conflict is
// worth asking the user about.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";

/** The file operations this module needs, injectable so tests can force failure. */
export type Fs = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): void;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, encoding: "utf8"): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
};

export const nodeFs: Fs = { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync };

export type WriteResult =
  | { ok: true; conflictPath?: string }
  | { ok: false; limitation: string };

export type WriteOptions = {
  fs?: Fs;
  /**
   * What NODD believes it last wrote. When the file on disk says something
   * else, the divergent version is preserved rather than overwritten.
   */
  expectedPrevious?: string;
  now?: () => string;
};

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

function conflictPathFor(target: string, stamp: string): string {
  const ext = extname(target);
  const base = target.slice(0, target.length - ext.length);
  return `${base}.conflict-${stamp}${ext}`;
}

export function writeVerified(target: string, content: string, options: WriteOptions = {}): WriteResult {
  const fs = options.fs ?? nodeFs;
  const stamp = (options.now ?? timestamp)();
  const temp = join(dirname(target), `.${stamp}.nodd-tmp`);

  let conflictPath: string | undefined;
  try {
    fs.mkdirSync(dirname(target), { recursive: true });

    if (options.expectedPrevious !== undefined && fs.existsSync(target)) {
      const onDisk = fs.readFileSync(target, "utf8");
      if (onDisk !== options.expectedPrevious) {
        conflictPath = conflictPathFor(target, stamp);
        fs.writeFileSync(conflictPath, onDisk, "utf8");
      }
    }

    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, target);
  } catch (err) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Best effort: the temp file is already reported through the limitation.
    }
    return { ok: false, limitation: err instanceof Error ? err.message : String(err) };
  }

  // The success path is reachable only through a matching read-back.
  let readBack: string;
  try {
    readBack = fs.readFileSync(target, "utf8");
  } catch (err) {
    return { ok: false, limitation: `read-back failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (readBack !== content) {
    return { ok: false, limitation: `read-back mismatch on ${target}: the file on disk is not what NODD wrote` };
  }

  return conflictPath ? { ok: true, conflictPath } : { ok: true };
}
