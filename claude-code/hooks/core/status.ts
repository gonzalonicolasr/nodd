import type { Committed } from "./state.ts";

/** Verified tasks against declared ones, for the routes that have a task list. */
export type TaskProgress = { done: number; total: number };

/**
 * The one line that tells you nodd is running.
 *
 * Gates are invisible by nature: they do nothing until something is blocked, so
 * a session where nothing is wrong looks exactly like a session where the
 * extension failed to load. This renders the kernel's own state — the declared
 * route and, for tracked work, how much of it is verified — into the footer.
 *
 * It reports; it never persuades. A disabled kernel says so.
 */
export function statusLine(state: Committed, enabled: boolean, tasks?: TaskProgress): string {
  if (!enabled) return "nodd · apagado";

  const declaration = state.declaration;
  if (!declaration) return "nodd · sin declarar";

  const parts = ["nodd", declaration.route, ellipsis(declaration.slug, 22)];
  // `0/0` is noise: a route with no tasks has no progress to report.
  if (tasks && tasks.total > 0) parts.push(`${tasks.done}/${tasks.total}`);
  return parts.join(" · ");
}

/** The footer is shared real estate: a long slug is trimmed, never wrapped. */
function ellipsis(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
