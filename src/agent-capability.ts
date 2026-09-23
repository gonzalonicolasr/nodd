/**
 * Whether a delegated agent will hit `gate-classify` on its first change and
 * have no way past it.
 *
 * NODD's gates load inside delegated children, and kernel state is per session:
 * a declaration made by the parent does not reach the child's process. So an
 * agent that can change files needs `nodd_declare` in its own toolset, or its
 * first `write` or `edit` is refused and the only remedy it can reach is a
 * round-trip to whoever delegated the work.
 *
 * This is measured, not hypothetical. Four of the agents on this machine carry
 * `write` and `edit` without `nodd_declare`, and three of them were blocked in
 * sequence during the run that added this module.
 *
 * An agent that cannot change anything is not blockable: it never reaches the
 * gate, and reporting it would be a false alarm.
 */
export function blocksOnFirstWrite(tools: readonly string[]): boolean {
  const canChange = tools.includes("write") || tools.includes("edit");
  const canDeclare = tools.includes("nodd_declare");
  return canChange && !canDeclare;
}
