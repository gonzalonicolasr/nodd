# Spec delta — nodd-odd-completo

Canonical store: `.sdd/specs/requirements.md` **does not exist** (verified:
`ls .sdd/` returns `.executions`, `nodd`, `nodd-odd-completo` only). It is
therefore treated as an empty store and every requirement below is `## ADDED`.

Note on naming: `.sdd/nodd/requirements.md` is a *prior run's* artifact, not the
canonical store. Its `REQ:` names are reused here only where this run modifies
the behaviour they describe, and each such block states the relationship
explicitly in prose so no name collides ambiguously.

## ADDED

### REQ: write-accounting-observes-outcome

`filesWritten` models the **state of the workspace**, not agent activity. A
`write` or `edit` whose tool result reports an error did not change the
workspace, and must not be recorded as a file this session wrote.

This is distinct from `toolCalls`, which models **activity**: a refused call
still happened and must still count, because the long-session backstop measures
how long the session has run without delegating. `extensions/nodd-kernel.ts:613-615`
("Record the call either way") is correct for `toolCalls` and wrong for
`filesWritten`; the two counters answer different questions and must not share
a policy.

The reducer stays pure. It decides from the observation's `isError` field only,
and performs no filesystem check: `existsSync` inside `fold()` would trade a
testable pure function for an untestable one, and a non-error result is the best
evidence a tool result can offer.

This requirement supersedes the unconditional write recording in
`src/state.ts:124`.

Acceptance criteria:
- `fold()` given a `write` observation with `isError: true` leaves `filesWritten`
  empty; the same observation with `isError: false` records the path.
- The same holds for `edit`.
- `toolCalls` increments for both, proving the two counters are governed
  separately.
- An end-to-end case: N consecutive refused writes do not advance
  `gate-delegate`'s writer trigger, so a session cannot be locked out by its own
  refusals. A unit test of `fold` alone does not satisfy this criterion.
- `fold()` imports no `node:fs` symbol — asserted by a source scan, so the
  purity is structural rather than a convention.
- Mutation check: reverting `src/state.ts` to record unconditionally must fail
  at least one test in this set.

### REQ: gate-refusal-reachability

Every gate refusal must offer at least one remedy executable by the actor that
received it, and no refusal may worsen the state that caused the refusal.

Two failure modes this forbids, both observed in this repository:

1. **Unreachable remedy.** `gate-classify` instructs the caller to run
   `nodd_declare` or `/nodd-allow classify`. A subagent has neither: the tool is
   absent from its toolset and slash commands do not exist in that context.
   `src/gates/track.ts:41-50` already documents this class and ships a narrow
   emergency door; `gate-classify` has the defect without the remedy.
2. **Self-amplifying refusal.** A refused write that increments the counter
   driving the next refusal makes the block permanent. Crossing
   `writerMinNonTrivialFiles` then blocks every subsequent write in the session
   with no exit. `REQ: write-accounting-observes-outcome` removes the cause; this
   requirement forbids the class.

Acceptance criteria:
- A test enumerates `GATE_IDS` and asserts each gate's refusal text names at
  least one remedy that does not require a tool or slash command unavailable to
  a subagent, or that the gate ships a documented narrow escape comparable to
  `track`'s.
- A test asserts no gate's refusal path mutates state that feeds its own
  trigger.
- The audit is a table in `design.md` covering all six gates, so `veredicto` can
  re-run it.

### REQ: canonical-step-router-total

Every canonical step that owns forwarded prose must be reachable by the router
that selects it. A step with prose in the corpus and no path to being selected
is a forwarding the parity matrix claims and the product does not perform.

`currentStep()` (`src/prompt.ts:62-68`) today returns only `authorize`,
`classify`, `explore`, `implement` or `track`. `resolve-uncertainty` (621
characters of prose, matrix rows 6, 32, 34, 35, 36) and `close` (119 characters,
row 49) are unreachable.

Acceptance criteria:
- A test asserts that for every step in `CANONICAL_STEPS` carrying at least one
  `ODD_PROSE` entry, some committed state causes `currentStep()` to return it.
  The test derives the step list from the corpus, so adding prose for an
  unreachable step fails.
- `renderBlockB` for the newly reachable steps is non-empty and within
  `BLOCK_B_BUDGET`.
- Mutation check: deleting a router branch must fail this test.
- The selection rule for each new step is derived from observed state only, and
  the rule is stated in `design.md`.

### REQ: read-only-delegation-by-capability

Under `intent: read-only`, delegating to a **writer** is refused and delegating
to a **read-only worker** is permitted.

ODD `:44` forbids read-only work from delegating a writer. ODD `:70` and `:92`
require a read-only exploration/research worker to remain available, and `:92`
explicitly directs research to "a fresh general exploration/research worker".
Blocking every `subagent` call, as `src/gates/authorize.ts:24` does today,
forbids the delegation path ODD makes mandatory.

The distinction must be drawn from what the target subagent **can do**, never
from a hardcoded list of NODD agent names: a name list would silently
misclassify every user-defined agent and would break the moment an agent is
renamed.

Acceptance criteria:
- Under `intent: read-only`, a `subagent` call targeting a read-only agent is
  allowed; one targeting a writer is refused with the existing remedy shape.
- The decision reads the target's declared capability; a test asserts
  `src/gates/authorize.ts` contains no literal NODD agent name.
- An unknown or unreadable target is refused, not allowed: under an explicit
  read-only declaration the conservative answer is the safe one, and the refusal
  says the capability could not be determined.
- Every other `authorize` behaviour is unchanged: `write`, `edit` and mutating
  bash still refuse under `read-only`.
- Mutation check: restoring the blanket `subagent` block must fail this set.

### REQ: configurable-slot-has-consumer

A slot `/nodd-models` offers for assignment must have a consumer in the
package. A slot that can be assigned and is read by nothing is the overclaim
NODD exists to refuse.

`orchestrator` has no consumer: it appears only in `src/models/slots.ts:23`,
`src/manifest.ts:55` and tests. It is removed from the assignable set rather
than given effect, because the only way to give it effect is writing the parent
model into `~/.pi/agent/settings.json` — a second configuration surface, in a
file NODD does not own, controlling a process NODD does not launch.

`default` is retained: it is the model fallback every generated agent reads
(`extensions/nodd-agents.ts:160`), and is relabelled in the picker to say so.

Acceptance criteria:
- A test asserts every id in `CONFIGURABLE_SLOTS` is read by at least one
  non-test source file under `src/` or `extensions/`, so a future inert slot
  fails on arrival.
- `orchestrator` is absent from `CONFIGURABLE_SLOTS` and from the picker's
  assignable rows; assigning it is refused with a message saying the slot no
  longer exists and what replaced it.
- The `default` row's label states it is the fallback used when a step's own
  slot is unset.
- The existing tests that pin `orchestrator` as assignable
  (`src/manifest.test.ts:42`, `src/models/assign.test.ts:32`,
  `src/models/picker.test.ts:100`, `extensions/nodd-models.test.ts:53`) are
  updated with intent, not deleted.

### REQ: slot-removal-migrates-user-config

Removing an assignable slot must not silently discard a user's existing
assignment. The user's `~/.pi/nodd.json` assigns `orchestrator` in all 10
profiles and in the active loose config.

On load, a one-time reconciler rewrites `orchestrator` → `default` in the loose
config and in every profile, **only where `default` is unset**, and leaves an
existing `default` untouched. The same rule applies to the parallel `thinking`
map, so a migrated model does not lose the effort level it was configured with.

Acceptance criteria:
- Migration is idempotent: running it twice produces a byte-identical file, and
  the second run performs no write.
- It writes nothing when there is nothing to migrate — a config without
  `orchestrator` is not rewritten, and no backup is created for a no-op.
- A profile with both `orchestrator` and `default` keeps `default` and drops
  `orchestrator`, reporting which profiles changed.
- Every unrelated key, every other profile field and `activeProfile` survive
  byte-for-byte; the 10-profile fixture round-trips with only the intended
  change.
- A timestamped backup is written before the first mutating migration.
- A malformed or unreadable config is left untouched and reported, never
  partially rewritten.

### REQ: parity-matrix-claims-are-live

A matrix row classified **(M)** or **(P)** must describe behaviour the shipped
product performs, not merely a module that exists.

`REQ: odd-parity-matrix` (prior run) already requires each **(M)** row to name
an existing mechanism. That test resolves *names*; it passed while rows 6, 32,
34, 35, 36 and 49 claimed prose forwarding that no turn could receive, because
the corpus entry existed while the router could not reach its step. Naming is
necessary and not sufficient.

Acceptance criteria:
- For every **(P)** row, a test asserts its corpus entry is reachable through
  the step router, closing the gap `REQ: canonical-step-router-total` exposes.
- The README's description of forwarded prose matches which steps can actually
  be selected.
- No matrix row is re-classified by this run; the rows were correct in intent
  and the product failed to honour them.
