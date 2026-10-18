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

import { dirnamePath as dirname, extnamePath as extname, joinPath as join } from "./path.ts";

/** The file operations this module needs, injectable so tests can force failure. */
export type Fs = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): void;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, options: "utf8" | { encoding: "utf8"; flag?: string; mode?: number }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
};

export type WriteResult =
  | { ok: true; conflictPath?: string }
  | { ok: false; limitation: string };

export type WriteOptions = {
  fs: Fs;
  /**
   * What NODD believes it last wrote. When the file on disk says something
   * else, the divergent version is preserved rather than overwritten.
   */
  expectedPrevious?: string;
  now?: () => string;
  /** File permissions for the written file, e.g. `0o600` for a file only its owner should read. */
  mode?: number;
};

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

function conflictPathFor(target: string, stamp: string): string {
  const ext = extname(target);
  const base = target.slice(0, target.length - ext.length);
  return `${base}.conflict-${stamp}${ext}`;
}

function placeAtomically(fs: Fs, target: string, content: string, stamp: string, mode: number | undefined): void {
  const temp = join(dirname(target), `.${stamp}-${Math.random().toString(36).slice(2, 10)}.nodd-tmp`);
  try {
    fs.writeFileSync(temp, content, { encoding: "utf8", flag: "wx", ...(mode === undefined ? {} : { mode }) });
    fs.renameSync(temp, target);
  } catch (err) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Best effort: the temp file is already reported through the limitation.
    }
    throw err;
  }
}

export function writeVerified(target: string, content: string, options: WriteOptions): WriteResult {
  const fs = options.fs;
  const stamp = (options.now ?? timestamp)();

  let conflictPath: string | undefined;
  let previous: string | undefined;
  try {
    fs.mkdirSync(dirname(target), { recursive: true });

    if (fs.existsSync(target)) {
      previous = fs.readFileSync(target, "utf8");
      if (options.expectedPrevious !== undefined && previous !== options.expectedPrevious) {
        conflictPath = conflictPathFor(target, stamp);
        fs.writeFileSync(conflictPath, previous, { encoding: "utf8", flag: "wx" });
      }
    }

    placeAtomically(fs, target, content, stamp, options.mode);
  } catch (err) {
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
    let restored = "";
    try {
      if (previous !== undefined) placeAtomically(fs, target, previous, stamp, options.mode);
      else fs.unlinkSync(target);
      restored = previous !== undefined ? "; the previous content was put back" : "; the unverified file was removed";
    } catch {
      restored = "; restoring the previous content failed too";
    }
    return { ok: false, limitation: `read-back mismatch on ${target}: the file on disk is not what NODD wrote${restored}` };
  }

  return conflictPath ? { ok: true, conflictPath } : { ok: true };
}
