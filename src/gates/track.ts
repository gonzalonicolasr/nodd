// gate-track — track before the first write.
//
// `routing.go:49`: for substantial authorized implementation, create the
// feature document *before the first source write*, without asking permission.
// NODD makes that literal: on a `tracked` or `forge` route, while
// `.nodd/<slug>/feature.md` is absent, the first mutation does not happen.
//
// Route `inline` never blocks. Small, understood work stays small
// (`routing.go:94`) — a gate that demanded a document for a one-line fix would
// be the bureaucracy ODD explicitly refuses.
//
// The second half of this gate protects the document itself: `write`/`edit`
// aimed at `.nodd/**` is refused and pointed at `nodd_task`. The feature doc is
// extension-owned because a doc the model can rewrite is a doc the model can
// forge, and then "Evidence: tests pass" is back, in a file, looking official.

import type { Committed } from "../state.ts";
import { allow, refuse, resolveFlag, type GateDecision, type Policy } from "./policy.ts";
import { isFileWrite, isMutation, targetPath, type GateRequest } from "./request.ts";

export function featureDocRelPath(slug: string): string {
  return `.nodd/${slug}/feature.md`;
}

function targetsNoddDir(request: GateRequest): boolean {
  const path = targetPath(request);
  return isFileWrite(request) && path !== null && /(^|\/)\.nodd\//.test(path);
}

export function trackGate(
  committed: Committed,
  request: GateRequest,
  policy: Policy,
  docExists: (slug: string) => boolean,
): GateDecision {
  if (!resolveFlag("track", policy).enabled) return allow();

  if (targetsNoddDir(request)) {
    return refuse(
      "track",
      `${request.toolName} targets \`${targetPath(request)}\`, and NODD's own artifacts are written by NODD, not by the model`,
      "use `nodd_task` to add or check off tasks, and `nodd_declare` to set the objective and route",
    );
  }

  const declaration = committed.declaration;
  if (!declaration) return allow();
  if (declaration.route === "inline") return allow();
  if (!isMutation(request)) return allow();
  if (docExists(declaration.slug)) return allow();

  const path = featureDocRelPath(declaration.slug);
  return refuse(
    "track",
    `route \`${declaration.route}\` was declared but \`${path}\` does not exist, and ${request.toolName} would be the first write`,
    `call \`nodd_declare\` with slug \`${declaration.slug}\` to create ${path}`,
  );
}
