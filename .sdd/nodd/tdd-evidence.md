# TDD Cycle Evidence — nodd

Runner: `node --test --experimental-strip-types [file]`. Strict TDD mode active
(no `.sdd/config.json`, so strict is the default).

**Gap acknowledged:** rows for T001–T021 were never recorded (the prior build
run did not create this file). The cycles below start at T022, where this
continuation began. Rows are appended, never rewritten.

| task | RED (observed) | GREEN (observed) | notes |
| --- | --- | --- | --- |
| T022 | `review-candidate.test.ts` fails: module absent | 9/9 pass | `candidate` made required on checked tasks at the type level |
| T023 | `change-acceptance.test.ts` fails: module absent | 12/12 pass | reopen requires a reason; stale evidence dropped |
| T024 | `delivery.test.ts` fails: module absent | full suite 171/171 | source-scan test: no gate may reach a line count |
| T025 | `models/assign.test.ts` fails: module absent | 13/13 pass | registry-backed validation, ambiguity refused |
| T026 | `models/picker.test.ts` fails: module absent | 12/12 pass | 2 test defects found and fixed during GREEN (row filter, import regex) |
| T027 | `models/profiles.test.ts` fails: module absent | 19/19 pass | verbs are pure transforms; the command decides to write |
| T028 | `nodd-models.test.ts` fails: module absent | 14/14 pass | 1 RED was a real violation: the TUI package name appeared in a comment |
| T029 | `nodd-agents.test.ts` fails: module absent | 12/12 pass | no `extensions:` line in generated frontmatter |
| T030 | `promote.test.ts` fails: module absent | 10/10 pass | source scan: no `design.md`/`tasks.md` emitted |
| T031 | `nodd-promote.test.ts` fails: module absent | 10/10 pass | `.sdd/` single-writer scan over every other source file |
| T032 | `gates/promotion.test.ts` fails: module absent | 13/13 pass | 1 test defect: fixture used `tool:` instead of the real `toolName:` |
| T033 | `odd-prose.test.ts` fails: module absent | 13/13 pass | 1 test defect: `await` in a non-async callback |
| T034 | `prompt.test.ts` fails: module absent | 15/15 pass | measured headroom: widest block B is 825 of 2500 |
| T035 | `nodd-prompt.test.ts` fails 8/8: no `before_agent_start` handler | 8/8 pass | chained, never replacing the incoming prompt |
| T036 | `readme-contract.test.ts` fails 11/15 | 15/15 pass | 1 test defect: section helper stopped at the first `###` |
| T037 | `nodd-enforcement.test.ts` fails 14/17 | 17/17 pass | see below |

## T037 — additional verification

Because T037 is the task that makes every other gate real, its RED was not
trusted on its own. After GREEN, the handler's call to `checkCall` was stubbed
to `null` and the suite re-run: **17/17 → 5/17**. The test therefore fails if the
handler only observes, which is what it was written to detect.

One real-path discovery during GREEN, reported rather than worked around: six
tests failed because the test helper invoked the `nodd_declare` tool handler
directly, while committed state only advances on a `tool_result` event. The
**test** was unfaithful to pi's event sequence, not the code; the helper was
changed to fire `tool_call` → execute → `tool_result` as a real session does.
No production behaviour was adapted to make a test pass.

## Full-suite checkpoints

| after | result |
| --- | --- |
| T024 | 171 tests, 171 pass, 0 fail |
| T035 | 310 tests, 310 pass, 0 fail |
| T037 (final) | **343 tests, 343 pass, 0 fail** |

---

# Round 2 — the four blockers of `veredicto.md`

The round-1 verdict was `corregir`. Its transversal finding: in four places the
product claimed more than the mechanism delivered — the exact sin NODD accuses
ODD of. Each fix below states which of the two options was taken, **implement
the mechanism** or **lower the claim to the truth**, and why.

Every blocker also carries a **mutation** row, because the residual risk the
verdict named was that green tests proved nothing: for each guarantee the README
declares, neutralizing the mechanism must turn the suite red.

## TDD Cycle Evidence

| task | RED (test first) | GREEN | mutation: neutralize the mechanism |
| --- | --- | --- | --- |
| T038 | budget asserted on the corpus, 3 fail | 346/346 | +40 padding clauses → 3 fail (`block B at implement is 4495 > 2500 before truncation`); padding existing clauses only → 2 fail |
| T039 | 6 fail in `state.test.ts` + `evidence.test.ts`; then 1 e2e fail | 359 → 365/365 | `lastWrite` → epoch/0: stale-green e2e fails. Runner binding removed: 3 fail incl. both attacks |
| T040 | 3 fail in `nodd-enforcement.test.ts` | 372/372 | **deleting the `promotion` registry row: 3 fail** (round 1: 0). Signals back to hardcoded zeros: 3 fail |
| T041 | 4 fail in `nodd-enforcement.test.ts` | 380/380 | replay rehydrates `commandResults`: 2 fail. `appendRecord` call removed: 2 fail. `observedCalls` not passed: 1 fail |
| T042 | 7 of 9 fail in `parity-matrix.test.ts` | 389/389 | row 46 pointed at a nonexistent `REQ:`: 1 fail. `## Outcome` not derived: 2 fail |

## Decisions per blocker

**B4 (T038) — implemented.** `fit()` truncated silently with `…` and the test
asserted the length *after* truncation, so it measured the truncator rather than
the corpus. The budget is now asserted against the unbudgeted render. The cut
stays in production, because the cap *is* the mechanism, but it announces itself
in-block and via `overBudget`.

**B3 (T039) — implemented.** Evidence was bound to neither the task nor the
write. `filesWritten` was a timestamp-less `Set`, so "the run came after the
edit" was not computable, and `lastWriteAt` read `commandResults`, which only
ever held bash. Writes now carry a time and a sequence, and the runner is
declared up front. The residual limit — the model still chooses the runner — is
documented rather than papered over.

**B1 (T040) — split decision.** `declaredFiles` and `consecutiveFailures` are
derivable from observed events, so they were **implemented**. `userRequested`
is not: `/nodd-promote` holds no kernel state and performs the promotion itself,
so the claim was **lowered** — deleted from the type, the gate, the requirement
and the README. A hardcoded `false` is worse than an absent condition.

**B2 (T041) — implemented, both halves.** (a) Replay now restores context but
not `commandResults`, making the README's fail-closed promise true. (b)
`appendRecord` gained its production caller, and `classifyRecords` receives the
observed calls, so the documented `mismatch` case is reachable instead of being
unreachable code.

**M1 (T042) — implemented, plus one honest reclassification.** Row 13 gained a
real mechanism (`renderOutcome` derives `## Outcome` on every save); its "next
step" clause was reclassified **(P)**, because which work comes next is a
judgement. Rows 45 and 46 were mechanized by T039 and reworded to name it. The
hollow criterion `assert.ok(README.includes("(M)"))` was replaced by a test that
resolves every citation against the package.

## Real-path discoveries, reported rather than worked around

1. **Wall clocks cannot order a write against the run after it.** The stale-green
   e2e test failed on a real defect: both landed in the same millisecond, so
   `run.at >= lastWriteAt` admitted the stale run. Ordering now uses the
   kernel's observation sequence, which it knows exactly.
2. **The replay path was dead code, and its test asserted a shape pi never
   emits.** `SessionStartEvent` has no `entries` field
   (`types.d.ts:416-422`); the log is reached via
   `ctx.sessionManager.getEntries()`, and custom entries are
   `{ type: "custom", customType, data }` (`session-manager.d.ts:69-73`). The
   old test fabricated `{ entries: [...] }` with `entry.type`, so it passed
   while production replayed nothing. Test and code both corrected.
3. **Two unfaithful test fixtures, fixed rather than accommodated.** The
   enforcement helper re-minted `call-0` in a resumed session, which the reducer
   correctly dropped as a duplicate — real pi never reuses ids within a session
   file. And `ledgerFor()` wrote `unknown` for failing runs, which is not what
   `appendRecord`'s caller derives; once the gate compared ledger to session,
   that invented value read as tampering. Both were the fixture's fault.
4. **`gate-promotion` needed write intent, not just finished writes.** Counting
   only `filesWritten` refused the divergence one file late, after the divergent
   write had happened.

## Contract changes that required updating existing tests

Declarations now record a `runner`, and `## Outcome` is derived rather than
supplied. Fixtures in `src/state.test.ts`, `src/gates/evidence.test.ts`,
`src/feature-doc.test.ts`, `src/change-acceptance.test.ts` and
`extensions/nodd-kernel.test.ts` were updated for the new contract. These are
documented contract changes, not tests weakened to hide a regression — each
mutation row above shows the corresponding guarantee still fails closed.

## Full-suite checkpoints

| after | result |
| --- | --- |
| round-1 baseline | 343 tests, 343 pass, 0 fail |
| T038 | 346 tests, 346 pass, 0 fail |
| T039 | 365 tests, 365 pass, 0 fail |
| T040 | 372 tests, 372 pass, 0 fail |
| T041 | 380 tests, 380 pass, 0 fail |
| T042 | 389 tests, 389 pass, 0 fail |
| mutation coverage (round 2 final) | **391 tests, 391 pass, 0 fail** |
| T043 | 394 tests, 394 pass, 0 fail |
| T044 | 395 tests, 395 pass, 0 fail |
| T045 (round 3 final) | **396 tests, 396 pass, 0 fail** |

## Round 3 cycles

| task | RED (observed) | GREEN (observed) | notes |
| --- | --- | --- | --- |
| T043 | `an unpinned runner is disclosed...` fails: `actual: 'success', expected: 'success (runner not pinned)'` | 16/16 in `evidence.test.ts`, then 394/394 | H1. A second test drives the same property end-to-end through the registered handler and asserts the caveat is **absent** on a pinned checkoff, so the disclosure has to discriminate rather than decorate |
| T044 | `the runner cannot be re-declared...` fails: got `.nodd/login/feature.md created with 1 tasks` where a refusal was required | 395/395 | Found by the sweep, not by the verdict |
| T045 | `strict TDD without a pinned runner...` fails: got `.nodd/notdd/feature.md created with 0 tasks` | 396/396 | Found by the sweep, not by the verdict |

One pre-existing fixture changed: `extensions/nodd-tools.test.ts:114` declared
no runner and asserted the outcome was exactly `success`. Under T043 that path
correctly records `success (runner not pinned)`. The fixture was made *more*
specific — it now pins `runner: "node --test"`, which is what a tracked
declaration ordinarily does — rather than relaxing the assertion to accept
either string. The unpinned path keeps its own dedicated tests.

## Round 3 mutation coverage

Each round-3 mechanism was neutralized in place and the full suite re-run:

| mutation | failures |
| --- | --- |
| `renderObserved` drops the `(runner not pinned)` caveat | 2 |
| the re-pin refusal is short-circuited to `if (false)` | 1 |
| the `tdd: strict` runner requirement is short-circuited to `if (false)` | 1 |

## README sweep (round 3)

Every guarantee the README states was checked for a mechanism **and** for a
test that dies when that mechanism is neutralized. 15 mutations were run
against the full suite; all but the noted exception killed at least one test.
The three that had no mechanism became T043/T044/T045. The one guarantee that
cannot be mechanized — "a sentence in this file does not promise more than the
code does" — is now stated as a limitation in the README instead of being
claimed as asserted.

## Mutation coverage of the gate registry

The verdict's residual risk was that a gate could be wired and inert. Every
registry row was deleted in turn and the suite re-run:

| unwired gate | failures |
| --- | --- |
| `authorize` | 5 |
| `track` | 1 |
| `classify` | 7 |
| `delegate` | 2 (was **0** — fixed in this round) |
| `promotion` | 3 (was **0** — B1) |

`gate-evidence` is not a registry row: it guards `nodd_task check`, not writes.
Bypassing it there fails 9 tests.

`gate-delegate` was a second instance of B1 found by running the same mutation
across every gate rather than only the one the verdict named: it had thorough
unit tests and no proof of being registered. Two end-to-end tests now drive the
writer and mapping thresholds through the real handler.
