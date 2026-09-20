# Tasks — nodd-odd-completo

Ordered by risk, riskiest first. T001 lands before anything else: it fixes an
active lockout that can trap any session, and three gates read the state it
corrupts.

Strict TDD applies (`.sdd/config.json` absent, so `tdd.mode` is unset and a
runner exists). Every task writes its RED test first. Every task ends with a
**mutation check**: neutralize the mechanism, confirm the named test dies.

Run tests with an isolated HOME:
`TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test`

Baseline to preserve: **497 passing**.

---

### T001 — Refused writes must not count as writes

- files:
  - `/home/gon/projects/nodd/src/state.ts`
  - `/home/gon/projects/nodd/src/state.test.ts`
- detail: In `fold()` (`src/state.ts:124`), record a `write`/`edit` path into
  `filesWritten` only when `obs.isError !== true`. `toolCalls` must keep
  counting refused calls — the two counters answer different questions (see
  `design.md` § "D1 — write accounting"). Audit `filesRead` and `delegations` in
  the same pass: both record unconditionally today and are wrong for the same
  reason; fix them under the same rule. Do **not** add `existsSync` or any
  `node:fs` import — `fold()` stays pure. Do not change `commandResults`, which
  already stores `isError` correctly.
- depends: []
- evidence: `npm test -- src/state.test.ts` passes, including: a `write` with
  `isError: true` leaves `filesWritten` empty; the same with `isError: false`
  records it; `edit` behaves identically; `toolCalls` increments for both.
  Mutation check: remove the `isError` condition and this test must fail.
- review: ~70 changed lines

### T002 — The self-amplifying lockout, end to end

- files:
  - `/home/gon/projects/nodd/src/gates/delegate.test.ts`
- detail: Test only — proves T001 actually closed the trap, which a unit test of
  `fold` cannot show. Fold N consecutive refused writes (`isError: true`,
  distinct paths) and assert `delegateGate` still allows: the writer trigger must
  not advance on refusals. Include the exact observed sequence from this session
  (three refused writes, zero files on disk, counter reported 3). Add the
  companion case: refused writes followed by one real write leave the counter at
  1, not 4.
- depends: T001
- evidence: `npm test -- src/gates/delegate.test.ts` passes. Mutation check:
  revert T001 and this test must fail with the "written N distinct files"
  refusal.
- review: ~60 changed lines

### T003 — Re-verify the two other gates that read `filesWritten`

- files:
  - `/home/gon/projects/nodd/extensions/nodd-kernel.test.ts`
- detail: Test only. `gate-promotion` reads `observedFiles`
  (`nodd-kernel.ts:495-496`) and `gate-evidence` reads `lastWrite()` (`:540`);
  both were contaminated by D1. Assert: refused writes do not inflate
  `observedFiles` into false divergence, and a refused write does not advance
  `lastWriteSeq` and so does not invalidate evidence that legitimately postdates
  the last real write. No production change expected — if one of these still
  fails after T001, fix it here and say so.
- depends: T001
- evidence: `npm test -- extensions/nodd-kernel.test.ts` passes with both new
  cases. Mutation check: revert T001 and both must fail.
- review: ~70 changed lines

### T004 — Make the step router total

- files:
  - `/home/gon/projects/nodd/src/prompt.ts`
  - `/home/gon/projects/nodd/src/prompt.test.ts`
- detail: `currentStep()` (`src/prompt.ts:62-68`) can never return
  `resolve-uncertainty` or `close`, so 740 characters of corpus prose reach no
  turn while the parity matrix claims they are forwarded. Add both branches
  using observed state only, per `design.md` § "D2": `resolve-uncertainty` when
  delegation has happened and no `change` intent is declared (ordered *before*
  the `explore` branch, which currently absorbs that state); `close` when the
  declared work is complete. If `close` is not derivable from `Committed`
  without adding I/O, narrow it to the simplest observable rule and record the
  limitation in a comment — do not widen the module's dependencies.
- depends: []
- evidence: `npm test -- src/prompt.test.ts` passes, including a test that
  derives the step list from `ODD_PROSE` and asserts every step owning prose is
  returnable by `currentStep()` for some state. Mutation check: delete either
  new branch and that test must fail.
- review: ~90 changed lines

### T005 — Pin that every (P) row is actually reachable

- files:
  - `/home/gon/projects/nodd/src/odd-prose.test.ts`
- detail: Test only. The existing suite checks each (P) row *exists* in the
  corpus; it passed while six rows were unreachable. Add the reachability
  assertion: every corpus entry's step must be selectable by the router, and
  `renderBlockB` for it must be non-empty and within `BLOCK_B_BUDGET`. This is
  the test that would have caught D2.
- depends: T004
- evidence: `npm test -- src/odd-prose.test.ts` passes. Mutation check: revert
  T004 and this fails, naming the unreachable step.
- review: ~45 changed lines

### T006 — Read-only may delegate to a read-only worker

- files:
  - `/home/gon/projects/nodd/src/gates/authorize.ts`
  - `/home/gon/projects/nodd/src/gates/authorize.test.ts`
  - `/home/gon/projects/nodd/extensions/nodd-kernel.ts`
- detail: `authorize.ts:24` blocks every `subagent` call under
  `intent: read-only`, forbidding the read-only delegation ODD `:70`/`:92`
  requires. Decide by the target's **declared capability**, never by name: the
  gate takes an injected capability lookup, following the existing
  `trackGate(…, docExists)` pattern; the kernel supplies it by reading the agent
  definition's `tools:`. A target whose capability cannot be determined is
  **refused**, with a reason saying so. No literal NODD agent name may appear in
  `authorize.ts`.
- depends: []
- evidence: `npm test -- src/gates/authorize.test.ts` passes: a read-only target
  is allowed, a writer target refused, an unresolvable target refused, and
  `write`/`edit`/mutating-bash still refuse under `read-only`. A source-scan
  assertion proves no agent name literal is present. Mutation check: restore the
  blanket block and the read-only-target case must fail.
- review: ~130 changed lines

### T007 — Characterize the slot surface before changing it

- files:
  - `/home/gon/projects/nodd/src/models/slots.test.ts` (new)
- detail: Test only, and it must land **before** T008 — pin today's behaviour so
  the removal delta is visible rather than inferred. Capture: which ids
  `CONFIGURABLE_SLOTS` contains, which rows the picker shows as assignable, and
  that `orchestrator` is currently accepted by `validateAssignment`. This is the
  characterization step `rdd-delivery-exception-removal` calls for.
- depends: []
- evidence: `npm test -- src/models/slots.test.ts` passes against the **current**
  code, documenting `orchestrator` as assignable.
- review: ~60 changed lines

### T008 — Remove the inert `orchestrator` slot; label `default`

- files:
  - `/home/gon/projects/nodd/src/models/slots.ts`
  - `/home/gon/projects/nodd/src/manifest.ts`
  - `/home/gon/projects/nodd/src/models/slots.test.ts`
  - `/home/gon/projects/nodd/src/manifest.test.ts`
  - `/home/gon/projects/nodd/src/models/assign.test.ts`
  - `/home/gon/projects/nodd/src/models/picker.test.ts`
  - `/home/gon/projects/nodd/extensions/nodd-models.test.ts`
- detail: Drop `orchestrator` from `GLOBAL_SLOTS` (`slots.ts:23`) and
  `CONFIGURABLE_SLOTS` (`manifest.ts:55`), leaving
  `default, explore, resolve-uncertainty, implement`. Assigning it is refused
  with a message naming what replaced it. Relabel the `default` row as the
  fallback used when a step's own slot is unset. Add the guard test: every id in
  `CONFIGURABLE_SLOTS` must be read by at least one non-test source under `src/`
  or `extensions/`, so the next inert slot fails on arrival. Update the four
  existing tests that pin `orchestrator` as assignable **with intent** — rewrite
  the assertion, never delete the test.
- depends: T007
- evidence: `npm test -- src/models/ src/manifest.test.ts extensions/nodd-models.test.ts`
  passes. Mutation check: re-add `orchestrator` to `CONFIGURABLE_SLOTS` and the
  consumer-guard test must fail.
- review: ~150 changed lines

### T009 — Migrate `orchestrator` → `default` in user config

- files:
  - `/home/gon/projects/nodd/src/models/profiles.ts`
  - `/home/gon/projects/nodd/src/models/profiles.test.ts`
  - `/home/gon/projects/nodd/extensions/nodd-models.ts`
- detail: Highest-blast-radius task: it edits the file holding the user's 10
  profiles. Pure transform in `profiles.ts`, I/O in the extension. Rule, applied
  to the loose config and every profile, and to the parallel `thinking` map: if
  `orchestrator` is set and `default` is unset, move it; if both are set, drop
  `orchestrator`; if neither, do nothing. **Write only when something changed** —
  a no-op must perform no write and create no backup, or every session start
  rewrites the user's config. Timestamped backup before the first mutating
  write. Malformed config: leave untouched and report, never partially rewrite.
  Test against a fixture copied from the real 10-profile file, never against
  `~/.pi/nodd.json` itself.
- depends: T008
- evidence: `npm test -- src/models/profiles.test.ts` passes: idempotent (second
  run byte-identical, no write); no-op writes nothing; both-set keeps `default`;
  `activeProfile`, unrelated keys and the other 9 profiles survive byte-for-byte;
  malformed input untouched. Mutation check: remove the "changed?" guard and the
  idempotence test must fail.
- review: ~170 changed lines

### T010 — Give `gate-classify` a reachable remedy

- files:
  - `/home/gon/projects/nodd/src/gates/classify.ts`
  - `/home/gon/projects/nodd/src/gates/classify.test.ts`
- detail: `classify` tells the caller to run `nodd_declare` or
  `/nodd-allow classify`; a subagent has neither, so it blocked every write of
  this planning run. `src/gates/track.ts:41-50` already solved this class with a
  narrow emergency door — follow that precedent or, if a door is not
  appropriate here, make the refusal name a remedy the recipient can actually
  perform. Keep the door narrow and state its bound in a comment, as `track`
  does. Do not weaken the gate for a parent session, where the existing remedy
  is correct.
- depends: []
- evidence: `npm test -- src/gates/classify.test.ts` passes, including a case
  asserting the refusal offers a remedy available without `nodd_declare` or a
  slash command. Mutation check: remove the new path and that test must fail.
- review: ~90 changed lines

### T011 — Audit all six gates against the reachability invariant

- files:
  - `/home/gon/projects/nodd/test/gate-reachability.test.ts` (new)
- detail: Test only. Encode `design.md` § "The deadlock class" so `veredicto` can
  re-run it: for each id in `GATE_IDS`, assert (a) the refusal names at least one
  remedy executable by its recipient, and (b) no refusal path mutates state
  feeding its own trigger. Where a gate legitimately cannot satisfy (a) for every
  caller, it must carry a documented narrow escape like `track`'s, and the test
  asserts that door exists.
- depends: T001, T010
- evidence: `npm test -- test/gate-reachability.test.ts` passes over all six
  gates. Mutation check: revert T010 and the `classify` row must fail.
- review: ~110 changed lines

### T012 — Reconcile the README with what now ships

- files:
  - `/home/gon/projects/nodd/README.md`
  - `/home/gon/projects/nodd/test/readme-contract.test.ts`
- detail: Every README claim is contract-tested, so this lands last, after
  behaviour is settled. Update: the slot list and the `default` fallback
  semantics under "Choosing models" (~lines 90-103); the `orchestrator` removal
  and its migration; that read-only work may delegate to a read-only worker but
  not a writer; and which steps forward prose. Add the five fixed defects where
  the README describes the affected gate. Claim nothing the mechanism does not
  do — verify each sentence against the code, not against this plan.
- depends: T004, T006, T008, T009
- evidence: `TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test` — full suite
  green, ≥497 passing, `test/readme-contract.test.ts` and
  `test/parity-matrix.test.ts` included.
- review: ~120 changed lines

### T013 — Restore the gate configuration

- files:
  - `/home/gon/.pi/nodd.json`
- detail: Not a code task; a required cleanup. This run disabled `track`,
  `classify`, `delegate`, `evidence` and `promotion` so the planning phase could
  write. Restore from `~/.pi/nodd.json.bak-odd-run`, preserving the user's
  original intent: `track` was **already** disabled by the user before this run
  and must stay that way; the other four were disabled by this run and must go
  back to enabled. Verify the 10 profiles and `activeProfile: personal-claude`
  are intact afterwards.
- depends: T012
- evidence: `~/.pi/nodd.json` shows `classify`, `delegate`, `evidence` and
  `promotion` enabled, `track` disabled, 10 profiles present, `activeProfile`
  unchanged. Confirm by reading the file.
- review: ~5 changed lines

---

## Review Workload

Budget: **400** changed lines per task.

| task | estimate |
| --- | --- |
| T001 — refused writes not counted | ~70 |
| T002 — self-amplifying lockout, end to end | ~60 |
| T003 — re-verify promotion and evidence | ~70 |
| T004 — make the step router total | ~90 |
| T005 — pin (P) row reachability | ~45 |
| T006 — read-only delegation by capability | ~130 |
| T007 — characterize the slot surface | ~60 |
| T008 — remove `orchestrator`, label `default` | ~150 |
| T009 — migrate user config | ~170 |
| T010 — reachable remedy for `classify` | ~90 |
| T011 — six-gate reachability audit | ~110 |
| T012 — reconcile the README | ~120 |
| T013 — restore gate configuration | ~5 |

**Total: ~1170 changed lines.**

Over-budget exceptions: **none** — the largest task is T009 at ~170, well under
400.

### PR batches

Chained series; each batch is independently reviewable and `veredicto`-able.

1. **PR 1 — the lockout fix (T001, T002, T003).** Lands first and alone: it
   fixes an active trap and three gates depend on the corrected state. Smallest
   diff, highest urgency.
2. **PR 2 — prose reachability (T004, T005).** Independent of PR 1; may be
   reviewed in parallel but should merge after it to keep the series linear.
3. **PR 3 — read-only delegation (T006).** Self-contained.
4. **PR 4 — the slot surface (T007, T008, T009).** Must be one PR: the
   characterization, the removal and the migration are only coherent together.
   Touches user config — the batch needing the most careful review.
5. **PR 5 — the deadlock invariant (T010, T011).** Depends on T001 landing.
6. **PR 6 — README and cleanup (T012, T013).** Last, once behaviour is settled.

Ordering constraint: PR 1 before PR 5 (T011 depends on T001), and PR 6 last
(T012 depends on T004, T006, T008, T009).
