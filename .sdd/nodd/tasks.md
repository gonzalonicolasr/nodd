# Tasks — NODD

Code root: `/home/gon/projects/nodd` (all paths below are relative to it).
Reference roots are read-only and never edited: `/home/gon/zero/packages/zero-pi`,
`/tmp/gentle-ai`, the pi install under
`/home/gon/.local/share/mise/installs/node/26.2.0/lib/node_modules/@earendil-works/pi-coding-agent`.

Test command everywhere: `node --test --experimental-strip-types <file>`
(zero-pi's own runner, `package.json:116-119`). Order follows the mandated
sequence: skeleton and schema → read-only kernel → gates one at a time → observed
evidence → `/nodd-models` → promotion → dynamic prompt last. **T010 is a spike
and blocks everything that depends on child-runtime enforcement.**

---

### Block 1 — Skeleton and schema

## [x] T001 — Package skeleton with pi manifest

- files:
  - `package.json` (new)
  - `.gitignore` (new)
  - `README.md` (new)
  - `test/package-invariants.test.ts` (new)
- detail: `"type": "module"`, `pi-package` keyword, `pi.extensions` listing the
  five extension entrypoints, `@earendil-works/pi-coding-agent` under
  `peerDependencies` only, `"test": "node --test --experimental-strip-types"`.
  README is a stub here; T036 fills it. No build pipeline, no `tsconfig.json`.
- depends: []
- evidence: `node --test --experimental-strip-types test/package-invariants.test.ts`
  passes, asserting `pi.extensions` is non-empty, every listed path exists,
  `peerDependencies` holds pi, `dependencies` does not, and no repo file matches
  `pi-tui`.
- review: ~80 changed lines

## [x] T002 — Manifest thresholds and canonical step list

- files:
  - `src/manifest.ts` (new)
  - `src/manifest.test.ts` (new)
- detail: the five thresholds from
  `/tmp/gentle-ai/internal/agents/capabilitymanifest/manifest.go:203-216`
  (inline 1–3, mechanical write max 1, mapping 4, writer 2) plus the 20-tool-call
  backstop from `routing.go:82`. Frozen seven-step array in canonical order and
  the five-slot configurable set. Pure constants, no I/O.
- depends: T001
- evidence: `node --test --experimental-strip-types src/manifest.test.ts` passes,
  asserting each threshold's exact value, the step order, and that the four
  mechanism steps are absent from the configurable slot set.
- review: ~60 changed lines

## [x] T003 — `~/.pi/nodd.json` config module

- files:
  - `src/config.ts` (new)
  - `src/config.test.ts` (new)
- detail: path helper, schema (`models`, `profiles`, `activeProfile`, `gates`),
  tolerant read (absent / empty / `{{{` → defaults), and a pure merge that
  preserves unknown keys. No `zero.json`, ever.
- depends: T002
- evidence: `node --test --experimental-strip-types src/config.test.ts` passes,
  including a source-scan assertion that no file under `src/` or `extensions/`
  contains the literal `zero.json`, and a merge test preserving an unknown key
  byte-for-byte.
- review: ~120 changed lines

## [x] T004 — Observation model and committed/pending state types

- files:
  - `src/observations.ts` (new)
  - `src/observations.test.ts` (new)
- detail: `Observation` records keyed by `toolCallId` and carrying raw observed
  fields only (`toolName`, `input`, `isError`, result text). `NoddState` splits
  `committed` from `pending: Map<string, PendingCall>`. **Outcome interpretation
  is deliberately not here** — the ledger stores raw observations and T019
  derives outcomes, so evidence is always re-derivable and never pre-collapsed.
  Types plus constructors; no reducer yet.
- depends: T002
- evidence: `node --test --experimental-strip-types src/observations.test.ts`
  passes, asserting an `Observation` cannot be constructed without a
  `toolCallId`, and that no field of the raw record is a boolean named
  `ok`/`passed`/`success`.
- review: ~100 changed lines

## [x] T005 — Feature-doc parse and render

- files:
  - `src/feature-doc.ts` (new)
  - `src/feature-doc.test.ts` (new)
- detail: schema from `/tmp/gentle-ai/odd/tasks/odd-mandatory-delegation.md` —
  title, Objective, Problem, Scope, Constraints, Route, Tasks (`T<n>` +
  `[ ]`/`[x]`), Outcome, Progress. `## Delivery` lands in T024. Missing sections
  return a typed defect list, never a throw. Deterministic rendering. A checked
  task carries its evidence reference by type, so rendering a checked task
  without one does not compile.
- depends: T004
- evidence: `node --test --experimental-strip-types src/feature-doc.test.ts`
  passes, including `parse(render(doc))` deep-equal round-trips for 0, 1 and 3
  tasks, byte-identical double render, and a missing-section defect list.
- review: ~220 changed lines

## [x] T006 — Atomic write with read-back and conflict preservation

- files:
  - `src/io.ts` (new)
  - `src/io.test.ts` (new)
- detail: `REQ: write-readback`. Temp + rename, then read back and compare
  against the intended content; mismatch preserves the previous file and returns
  a typed limitation instead of claiming success. Divergent on-disk content
  writes `<name>.conflict-<ts>.md` alongside, losing neither version. Writer and
  reader are injectable so tests can force failure. Carries `routing.go:98`;
  the Engram half of that clause is out of scope.
- depends: T004
- evidence: `node --test --experimental-strip-types src/io.test.ts` passes with
  an injected failing writer (previous file intact, failure reported), an
  interrupted-write test showing no partial file, and a divergence test showing
  both files present.
- review: ~160 changed lines

### Block 2 — Read-only kernel

## [x] T007 — Pure state reducer

- files:
  - `src/state.ts` (new)
  - `src/state.test.ts` (new)
- detail: fold `Observation[]` into `committed`: distinct files read, distinct
  files written, mutating-bash commands, delegations, raw command results,
  declared intent/route/slug, tool-call count. Total, deterministic, idempotent
  by `toolCallId`. Imports neither `node:fs` nor pi.
- depends: T004
- evidence: `node --test --experimental-strip-types src/state.test.ts` passes,
  asserting an exact snapshot after ~20 synthetic observations, idempotence on
  replay, and distinct-path counting (one file read 6 times ≠ 6).
- review: ~200 changed lines

## [x] T008 — Kernel extension: observe only, block nothing

- files:
  - `extensions/nodd-kernel.ts` (new)
  - `extensions/nodd-kernel.test.ts` (new)
- detail: register `tool_call` (insert into `pending`, return nothing yet),
  `tool_result` (remove from `pending`, fold into `committed`), `session_start`
  (replay `pi.appendEntry` entries, reconcile with disk). `terminate` is never
  set anywhere. This task ships the parallel-batch discipline of
  `extensions.md:757-758`: evidence-reading helpers accept `Committed` only, so
  a sibling result is structurally unreachable.
- depends: T007
- evidence: `node --test --experimental-strip-types extensions/nodd-kernel.test.ts`
  passes: a read-only session of `read`/`grep`/`ls` produces zero blocks; a
  replayed batch shows pending entries never reach the evidence helper; a
  source-scan asserts `terminate` is never assigned `true`.
- review: ~220 changed lines

## [x] T009 — `nodd_declare` and `nodd_task` tools

- files:
  - `extensions/nodd-kernel.ts`
  - `src/feature-doc.ts`
  - `extensions/nodd-tools.test.ts` (new)
- detail: `pi.registerTool` for `nodd_declare` (intent, route, slug, summary)
  and `nodd_task` (`add`|`check`, id, title). **The extension writes the doc,
  never the model.** `nodd_declare route: tracked` creates
  `.nodd/<slug>/feature.md` via T006 and returns the one-line "created X with N
  tasks" of `routing.go:49`. Checkoff refusal wiring is a stub until T021.
- depends: T005, T006, T008
- evidence: `node --test --experimental-strip-types extensions/nodd-tools.test.ts`
  passes: `route: tracked` creates the doc with the declared objective and an
  empty Tasks section; invalid enum values are rejected by schema before any
  write; the returned line names the doc and the task count.
- review: ~200 changed lines

### Block 3 — Spike (blocks child-runtime work)

## [x] T010 — SPIKE: do parent extensions load in pi-subagent children?

- files:
  - `spike/subagent-enforcement/probe-extension.ts` (new)
  - `spike/subagent-enforcement/README.md` (new)
  - `spike/subagent-enforcement/RESULT.md` (new)
- detail: **not production code.** A probe extension writes a marker on load and
  blocks a known `write`; run it in the parent, then delegate a write through
  the `subagent` tool
  (`/home/gon/.pi/agent/npm/node_modules/pi-subagents/src/extension/index.ts:672,716`)
  and observe whether the marker appears and the child's write is blocked.
  `RESULT.md` records pi version, exact commands and raw output. **Both answers
  are acceptable; only an unrecorded answer is not** — if gates do not load in
  children, `gate-delegate` actively routes work around NODD's own enforcement
  and the product must say so instead of implying coverage.
- depends: T008
- evidence: `spike/subagent-enforcement/RESULT.md` exists and states a yes/no
  with the pi version, the commands run and the raw marker / blocked-call
  output pasted in. No task depending on child enforcement starts before it.
- review: ~150 changed lines

### Block 4 — Gate framework and kill switch

## [x] T011 — Gate framework: decision type, policy, registry

- files:
  - `src/gates/policy.ts` (new)
  - `src/gates/registry.ts` (new)
  - `src/gates/policy.test.ts` (new)
- detail: `GateDecision` with **non-optional `remedy`** on refusal, so a block
  without an unblocking instruction does not typecheck. Flag resolution with the
  source retained, not collapsed: `flag` > `config` > `default`. Ordered gate
  registry (first refusal wins, no double messages). Escape-hatch consumption
  hook. No gate implementations yet.
- depends: T003, T007
- evidence: `node --test --experimental-strip-types src/gates/policy.test.ts`
  passes: a table-driven test over the registry asserts every gate id has a
  default flag entry and produces a `remedy`; precedence resolves correctly for
  all three sources.
- review: ~200 changed lines

## [x] T012 — `/nodd-gates` kill switch with ODD's user-owned semantics

- files:
  - `extensions/nodd-gates.ts` (new)
  - `src/gates/policy.ts`
  - `extensions/nodd-gates.test.ts` (new)
- detail: `REQ: gate-kill-switch-semantics`, inherited from
  `routing.go:106-118`. `status` is read-only and reports deciding source +
  effective mode per gate (`default` = nobody chose). `disable` obeys in one
  line — no counter-argument, no consequence warning, no alternative offered.
  Nothing re-enables a gate but the explicit `enable` handler. Also register the
  `--nodd-off=<id|all>` CLI flag.
- depends: T011
- evidence: `node --test --experimental-strip-types extensions/nodd-gates.test.ts`
  passes: `status` performs no write and reports `default` for an untouched
  gate; `disable track` flips only `gates.track.enabled` and its output matches
  a fixed one-line shape containing no alternative and no re-enable suggestion;
  after disable, a `session_start` plus 50 folded observations leaves it
  disabled; a source scan asserts `enabled: true` is written from exactly one
  handler.
- review: ~220 changed lines

## [x] T013 — `/nodd-allow` one-shot escape hatch

- files:
  - `extensions/nodd-allow.ts` (new)
  - `extensions/nodd-allow.test.ts` (new)
- detail: `/nodd-allow <gate> [reason]` grants one override consumed by the next
  refusal of that gate, audited through `pi.appendEntry`. Never implicit, never
  permanent, never cross-gate. Unknown gate id lists the valid ids.
- depends: T011
- evidence: `node --test --experimental-strip-types extensions/nodd-allow.test.ts`
  passes: after `/nodd-allow track` the next `track` refusal passes and the one
  after blocks again; an override for A does not affect B; one audit entry is
  appended with gate, timestamp and reason.
- review: ~150 changed lines

## [x] T014 — Bash mutation classifier and its honesty contract

- files:
  - `src/bash-classifier.ts` (new)
  - `src/bash-classifier.test.ts` (new)
  - `README.md`
- detail: the documented denylist of `REQ: bash-mutation-classifier` —
  redirection excluding fd-only `2>&1`, `tee`, in-place editors, movers/removers,
  permissions, `patch`, mutating `git` subcommands, package installers, inline
  interpreters. Option (c): `write`/`edit` are exact, bash is patterned.
  **Ship the not-covered list in the same table** — scripts, `make`,
  `npm run build`, compilers/formatters, `eval`, background processes, other
  extensions' tools, writes outside pi, and (pending T010) subagent children.
- depends: T002
- evidence: `node --test --experimental-strip-types src/bash-classifier.test.ts`
  passes: ≥20 labelled commands including negatives `ls -la`,
  `grep -rn 'a>b' src`, `cmd 2>&1`, `git status`, `git log`, `npm test`; the
  README covered rows are asserted against the classifier's pattern list so they
  cannot drift; the not-covered list is non-empty and names scripts and indirect
  writers; the bash-gate section contains none of
  `guarantees`/`garantiza`/`exhaustive`/`all writes`.
- review: ~260 changed lines

### Block 5 — Gates, one at a time

## [x] T015 — `gate-authorize`

- files:
  - `src/gates/authorize.ts` (new)
  - `src/gates/authorize.test.ts` (new)
- detail: declared `intent: read-only` blocks `write`, `edit`, mutating bash and
  the `subagent` writer tool (`routing.go:43-44`). Silent when nothing was
  declared — that is `gate-classify`'s job, so the two never double-block.
- depends: T011, T014
- evidence: `node --test --experimental-strip-types src/gates/authorize.test.ts`
  passes: read-only + `write` blocks naming the declaration; `intent: change`
  allows; undeclared state returns `allow`; `gates.authorize.enabled: false`
  allows the read-only write.
- review: ~140 changed lines

## [x] T016 — `gate-classify` [P]

- files:
  - `src/gates/classify.ts` (new)
  - `src/gates/classify.test.ts` (new)
- detail: no committed declaration ⇒ the first `write`/`edit`/mutating-bash is
  blocked. Mechanizes the *declaration*, not the judgement — the exact hole
  gentle admits ("non-delegation is invisible"). A declaration seen only in
  `pending` does not unblock, and the reason cites the batch rule.
- depends: T011, T014
- evidence: `node --test --experimental-strip-types src/gates/classify.test.ts`
  passes: undeclared `write` blocks with a `nodd_declare` remedy; committed
  declaration allows; same-batch pending declaration still blocks citing the
  batch rule; flag off allows.
- review: ~140 changed lines

## [x] T017 — `gate-track`

- files:
  - `src/gates/track.ts` (new)
  - `src/gates/track.test.ts` (new)
- detail: route `tracked`/`forge` with `.nodd/<slug>/feature.md` absent blocks
  the first write (`routing.go:49`). Route `inline` never blocks — small
  understood work stays small (`routing.go:94`). **`write`/`edit` targeting
  `.nodd/**` is always blocked**, pointing at `nodd_task`: a doc the model can
  rewrite is a doc the model can forge.
- depends: T011, T014
- evidence: `node --test --experimental-strip-types src/gates/track.test.ts`
  passes: missing doc blocks naming the exact path plus both remedies; present
  doc allows; `inline` never blocks; `echo x > f` blocks while `npm test` does
  not; a direct `write` to `.nodd/x/feature.md` blocks.
- review: ~190 changed lines

## [x] T018 — `gate-delegate`

- files:
  - `src/gates/delegate.ts` (new)
  - `src/gates/delegate.test.ts` (new)
- detail: manifest comparators on observed counts (`routing.go:78-82`) — the
  clause ODD most conspicuously fails to enforce. Mapping at 4+ distinct
  understanding files, writer at 2+ non-trivial files, backstop at 20 tool
  calls. May count same-batch `pending` write *intent* (intent is known at
  preflight) but never same-batch results. Test/build/install commands never
  trip it (`routing.go:70`). "Non-mechanical edit" is a judgement and is not
  counted — the backstop fires on the two observable counters only.
- depends: T011
- evidence: `node --test --experimental-strip-types src/gates/delegate.test.ts`
  passes: 4 distinct reads with no delegation blocks quoting count and
  threshold; boundary asserted at both 3 (allow) and 4 (block); a committed
  `subagent` result clears it; one file read 6 times does not trip mapping;
  `npm test` calls do not count as writer files.
- review: ~200 changed lines

### Block 6 — Observed evidence

## [x] T019 — Command outcome parser: five outcomes, fail-closed

- files:
  - `src/outcome.ts` (new)
  - `src/outcome.test.ts` (new)
- detail: derive the outcome from the raw observation stored by T004.
  `isError === false` ⇒ `success` (exit 0 **by construction**: pi's bash throws
  for every non-zero code, `bash.js:347`). Otherwise parse the **last non-empty
  line** appended by `bash.js:321`: `Command exited with code N` ⇒ `exit`,
  `Command aborted` ⇒ `aborted`, `Command timed out after N seconds` ⇒
  `timeout`, anything else ⇒ `unknown`. Discriminated union with no `ok` field —
  the three failure modes are distinct and must never re-collapse. **`unknown`
  never counts as success.** No bash wrapper and no tool override.
- depends: T004
- evidence: `node --test --experimental-strip-types src/outcome.test.ts` passes:
  a table covering all five rows including `code 137` and
  `timed out after 120 seconds`; a non-matching error text → `unknown`; a
  **successful** command whose stdout contains the text
  `Command exited with code 1` still parses as `success` (last-line-only rule);
  a type-level assertion that no boolean success field exists.
- review: ~180 changed lines

## [x] T020 — Evidence ledger `.nodd/<slug>/state.json`

- files:
  - `src/ledger.ts` (new)
  - `src/ledger.test.ts` (new)
  - `extensions/nodd-kernel.ts`
- detail: append-only records (`toolCallId`, tool, command, raw result,
  timestamp) written atomically through T006. Corrupt file → reported defect,
  treated as empty, **never as evidence**. The append API accepts only records
  carrying a `toolCallId`, so model-authored text cannot enter by construction.
- depends: T006, T019
- evidence: `node --test --experimental-strip-types src/ledger.test.ts` passes:
  two appends re-read in order; a truncated file yields a defect and an empty
  ledger without throwing; no partial file visible under an interrupted write;
  a record without `toolCallId` is rejected.
- review: ~190 changed lines

## [x] T021 — `gate-evidence` and the anti-hallucination proof

- files:
  - `src/gates/evidence.ts` (new)
  - `src/gates/evidence.test.ts` (new)
  - `extensions/nodd-kernel.ts`
- detail: `nodd_task check` requires a committed `success` recorded **after** the
  task's last write. `exit`/`aborted`/`timeout`/`unknown` never satisfy it. TDD
  mode additionally requires an earlier observed non-`success` (RED) before an
  implementation checkoff (`routing.go:101`); mode, source and runner are
  recorded in the doc. Flag off ⇒ the checkoff passes but renders
  `observed: none (gate disabled)` — the artifact never claims evidence it lacks
  (`routing.go:117`).
- depends: T009, T013, T018, T020
- evidence: `node --test --experimental-strip-types src/gates/evidence.test.ts`
  passes, and **includes the mandated provenance test**: the same checkoff is
  attempted (a) with an assistant message asserting "tests pass" and no tool
  result, (b) with a real failing `tool_result`, (c) with a real successful one
  — only (c) is accepted, proving the recorded value comes from the observed
  result and not from a model claim. Plus: empty ledger refused; `unknown`
  refused; `exit 1` refused quoting the code; TDD-on without RED refused;
  disabled flag renders the `none (gate disabled)` line.
- review: ~260 changed lines

## [x] T022 — Review candidate is a commit or a slice, never a checkbox

- files:
  - `src/review-candidate.ts` (new)
  - `src/review-candidate.test.ts` (new)
  - `src/feature-doc.ts`
- detail: `routing.go:51`,`:102`. Checking a task records the observed commit
  SHA, or `candidate: pending-commit` when none exists — never the checkbox.
  Slice candidates carry an explicit (base, head) boundary pair; the first base
  is the branch point and each recorded boundary becomes the next base. The
  accumulated branch is never a candidate.
- depends: T021
- evidence: `node --test --experimental-strip-types src/review-candidate.test.ts`
  passes: checkoff with an observed commit records the SHA, without one records
  `pending-commit`; a two-slice test asserts boundary chaining; a source scan
  asserts no candidate identity is ever a task id or checkbox state.
- review: ~170 changed lines

## [x] T023 — Change-acceptance rules

- files:
  - `src/change-acceptance.ts` (new)
  - `src/change-acceptance.test.ts` (new)
  - `extensions/nodd-kernel.ts`
- detail: `routing.go:97`. Preserve valid completed and unrelated work; reopening
  a `[x]` requires a recorded reason; findings never expand scope on their own,
  mechanized as "an observed `subagent` result can never mutate the declared
  intent or route — only `nodd_declare` can"; business-scope judgement stays
  prose; checkboxes grant no approval and no receipt.
- depends: T021
- evidence: `node --test --experimental-strip-types src/change-acceptance.test.ts`
  passes: reopening without a reason is refused naming it, with a reason it
  records under Progress; a rewrite dropping an unrelated completed task is
  refused naming the lost task; a delegation observation leaves intent and route
  unchanged; evidence lookups key on ledger records only.
- review: ~200 changed lines

## [x] T024 — Delivery strategy: record and measure, never block

- files:
  - `src/delivery.ts` (new)
  - `src/delivery.test.ts` (new)
  - `src/feature-doc.ts`
- detail: `routing.go:103`. A `## Delivery` section holds strategy
  (`ask-on-risk` default | `auto-chain` | `single-pr` | `exception-ok`), chain
  (`stacked-to-main` | `feature-branch-chain`), forecast, running count and slice
  boundaries with their commits; both choices cached so they are asked once. The
  running count is parsed from observed `git` diffstat output with a documented
  generated-file exclusion list; unparseable output leaves it `unknown`, never
  guessed. **The 400-line crossing emits no block** — turning a stated planning
  heuristic (`routing.go:95`) into a gate would violate the clause it comes
  from. Asking is prose; branch/PR execution is `/zero-branch` and `/zero-pr`.
- depends: T022
- evidence: `node --test --experimental-strip-types src/delivery.test.ts` passes:
  the Delivery section round-trips with all five fields; invalid strategy/chain
  rejected; the counter handles a normal diffstat, one with a generated path,
  and unparseable output → `unknown`; a `write` at 600 running lines is allowed
  and only the prompt mentions the crossing; a source scan asserts no
  `git push`, `gh pr create` or merge anywhere in the package.
- review: ~260 changed lines

### Block 7 — `/nodd-models`

## [x] T025 — Model slots and assignment validation

- files:
  - `src/models/slots.ts` (new)
  - `src/models/assign.ts` (new)
  - `src/models/assign.test.ts` (new)
- detail: adapted from `zero-models.ts:411-460,505-525` — **adapted, not
  imported**. Registry grouping by provider, qualified `provider/model`
  accepted, unknown rejected, ambiguous bare id rejected with qualified
  suggestions. The four mechanism steps reject assignment with a message saying
  they are mechanisms.
- depends: T003
- evidence: `node --test --experimental-strip-types src/models/assign.test.ts`
  passes: `classify=x/y` rejected as a mechanism step; `implement=unknown/model`
  rejected against a stub registry; ambiguous bare id returns suggestions;
  a valid assignment produces a config patch touching only `models.implement`.
- review: ~220 changed lines

## [x] T026 — Picker state machine (no fs, no pi, no pi-tui)

- files:
  - `src/models/picker.ts` (new)
  - `src/models/picker.test.ts` (new)
- detail: dependency-free state machine after
  `zero-models-picker.ts:5-11,177-181,228-241`. Displays all **seven** canonical
  steps; the four mechanism rows render `mecanismo · sin modelo` and are not
  selectable. Returns save/quit outcomes; writes nothing itself.
- depends: T002, T025
- evidence: `node --test --experimental-strip-types src/models/picker.test.ts`
  passes headlessly: seven rows in canonical order with four marked as
  mechanisms; navigation skips non-selectable rows; quit returns no changes;
  save returns the assignment set. A source scan asserts no `node:fs`, no pi and
  no `pi-tui` import in this file.
- review: ~380 changed lines

## [x] T027 — Model profiles in `nodd.json` only

- files:
  - `src/models/profiles.ts` (new)
  - `src/models/profiles.test.ts` (new)
- detail: adapted from `zero-models-profiles.ts:46-68,170-177,255-299`. `new`,
  `save`, `use`, `delete` as pure transforms returning updated data plus a
  message; the command decides whether to write. Active-profile mirroring.
  Malformed profile data is discarded safely. Never shared with `zero.json`.
- depends: T025
- evidence: `node --test --experimental-strip-types src/models/profiles.test.ts`
  passes: the four verbs as pure transforms; reserved names and invalid
  characters rejected; a corrupt `profiles` value parses to an empty set with a
  defect note; mirroring updates the active profile.
- review: ~240 changed lines

## [x] T028 — `/nodd-models` command and `ctx.ui.custom` host

- files:
  - `extensions/nodd-models.ts` (new)
  - `extensions/nodd-models.test.ts` (new)
- detail: `pi.registerCommand("nodd-models", …)`. Deterministic handler, not an
  LLM prompt. Direct assignment (`/nodd-models implement=provider/model`) and
  the interactive picker via `ctx.ui.custom`. **The no-`pi-tui` rule is
  absolute** (`zero-models.ts:22-32`): declare the local
  `interface Component { render(width): string[] }` instead. Persist through the
  T003 merge so unrelated keys survive; quit writes nothing, save writes once.
- depends: T026, T027
- evidence: `node --test --experimental-strip-types extensions/nodd-models.test.ts`
  passes: output lists seven steps with four marked `mecanismo · sin modelo`;
  a valid assignment writes only `models.implement` and preserves an unrelated
  key; quit produces zero writes; a source scan asserts no `pi-tui` import,
  value or type.
- review: ~300 changed lines

## [x] T029 — NODD subagent provisioning (gated on the spike)

- files:
  - `extensions/nodd-agents.ts` (new)
  - `extensions/nodd-agents.test.ts` (new)
- detail: pattern from `sdd-agents.ts:94-130,220-270`. Generate
  `nodd-explore`, `nodd-resolve-uncertainty`, `nodd-implement` under
  `~/.pi/agent/agents/nodd/` — **never** under `zero/`. Models from
  `~/.pi/nodd.json` with `default` as fallback. Failures are swallowed per file.
  **Forward the advisory-only line heuristic and its anti-gaming sentence into
  every generated body** (`routing.go:95`). The enforcement caveat recorded by
  T010 travels with this task either way.
- depends: T010, T027
- evidence: `node --test --experimental-strip-types extensions/nodd-agents.test.ts`
  passes: the pure renderer matches an expected frontmatter+body string; paths
  resolve under `agents/nodd/` and never `agents/zero/`; one failing write does
  not block the other two; the rendered body contains the anti-gaming advisory.
- review: ~220 changed lines

### Block 8 — Promotion to forge

## [x] T030 — Promotion converter (pure)

- files:
  - `src/promote.ts` (new)
  - `src/promote.test.ts` (new)
- detail: feature doc → `.sdd/<slug>/requirements.md` string. Objective, problem,
  scope and constraints become requirements; completed tasks arrive with their
  observed evidence, explicitly labelled as already-resolved context that must
  not be redone. **Deliberately emits no `design.md` and no `tasks.md`** so
  forge's resume lands on `no-plan` and restarts at `plan`
  (`orchestrator.md:102-105`). Pure: string in, string out.
- depends: T005, T021
- evidence: `node --test --experimental-strip-types src/promote.test.ts` passes:
  a 3-task doc with 2 checked yields a requirements string containing the
  objective, the constraints and both completed tasks with their evidence under
  an already-resolved heading.
- review: ~240 changed lines

## [x] T031 — `/nodd-promote` and the no-SDD-artifacts rule

- files:
  - `extensions/nodd-promote.ts` (new)
  - `extensions/nodd-promote.test.ts` (new)
- detail: writes exactly one file through T006. Refuses to overwrite an existing
  `requirements.md`. Forge absent ⇒ artifacts still written, reports that
  `/forge --continue <slug>` must be run manually, does not throw
  (`clarifications.md`: forge is an optional dependency). Enforces
  `REQ: no-sdd-artifacts-off-route` — this command is the only writer under
  `.sdd/`.
- depends: T030
- evidence: `node --test --experimental-strip-types extensions/nodd-promote.test.ts`
  passes: exactly one file written and `design.md`/`tasks.md` asserted absent;
  an existing `requirements.md` causes a refusal, not an overwrite; the
  forge-absent path reports instead of throwing; a full `tracked` run touching
  10 files leaves `.sdd/` byte-identical; a source scan asserts this is the only
  `.sdd/` writer.
- review: ~200 changed lines

## [x] T032 — `gate-promotion`: observables only

- files:
  - `src/gates/promotion.ts` (new)
  - `src/gates/promotion.test.ts` (new)
- detail: `REQ: escalation-divergence`. Triggers are exactly: two consecutive
  non-`success` outcomes on one task, a task writing more distinct files than it
  declared, or an explicit user request. **No size, line count or risk score is
  read** — that is the part of `routing.go:68` NODD keeps. The block offers
  exactly two ways forward: `/nodd-promote <slug>` or `/nodd-allow promotion`.
- depends: T024, T031
- evidence: `node --test --experimental-strip-types src/gates/promotion.test.ts`
  passes: two consecutive failures block naming both; failure-then-success does
  not; 3-observed-against-2-declared blocks with both counts while
  40-against-40 does not (proving mismatch, not magnitude); a source scan
  asserts no promotion path reads a line count, byte size or risk score.
- review: ~200 changed lines

### Block 9 — Dynamic prompt (last)

## [x] T033 — Forwarded-prose corpus, tagged by step

- files:
  - `src/odd-prose.ts` (new)
  - `src/odd-prose.test.ts` (new)
- detail: one entry per `(P)` row of `REQ: odd-parity-matrix`, each tagged with
  its canonical step and carrying the reason it is not mechanizable. Includes
  the preparation trigger (`routing.go:81`) under `explore` and the ~400-line
  advisory with its full anti-gaming sentence under `implement`. These are
  ODD's genuinely useful, genuinely unmechanizable parts — kept as guidance,
  labelled as guidance.
- depends: T014
- evidence: `node --test --experimental-strip-types src/odd-prose.test.ts`
  passes: one entry per `(P)` row; every entry carries a step tag and a reason;
  the preparation trigger and the anti-gaming sentence are present verbatim;
  a source scan asserts no gate id contains `prepar` and no gate consults a
  line count — the absent mechanisms are verified absent.
- review: ~280 changed lines

## [x] T034 — Prompt renderer: block A + block B, budgeted

- files:
  - `src/prompt.ts` (new)
  - `src/prompt.test.ts` (new)
- detail: pure `(state, policy) => { blockA, blockB }`. A = current step, enabled
  gates, what is missing, escape-hatch syntax, disabled-gate and used-hatch
  notices, ≤1500 chars. B = the `(P)` entries for the current step only,
  ≤2500 chars. The disabled-gate notice contains no instruction to re-enable
  (`routing.go:116`). The budgets are the ratchet-prevention mechanism: gentle's
  wall reached 105,993 bytes one clause at a time.
- depends: T032, T033
- evidence: `node --test --experimental-strip-types src/prompt.test.ts` passes:
  three states rendered (undeclared, tracked-with-pending-evidence,
  all-gates-off); all-off ⇒ block A is one line while block B still forwards
  step prose; A ≤1500, B ≤2500, combined ≤4000 for a mid-implementation state;
  block B for `implement` contains no `explore`-only clause; no re-enable
  suggestion in the disabled notice.
- review: ~260 changed lines

## [x] T035 — `before_agent_start` wiring

- files:
  - `extensions/nodd-kernel.ts`
  - `extensions/nodd-prompt.test.ts` (new)
- detail: return `{ systemPrompt: incoming + blockA + blockB }` — chained per
  `types.d.ts:806-810`, never a replacement, so other extensions' contributions
  survive.
- depends: T034
- evidence: `node --test --experimental-strip-types extensions/nodd-prompt.test.ts`
  passes: the handler's output starts with the incoming prompt unchanged and
  appends both blocks; a null/empty incoming prompt is handled without dropping
  content.
- review: ~140 changed lines

## [x] T036 — README: the honest-scope contract

- files:
  - `README.md`
  - `test/readme-contract.test.ts` (new)
- detail: the document that makes NODD different from ODD. Contains: the full
  M/P/F parity matrix; the covered/not-covered mutation table; the "Not carried
  from ODD" table with reasons; the **Enforcement scope** statement written from
  T010's recorded result — including, if the spike said no, a plain statement
  that delegated sub-agents are not gated; the five command outcomes with the
  fail-closed `unknown` rule; the per-gate flag and escape-hatch reference with
  the kill-switch semantics; and the `REQ: escalation-divergence` statement
  naming `routing.go:68`. ODD's failure was promising compliance while shipping
  delivery; this file is where NODD refuses to repeat it.

  **Added during build (T020/T021, supervisor-directed).** The README must also
  declare the resume behaviour that falls out of the ledger integrity rule: on
  reopening in a new session, the previous session's evidence is not enough to
  check a task off — the check has to be re-run. It is fail-closed and correct,
  because evidence means "observed by the kernel" and a fresh process has
  observed nothing yet, but a user who meets it by surprise will read it as a
  bug and switch NODD off. State it as expected behaviour with that one-line
  reason. The matching refusal message is already actionable in
  `src/gates/evidence.ts` and asserted by `src/gates/evidence.test.ts`.
  Keep the `unverified` (not observed here) vs `mismatch` (contradicts what was
  observed) distinction visible — they are different failures and read
  differently.
- depends: T010, T029, T032, T033
- evidence: `node --test --experimental-strip-types test/readme-contract.test.ts`
  passes: README mentions every registered gate id; every `(M)` matrix row names
  a gate or module that exists in the package; the bash-gate section contains
  none of `guarantees`/`garantiza`/`exhaustive`/`all writes`; the Enforcement
  scope section is present and non-empty; no code path references the
  `gentle-ai` binary.
- review: ~300 changed lines

### Block 10 — Runtime enforcement (added during build)

## [x] T037 — Wire the gates into the kernel's `tool_call` handler

- **Added during build, ronda 1, supervisor-approved.** Reason, recorded per
  `REQ: change-acceptance-rules` (a genuinely new task arrives with a reason):
  **no task in this plan connected the pure gate functions to the registered
  `tool_call` handler.** T008 ships "observe only, block nothing"; T015–T018,
  T021 and T032 build and test the gates as pure functions; T035 wires
  `before_agent_start`, which is the prompt, not blocking. Verified during build
  with a source scan: `extensions/` contained zero references to
  `authorizeGate`/`classifyGate`/`trackGate`/`delegateGate`/`evidenceGate`. As
  planned, the package would have shipped six correct, fully-tested gates that
  never fire in a session, plus a README describing enforcement — which is the
  exact ODD failure mode NODD exists to correct. This is a defect of the plan,
  not of an individual task, and it is recorded as one.
- files:
  - `extensions/nodd-kernel.ts`
  - `extensions/nodd-enforcement.test.ts` (new)
- detail: the `tool_call` handler resolves the policy, builds the `GateRequest`
  from the real event shape, runs the ordered registry and returns
  `{ block: true, reason }` on the first refusal. `terminate` is still never set
  (`types.d.ts:781-786`). A refusal consumes a granted escape hatch; a disabled
  gate is skipped entirely.
- depends: T015, T016, T017, T018, T021, T032
- evidence: `node --test --experimental-strip-types extensions/nodd-enforcement.test.ts`
  passes, and every assertion goes **through the registered handler**, never by
  calling a gate function directly: a violating `write` comes back
  `{ block: true, reason }`; a read-only session is untouched; gate order and
  precedence are asserted when more than one gate applies (one message, the
  first); `--nodd-off` and `gates.<id>.enabled: false` let the same call through
  on the real path; a granted `/nodd-allow` is consumed by the real path and the
  next call blocks again; `terminate` is never set. A test asserts the handler
  reaches the gates at all, so a kernel that only observes fails it.
- review: ~260 changed lines

---

### Block 8 — Ronda 2: the four blockers of `veredicto.md`

**Added during build, ronda 2, after the round-1 verdict `corregir`.** Reason,
recorded per `REQ: change-acceptance-rules`: the verdict found four places where
**the product asserts more than the mechanism does** — the exact failure NODD
accuses ODD of. Each is a defect of the plan, not of a single task: T032 built
`gate-promotion` pure and T037 wired it without a signal producer; T019–T021
built the evidence path without binding it to a task or to a write; T034 pinned
a budget with an assertion that measures the output of the truncator. No
completed task is reopened: these are new tasks that add the missing mechanism,
or lower the claim to the truth where the mechanism is not derivable.

## [x] T038 — The prompt budget fails loudly instead of truncating in silence

- files:
  - `src/prompt.ts`
  - `src/prompt.test.ts`
- detail: B4. `fit()` truncates to the budget and the anti-ratchet test asserts
  the length *after* truncation, so it is `min(len, 2500) <= 2500` and cannot
  fail. Export the unbudgeted `renderBlockA`/`renderBlockB` and a
  `renderClauses(entries)` seam, assert the budgets on the **pre-truncation**
  text, and make an overflow visible in production: the emitted block carries an
  explicit over-budget notice and `renderPrompt` reports `overflow`.
- depends: T034
- evidence: `node --test --experimental-strip-types src/prompt.test.ts` passes,
  and a test that renders the real `implement` corpus plus padding clauses
  asserts the budget check **rejects** it — so growing the corpus turns the
  suite red instead of silently dropping characters.
- review: ~120 changed lines

## [x] T039 — Evidence is bound to the declared runner and to the last write

- files:
  - `src/state.ts`, `src/feature-doc.ts`, `src/gates/evidence.ts`,
    `src/gates/delegate.ts`, `extensions/nodd-kernel.ts`
  - `src/state.test.ts`, `src/feature-doc.test.ts`, `src/gates/evidence.test.ts`,
    `extensions/nodd-tools.test.ts`, `extensions/nodd-enforcement.test.ts`
- detail: B3 and matrix row 45. `filesWritten` becomes `Map<path, at>` so
  "evidence postdates the edit" is computable; `lastWriteAt` reads it instead of
  `commandResults` (bash only). `nodd_declare` gains `runner`, `tdd` and `files`;
  runner and TDD mode land in a `## Verification` section of the feature doc and
  are passed into the evidence gate, which now refuses a command that is not the
  declared runner. That kills both attacks in the verdict: the stale green and
  `echo 'I have verified that all tests pass'`.
- depends: T020, T021, T037
- evidence: `node --test --experimental-strip-types src/gates/evidence.test.ts
  extensions/nodd-tools.test.ts` passes, with a regression test per attack, and
  emptying `lastWriteAt` turns the suite red.
- review: ~380 changed lines

## [x] T040 — `gate-promotion` runs on derived signals, and drops the one it cannot derive

- files:
  - `src/gates/promotion.ts`, `extensions/nodd-kernel.ts`
  - `src/gates/promotion.test.ts`, `extensions/nodd-enforcement.test.ts`
- detail: B1. `promotionSignals()` hardcodes every trigger to zero, so the gate
  is wired and inert — deleting its registry row leaves 343/343 green.
  `declaredFiles` comes from the declaration (T039), `observedFiles` from
  `filesWritten`, `consecutiveFailures`/`failedTaskId` from the trailing
  non-success runs of one command plus the last observed `nodd_task check`.
  `userRequested` is **removed from the product**: `/nodd-promote` performs the
  promotion itself and lives in another extension with no path to kernel state,
  so the signal was not derivable and a fabricated signal is worse than an
  absent one.
- depends: T039
- evidence: `node --test --experimental-strip-types
  extensions/nodd-enforcement.test.ts` passes, exercising both triggers through
  the registered handler; deleting the promotion row from the registry turns the
  suite red.
- review: ~200 changed lines

## [x] T041 — Resume is fail-closed for evidence, and the ledger exists in production

- files:
  - `extensions/nodd-kernel.ts`, `src/state.ts`, `src/gates/evidence.ts`
  - `extensions/nodd-kernel.test.ts`, `extensions/nodd-enforcement.test.ts`
- detail: B2. `session_start` replays persisted observations into
  `commandResults`, so a resumed session checks a task off with no command run —
  the README's fail-closed promise was false. Replay keeps rebuilding the gate
  context (declaration, files, counters) and stops rehydrating evidence: a run
  observed in another process is not an observation of this one. And
  `appendRecord` is called in production, so `.nodd/<slug>/state.json` exists,
  `unverified` is reachable on a real resume and `mismatch` is reachable when
  the file contradicts an observation. Also fixes the replay source: pi's
  `SessionStartEvent` carries no `entries` — entries come from
  `ctx.sessionManager.getEntries()` as `{ type: "custom", customType, data }`.
- depends: T039
- evidence: `node --test --experimental-strip-types
  extensions/nodd-kernel.test.ts extensions/nodd-enforcement.test.ts` passes,
  including a two-session test where the resumed session is refused, and a test
  that the ledger file exists after a checkoff.
- review: ~220 changed lines

## [x] T042 — Every `(M)` row of the parity matrix names a mechanism that exists

- files:
  - `.sdd/nodd/requirements.md`, `README.md`, `src/feature-doc.ts`
  - `test/parity-matrix.test.ts` (new), `src/feature-doc.test.ts`
- detail: M1. The pending acceptance criterion ("a test asserts each `(M)` row
  names a requirement or gate id that actually exists") was replaced by
  `assert.ok(README.includes("(M)"))`, which proves nothing. Parse the matrix and
  resolve every `REQ:`/`gate-`/`src/*.ts` reference of an `(M)` row against the
  package. Row 13 gets its mechanism: `## Outcome` is rendered from the task
  list and its observed evidence, so a failed or pending check cannot be
  dropped. Rows 45 and 46 are mechanized by T039; their justifications are
  rewritten to name the real mechanism.
- depends: T038, T039, T040, T041
- evidence: `node --test --experimental-strip-types test/parity-matrix.test.ts`
  passes, and fails when an `(M)` row is pointed at a requirement id that does
  not exist.
- review: ~260 changed lines

### Block 9 — Ronda 3: the last round of the cap

## [x] T043 — The unpinned runner is disclosed in the artifact, and the README sweep

- files:
  - `src/gates/evidence.ts`, `src/gates/evidence.test.ts`
  - `extensions/nodd-kernel.ts`, `extensions/nodd-enforcement.test.ts`
  - `extensions/nodd-tools.test.ts`, `README.md`
- detail: H1, the single open finding of round 2, plus the sweep it implies.
  H1 itself: `README.md:142-144` promised that with no declared runner "the
  recorded evidence says the runner was not pinned", and `renderObserved`
  emitted the same line as a pinned checkoff, so the round-1 echo attack still
  landed in full by omitting one optional field. Chose **option (a)** from the
  verdict — implement the disclosure — over (b) making `runner` required,
  because (b) changes the declare contract and the honest position is that an
  unpinned feature is *allowed but not enforced*, which is exactly what a
  caveat in the evidence line communicates and a hard requirement would hide.
  The reason this finding existed at all is the ratchet: prose added beside a
  fix promising slightly more than the fix did. So the second half of this task
  is a sweep of **every** guarantee the README states, checking each for (1) a
  mechanism and (2) a test that dies when the mechanism is neutralized. The
  sweep found two more live instances of the same class, fixed as T044/T045,
  and one structural one recorded as a limitation: no test parses the README's
  English, so a new overclaiming sentence cannot turn the suite red. The README
  now says that about itself instead of claiming every claim is asserted.
- depends: T038, T039, T040, T041, T042
- evidence: full suite green; the disclosure dies under mutation (removing the
  caveat fails 2 tests, one unit and one end-to-end on the real handler).
- review: ~120 changed lines

## [x] T044 — A pinned runner cannot be re-pinned to fit a run that already passed

- files: `extensions/nodd-kernel.ts`, `extensions/nodd-enforcement.test.ts`
- detail: Found by the T043 sweep, by attacking the README claim that the
  runner "cannot be invented afterwards to fit whatever happened to pass".
  `nodd_declare` rewrote `## Verification` wholesale, so a refused checkoff was
  repaired by re-declaring with the echo as the runner; the second attempt
  passed and the artifact recorded the echo as the certified check. Re-pinning
  a *different* runner is now refused and the original stands. Re-declaring
  with the same runner, or with none, still works, so ordinary re-declaration
  is unaffected.
- depends: T043
- evidence: RED observed (`.nodd/login/feature.md created with 1 tasks` where a
  refusal was required); green after; neutralizing the check fails the test.
- review: ~40 changed lines

## [x] T045 — `tdd: strict` without a runner is refused instead of silently unenforced

- files: `extensions/nodd-kernel.ts`, `extensions/nodd-enforcement.test.ts`
- detail: Found by the T043 sweep, by attacking the README's fourth evidence
  fact. The kernel built the TDD context only when a runner was *also* pinned,
  so `tdd: strict` alone wrote `- tdd: strict` into the feature document and
  enforced nothing: GREEN with no RED checked the task off. A document
  asserting a discipline nobody verified is the precise failure NODD exists to
  prevent, so the declaration is refused and names the missing runner.
- depends: T043
- evidence: RED observed (checkoff allowed with no RED run); green after;
  neutralizing the requirement fails the test.
- review: ~40 changed lines

---

## Constitution / Steering check

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | No `.sdd/constitution.md`, `.sdd/steering.md` or `.kiro/steering/*` in the repo |
| Scope matches product/tech constraints | pass | `PLAN.md` §6 phases 1–5 + `/nodd-models` + ODD parity matrix, as fixed in `clarifications.md`; Phase 0 stays a non-goal of code |
| No forbidden dependency or workflow change | pass | Zero edits to `zero-pi`; no `pi-tui` import; no compile pipeline; pi as peerDependency; no `gentle-ai` binary dependency |

## Review Workload

Budget: **400** changed lines per task.

| task | estimate |
| --- | --- |
| T001 | ~80 |
| T002 | ~60 |
| T003 | ~120 |
| T004 | ~100 |
| T005 | ~220 |
| T006 | ~160 |
| T007 | ~200 |
| T008 | ~220 |
| T009 | ~200 |
| T010 | ~150 |
| T011 | ~200 |
| T012 | ~220 |
| T013 | ~150 |
| T014 | ~260 |
| T015 | ~140 |
| T016 | ~140 |
| T017 | ~190 |
| T018 | ~200 |
| T019 | ~180 |
| T020 | ~190 |
| T021 | ~260 |
| T022 | ~170 |
| T023 | ~200 |
| T024 | ~260 |
| T025 | ~220 |
| T026 | ~380 |
| T027 | ~240 |
| T028 | ~300 |
| T029 | ~220 |
| T030 | ~240 |
| T031 | ~200 |
| T032 | ~200 |
| T033 | ~280 |
| T034 | ~260 |
| T035 | ~140 |
| T036 | ~300 |
| T037 | ~260 |

**Total: ~7510 changed lines**

Over-budget exceptions: none. T026 (~380) is the closest to the ceiling; if the
picker grows past 400 during build, split the seven-row display model away from
the navigation state machine.

### Chained PR batches

| batch | tasks | constraint |
| --- | --- | --- |
| PR-1 | T001–T006 | skeleton and schema; nothing depends on it being behavioural |
| PR-2 | T007–T009 | read-only kernel; observably blocks nothing |
| PR-3 | T010 | the spike, standalone — its result gates PR-7 and PR-9 |
| PR-4 | T011–T014 | gate framework, kill switch, escape hatch, classifier; no gate fires yet |
| PR-5 | T015–T018 | the four pre-write gates; land after PR-4, reviewable one gate per commit |
| PR-6 | T019–T024 | observed evidence and delivery record |
| PR-7 | T025–T029 | `/nodd-models`; T029 requires PR-3 |
| PR-8 | T030–T032 | promotion |
| PR-9 | T033–T036 | dynamic prompt and the README contract; requires PR-3's result |
| PR-10 | T037 | runtime enforcement wiring; lands last, after every gate exists |

Batches are strictly ordered except PR-3, which can land any time after PR-2 and
must land before PR-7 and PR-9.
