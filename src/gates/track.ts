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

  const declaration = committed.declaration;

  if (targetsNoddDir(request)) {
    // The emergency door. While the declared document does not exist, creating
    // it is allowed — because when `nodd_declare` was broken this gate had no
    // way out at all: it refused every write until the document existed, and
    // the only tool that could create it was the broken one. Disabling the
    // gate meant writing config, itself a mutation, and `/nodd-allow` is not
    // reachable from a subagent. The gate blocked every repair of its own
    // cause.
    //
    // Narrow on purpose: only this slug's own `feature.md`, and only while it
    // is absent. That is faithful to what the branch below defends — a
    // document the model can rewrite is one it can forge *after the fact* —
    // while leaving the ledger and every other artifact extension-owned.
    const creatingDeclaredDoc =
      declaration !== null &&
      !docExists(declaration.slug) &&
      targetPath(request)?.endsWith(featureDocRelPath(declaration.slug)) === true;

    if (!creatingDeclaredDoc) {
      return refuse(
        "track",
        `${request.toolName} targets \`${targetPath(request)}\`, and NODD's own artifacts are written by NODD, not by the model`,
        "use `nodd_task` to add or check off tasks, and `nodd_declare` to set the objective and route",
      );
    }

    return allow();
  }

  if (!declaration) return allow();
  if (declaration.route === "inline") return allow();
  if (!isMutation(request)) return allow();
  if (docExists(declaration.slug)) return allow();

  const path = featureDocRelPath(declaration.slug);
  return refuse(
    "track",
    `route \`${declaration.route}\` was declared but \`${path}\` does not exist, and ${request.toolName} would be the first write`,
    // Two remedies, because the first one can itself be unavailable: a
    // subagent has no slash commands, and a broken `nodd_declare` used to
    // leave no action at all. Writing the document is always reachable.
    `call \`nodd_declare\` with slug \`${declaration.slug}\` to create ${path}, or write ${path} directly`,
  );
}
