// pi's own tool wrapper, imported from the installed package.
//
// The absolute `dist/` path lives here and nowhere else, so the tests that
// exercise NODD's tools the way pi exercises them have a single seam to adapt
// when pi moves the file.
//
// Three critical defects shipped because the suite exercised doubles that
// copied the wrong shape from the code they were meant to check: the
// `registerTool` signature, `file_path` vs `path`, and `handler` vs `execute`.
// A double cannot disagree with the code it was modelled on, so the contract
// has to be read from the real package.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Where pi actually lives.
 *
 * pi is installed globally, not as a dependency of this package, so plain
 * resolution from here finds nothing. `npm root -g` is asked once and the
 * answer cached; the global root is stable for the life of a test run.
 */
let globalRoot: string | null | undefined;
function npmGlobalRoot(): string | null {
  if (globalRoot !== undefined) return globalRoot;
  try {
    globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    globalRoot = null;
  }
  return globalRoot;
}

export type WrappedTool = {
  name: string;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>;
};

/**
 * `wrapToolDefinition` as pi applies it to every registered tool, or `null`
 * when pi is not installed beside us. Tests skip rather than fail in that case:
 * the package is a peer, and a missing peer is not a NODD defect.
 */
export function loadPiToolWrapper(): ((definition: unknown, ctxFactory?: () => unknown) => WrappedTool) | null {
  try {
    // The package's `exports` map does not expose internal subpaths, so the
    // entry point is resolved and the file located beside it. Resolving the
    // subpath directly throws ERR_PACKAGE_PATH_NOT_EXPORTED — which the catch
    // below would swallow into a silent skip, and a test that skips is a test
    // that proves nothing.
    // The package's `exports` map covers only "." and a few subpaths, so even
    // resolving the package root by name throws ERR_PACKAGE_PATH_NOT_EXPORTED.
    // The file is loaded by absolute path, which `exports` does not police.
    const root = npmGlobalRoot();
    if (!root) return null;
    const file = `${root}/@earendil-works/pi-coding-agent/dist/core/tools/tool-definition-wrapper.js`;
    return require(file).wrapToolDefinition ?? null;
  } catch {
    return null;
  }
}
