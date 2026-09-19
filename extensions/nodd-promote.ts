// `/nodd-promote <slug>` — the single door from NODD into forge.
//
// It writes **exactly one file**: `.sdd/<slug>/requirements.md`. No `design.md`,
// no `tasks.md`, no checklist, so forge's resume algorithm lands on `no-plan`
// and restarts at `plan` (`orchestrator.md:102-105`).
//
// This is also the enforcement point for `REQ: no-sdd-artifacts-off-route`: it is
// the only module in the package that names `.sdd` in executable code, and a
// test in `nodd-promote.test.ts` scans every other source file to keep it that
// way. A tracked run can rewrite the feature doc ten times and leave `.sdd/`
// byte-identical.
//
// Forge is an **optional** dependency (`clarifications.md`). When it is absent
// the artifact is still written and the message names the exact command to run
// by hand — promotion must never fail because the consumer is not installed. The
// command never launches forge itself; handing control to another orchestrator
// is the user's decision.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFeatureDoc, renderFeatureDoc, type FeatureDoc } from "../src/feature-doc.ts";
import { writeVerified } from "../src/io.ts";
import { promotedRequirements } from "../src/promote.ts";

export type PromoteResult = { ok: boolean; message: string };

function featurePath(root: string, slug: string): string {
  return join(root, ".nodd", slug, "feature.md");
}

function requirementsPath(root: string, slug: string): string {
  return join(root, ".sdd", slug, "requirements.md");
}

/** Writes the feature doc under `.nodd/`, which is the only place NODD's own
 *  route writes. Exposed so the `.sdd/`-untouched test can drive a real
 *  multi-write run rather than assert against a mock. */
function writeFeatureDoc(root: string, doc: FeatureDoc): void {
  writeVerified(featurePath(root, doc.slug), renderFeatureDoc(doc));
}

export function runPromote(
  slug: string,
  root: string,
  options: { forgeAvailable?: boolean } = {},
): PromoteResult {
  const trimmed = slug.trim();
  if (trimmed === "") return { ok: false, message: "uso: /nodd-promote <slug>" };

  const source = featurePath(root, trimmed);
  if (!existsSync(source)) {
    return { ok: false, message: `nodd · no existe la feature ${trimmed} (${source})` };
  }

  const target = requirementsPath(root, trimmed);
  // Refusing beats merging: an existing requirements.md was written by forge or
  // by hand, and either way NODD is not the author who gets to replace it.
  if (existsSync(target)) {
    return { ok: false, message: `nodd · ${target} ya existe; no se sobrescribe. Movelo o borralo y repetí.` };
  }

  const { doc, defects } = parseFeatureDoc(readFileSync(source, "utf8"));
  const written = writeVerified(target, promotedRequirements(doc));
  if (!written.ok) return { ok: false, message: `nodd · no se pudo escribir ${target}: ${written.limitation}` };

  const next =
    options.forgeAvailable === false
      ? `forge no está instalado: corré \`/forge --continue ${trimmed}\` donde sí lo esté`
      : `seguí con \`/forge --continue ${trimmed}\``;

  const note = defects.length > 0 ? ` (la feature tenía ${defects.length} defecto(s): ${defects.join("; ")})` : "";
  return { ok: true, message: `nodd · ${target} escrito. ${next}.${note}` };
}

type PiApi = {
  registerCommand?(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => unknown }): void;
};

function register(pi?: PiApi): void {
  pi?.registerCommand?.("nodd-promote", {
    description: "Promover una feature de NODD a forge: /nodd-promote <slug>",
    handler: (args: string, rawCtx: unknown) => {
      const ctx = rawCtx as { ui?: { notify?(message: string, tone?: string): void } };
      try {
        const result = runPromote(args ?? "", process.cwd());
        ctx?.ui?.notify?.(result.message, result.ok ? "info" : "error");
      } catch (err) {
        ctx?.ui?.notify?.(`nodd-promote: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}

register.writeFeatureDoc = writeFeatureDoc;

export default register;
