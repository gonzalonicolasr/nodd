import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { writeVerified as writeVerifiedWith, type Fs, type WriteOptions, type WriteResult } from "./io-core.ts";

export type { Fs, WriteResult } from "./io-core.ts";

export const nodeFs: Fs = { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync };

export function writeVerified(
  target: string,
  content: string,
  options: Omit<WriteOptions, "fs"> & { fs?: Fs } = {},
): WriteResult {
  return writeVerifiedWith(target, content, { ...options, fs: options.fs ?? nodeFs });
}
