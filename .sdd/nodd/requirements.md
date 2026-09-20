# Requirements — NODD

**Non-negotiable Organic Driven Development.** A pi package that turns the ODD
protocol from injected prose into runtime mechanism: a state kernel fed by real
tool events, blocking gates, evidence read from observed tool results, and
promotion of NODD artifacts into `/forge` artifacts.

Scope is fixed by `.sdd/nodd/clarifications.md` (closed decisions, not reopened
here) and `PLAN.md` §6. Phase 0 of `PLAN.md` (manual ODD baseline measurement)
is an explicit non-goal of code.

---

## Glossary

| term | meaning |
| --- | --- |
| **canonical step** | one of the seven ODD steps: `authorize`, `explore`, `resolve-uncertainty`, `classify`, `track`, `implement`, `close`. |
| **gate** | a pure decision function consulted from pi's `tool_call` hook that may return `{ block: true, reason }`. |
| **observation** | a fact derived from a real pi tool event, never from model prose. |
| **committed state** | state derived only from `tool_result` events that already finished. |
| **pending state** | tool calls preflighted in the current assistant tool batch whose results are not yet known. |
| **feature doc** | `.nodd/<slug>/feature.md`, the durable, extension-owned NODD artifact. |
| **ledger** | `.nodd/<slug>/state.json`, the durable append-only record of observations. |
| **escape hatch** | `/nodd-allow <gate>`, a one-shot, audited override of a single gate. |
| **gate flag** | a persistent per-gate on/off switch in `~/.pi/nodd.json`, driven by `/nodd-gates` and the `--nodd-off` CLI flag. |
| **(M)** | mechanized — the ODD clause becomes a gate, counter or observed-evidence check in code. |
| **(P)** | forwarded prose — the clause is kept as injected text because it is not mechanizable. |
| **(F)** | out of scope — the clause is not carried, with a stated reason. |

### A note on line citations

All `routing.go` citations below were verified by reading
`/tmp/gentle-ai/internal/components/agentguidance/routing.go` at commit
`d4187c1d996754475f22fa7368d1c9afb1b8a938`. Where this document's line number
differs from an earlier hand-cited one, the verified number is authoritative:
kill switch `:106-118`, delivery strategy `:103` (cited elsewhere as `:104`),
review candidate `:51` and `:102` (cited as `:46`/`:100`), change acceptance
`:97` (cited as `:99`), escalation divergence `:68` (cited as `:69`),
preparation trigger `:81`, no-SDD-artifacts `:71`.

---

## REQ: package-skeleton

NODD ships as a standalone TypeScript ESM pi package rooted at
`/home/gon/projects/nodd`, installable with `pi install <path>`, with **zero
modifications to `zero-pi`** and no compile pipeline. Pure domain logic (state,
gates, evidence parsing, feature-doc schema, models config) lives in modules
that import nothing from `@earendil-works/pi-coding-agent` or
`@earendil-works/pi-tui`, so Node's native test runner can exercise them
directly. pi event registration lives in separate thin extension entrypoints.

Acceptance criteria:
- `package.json` declares `"type": "module"`, the `pi-package` keyword, a
  `pi.extensions` array listing every extension entrypoint, and
  `@earendil-works/pi-coding-agent` under `peerDependencies` only.
- `npm test` runs `node --test --experimental-strip-types` and passes on a
  clean checkout.
- No file under `src/` imports `@earendil-works/pi-tui` — not as a value
  import and not as `import type`.
- No file under `src/` imports `@earendil-works/pi-coding-agent`; every pi
  binding is confined to `extensions/`.
- `npm pack --dry-run` lists every file referenced by `pi.extensions`.

## REQ: nodd-config-isolation

All NODD configuration — model slot assignments, profiles, per-gate flags —
persists in `~/.pi/nodd.json`. NODD never reads and never writes
`~/.pi/zero.json`. Unrelated keys already present in `nodd.json` survive a
write untouched. An absent or malformed `nodd.json` degrades to defaults
instead of throwing.

Acceptance criteria:
- The config path helper returns `join(homedir(), ".pi", "nodd.json")` and no
  other path.
- A unit test asserting no NODD source file contains the literal string
  `zero.json` passes.
- Writing one slot into a config object that already contains an unknown key
  preserves that unknown key byte-for-byte.
- Reading an absent file, an empty file, and `{{{` all return the documented
  default config without throwing.

## REQ: manifest-thresholds

A single manifest module is the only source of truth for NODD's numeric
thresholds, carried over from gentle's `capabilitymanifest`: inline
understanding `1–3` files, mechanical write maximum `1` file, delegation
mapping trigger `4+` understanding files, delegation writer trigger `2+`
non-trivial writer files, long-session backstop `20` tool calls. Unlike
gentle, these values feed comparators, not `Fprintf`.

Acceptance criteria:
- The manifest exports the five thresholds as named constants with the values
  above and is imported by the delegation gate.
- A test asserts each threshold's exact value, so a silent edit fails CI.
- No threshold literal is duplicated inside any gate module.

## REQ: canonical-steps

NODD exposes exactly the seven canonical ODD steps in that order as its
visible protocol. Exactly three of them (`explore`, `resolve-uncertainty`,
`implement`) are model-backed and configurable; the other four (`authorize`,
`classify`, `track`, `close`) are mechanisms with no model slot. Two global
slots, `default` and `orchestrator`, exist alongside the three step slots.

Acceptance criteria:
- The step list is a single exported frozen array of seven ids in the order
  `authorize, explore, resolve-uncertainty, classify, track, implement, close`.
- The configurable slot set is exactly
  `{default, orchestrator, explore, resolve-uncertainty, implement}`.
- A test asserts the four mechanism steps are absent from the configurable
  slot set and present in the display list.

## REQ: feature-doc-schema

`.nodd/<slug>/feature.md` is extension-owned Markdown with a fixed schema
modelled on gentle's `odd/tasks/<feature>.md`: title, `## Objective`,
`## Problem`, `## Scope`, `## Constraints`, `## Route`, `## Tasks` (stable
`T<n>` ids with `[ ]`/`[x]`), `## Outcome`, `## Progress`. It is parsed and
rendered by NODD, never authored freehand by the model: it is written by the
extension from observed declarations and observed evidence.

Acceptance criteria:
- `parseFeatureDoc(render(doc)) deep-equals doc` for a doc with 0, 1 and 3
  tasks (round-trip test).
- A checked task carries its evidence reference inline
  (`observed: <command> → <outcome>`); rendering a checked task without an
  evidence reference is impossible by type.
- Parsing a doc with a missing required section returns a typed defect list,
  not a throw.
- Renders are deterministic: rendering the same doc twice produces identical
  bytes.

## REQ: declaration-tools

Classification and task checkoff are pi tool calls, not prose. NODD registers
two tools: `nodd_declare` (intent `read-only`|`change`, route
`inline`|`tracked`|`forge`, slug, summary) and `nodd_task` (`add`|`check`,
task id, title). The extension — not the model — writes the resulting
`feature.md`. Because they are tool calls, they are observable and gateable.

Acceptance criteria:
- Both tools are registered via `pi.registerTool` and appear in a session's
  tool list.
- `nodd_declare` with `route: tracked` creates `.nodd/<slug>/feature.md` with
  the declared objective and an empty `## Tasks` section.
- `nodd_task check T1` with no qualifying evidence in the ledger returns a
  refusal naming the missing evidence (see `REQ: gate-evidence`).
- Invalid enum values are rejected by the tool schema before any file write.

## REQ: state-kernel-readonly

A pure reducer folds observations into a per-session state: files read, files
written, mutating bash commands run, delegations issued, command outcomes,
declared route and intent, tool-call count, and the active slug. The reducer
is total, deterministic, and has no I/O; the pi extension is the only place
that turns `tool_call`/`tool_result` events into observations. In this
read-only capability NODD blocks nothing.

Acceptance criteria:
- Feeding a fixed sequence of ~20 synthetic observations into the reducer
  yields an asserted exact state snapshot.
- The reducer module imports nothing from `node:fs` and nothing from pi.
- Replaying the same observation twice (same `toolCallId`) is idempotent: the
  state after two applications equals the state after one.
- With every gate flag on but no declaration made, a read-only session of
  `read`/`grep`/`ls` calls produces zero blocks.

## REQ: parallel-batch-discipline

pi preflights sibling tool calls sequentially and executes them concurrently;
`tool_call` is not guaranteed to see sibling results from the same assistant
message (`extensions.md:757-758`). NODD therefore splits state into
**committed** (advanced only by `tool_result`) and **pending** (tool calls seen
in the current batch, keyed by `toolCallId`). No gate may consult evidence from
`pending`. Gates may consult `pending` only to count *intent* (for example,
writer-count thresholds inside one batch).

Acceptance criteria:
- A test issues `bash <test cmd>` and `nodd_task check T1` as one batch: the
  checkoff is blocked, and the reason explicitly states the evidence from the
  same batch is not yet observable and the call must be reissued next turn.
- The same two calls in separate batches (result delivered in between) succeed.
- A test asserts the evidence lookup function is only ever given committed
  observations — pending entries are structurally a different type.
- `terminate` is never set on a block, so blocking one sibling does not abort
  the rest of the batch.

## REQ: gate-framework

Every gate is a pure function `(state, request, policy) => GateDecision`
returning `{ allow: true }` or `{ allow: false, gate, reason, remedy }`. The
extension translates a refusal into `{ block: true, reason }`. Every gate
resolves its own flag and its own escape hatch through shared policy code, so
no gate can ship without them.

Acceptance criteria:
- The `GateDecision` refusal type makes `remedy` non-optional, so a block
  message without an unblocking instruction does not typecheck.
- Every rendered block message contains: the gate id, what was observed, and
  both remedies — the concrete action (e.g. "call `nodd_declare`") and the
  escape hatch literal `/nodd-allow <gate-id>`.
- A table-driven test enumerates every registered gate id and asserts each one
  has a flag entry in the default config and produces a `remedy`.
- Disabling a gate via `~/.pi/nodd.json` (`gates.<id>.enabled: false`), via
  `/nodd-gates disable <id>`, or via `--nodd-off=<id>` makes that gate return
  `{ allow: true }` while every other gate stays active; `--nodd-off=all`
  disables all of them.
- Flag semantics obey `REQ: gate-kill-switch-semantics` without exception.

## REQ: escape-hatch

`/nodd-allow <gate-id> [reason]` grants a one-shot override consumed by the
next refusal of that gate in the session. Overrides are audited via
`pi.appendEntry` so a human can see what was overridden and why. An override is
never implicit and never permanent.

Acceptance criteria:
- After `/nodd-allow track`, the next `track` refusal is allowed and the
  override is consumed; the one after it blocks again.
- An override for gate A does not affect gate B.
- Each granted override appends one NODD entry containing gate id, timestamp
  and the supplied reason.
- `/nodd-allow` with an unknown gate id lists the valid ids instead of
  silently succeeding.

## REQ: gate-authorize

When the observed declaration is `intent: read-only`, `write` and `edit` are
blocked, and bash commands classified as mutating (see
`REQ: bash-mutation-classifier`) are blocked. Flag: `gates.authorize`.

Acceptance criteria:
- With `intent: read-only` declared, a `write` tool call is blocked and the
  reason names the read-only declaration.
- With `intent: change` declared, the same call is allowed.
- With no declaration at all, `authorize` does not block (that is
  `gate-classify`'s job, not this one) — a test asserts the two gates do not
  double-block the same call with the same message.
- `gates.authorize.enabled: false` allows the write with `intent: read-only`.

## REQ: bash-mutation-classifier

A pure classifier labels a bash command string as `mutating` or
`non-mutating`. Its covered pattern set is explicit and documented:
output redirection (`>`, `>>`, excluding fd-only forms such as `2>&1`), `tee`,
in-place editors (`sed -i`, `perl -i`), file movers/removers (`mv`, `cp`, `rm`,
`rmdir`, `ln`, `install`, `dd`, `truncate`, `touch`, `mkdir`), permission
changes (`chmod`, `chown`), `patch`, mutating `git` subcommands (`apply`,
`checkout`, `restore`, `reset`, `commit`, `stash`, `clean`, `mv`, `rm`),
package installers (`npm|pnpm|yarn|pip|cargo` install/add), inline
interpreters (`node -e`, `python -c`), and an interpreter running a script
file as its **first** argument (`node script.js`, `bash script.sh`). Only the
first argument is inspected: an interpreter given flags before its script
(`node --test test/parity-matrix.test.ts`) is deliberately not covered, because
scanning past flags would classify this project's own test invocation as a
write. A named script file is assumed to mutate, since the command string does
not say otherwise.

**The gate is imperfect by design and must say so.** The shipped documentation
declares, in the same place, which mutation vectors are covered and which are
**not**: a script run without naming an interpreter, or a build target
(`./build.sh`, `make`, `npm run build`), an interpreter whose script is not its
first argument or is passed as a string (`node --flag s.js`, `bash -lc '…'`), a
script piped into an interpreter (`cat gen.py | python3`),
compilers/formatters/codegen that write as a side effect,
redirection hidden behind a variable or `eval`, a pre-existing background
process, writes performed by other extensions' or MCP tools, writes outside pi
entirely, and — pending `REQ: subagent-enforcement-truth` — writes performed
inside pi-subagent children.

Acceptance criteria:
- A table test covers ≥ 20 commands with the expected label, including the
  negative cases `ls -la`, `grep -rn 'a>b' src`, `cmd 2>&1`, `git status`,
  `git log`, `npm test`.
- `README.md` contains a "Covered / Not covered" table whose "covered" rows
  are generated from — or asserted against — the classifier's pattern list, so
  the two cannot drift.
- A test asserts the README's not-covered list is non-empty and mentions
  scripts and indirect writers by name.
- No documentation string in the package claims the bash gate is complete,
  exhaustive, or a guarantee.

## REQ: gate-track

Before the first write of a `tracked` or `forge` route run, `.nodd/<slug>/feature.md`
must exist. A `write`/`edit` call, or a bash call classified as mutating, is
blocked while it is absent. Flag: `gates.track`.

Acceptance criteria:
- Route `tracked` declared, no `feature.md` on disk: a `write` is blocked and
  the reason names the exact missing path and tells the model to call
  `nodd_declare`, or to use `/nodd-allow track`.
- The same call with `feature.md` present is allowed.
- Route `inline` declared: the gate does not block (small understood work
  stays small).
- A mutating bash command (`echo x > f`) is blocked under the same conditions;
  a non-mutating one (`npm test`) is not.
- Writes targeting `.nodd/**` by `write`/`edit` are always blocked with a
  reason pointing to `nodd_task` — the feature doc is extension-owned and
  cannot be edited directly to fake state.

## REQ: gate-classify

No first write without a declared route. If no `nodd_declare` observation
exists in committed state, the first `write`/`edit`/mutating-bash call is
blocked. This mechanizes the *declaration*, not the judgement — exactly the
hole gentle admits (`odd/tasks/odd-mandatory-delegation.md`: "non-delegation is
invisible"). Flag: `gates.classify`.

Acceptance criteria:
- With no declaration, a `write` is blocked and the reason instructs the model
  to call `nodd_declare` with an explicit route.
- After a `nodd_declare` result is committed, the same `write` is allowed.
- A declaration observed only in `pending` (same batch) does not unblock the
  write; the reason cites the batch rule.
- `gates.classify.enabled: false` allows the undeclared write.

## REQ: gate-delegate

The kernel counts real understanding reads and non-trivial writer files from
tool events. When a count crosses a manifest threshold (`4+` mapping files or
`2+` writer files) and no delegation has been observed, further direct
implementation work is blocked with an instruction to delegate. The
long-session backstop of `20` tool calls produces the same refusal. Flag:
`gates.delegate`.

Acceptance criteria:
- Committed state with 4 distinct files read and no `subagent` observation:
  the next `write` is blocked and the reason quotes the observed count and the
  threshold.
- After a `subagent` tool result is committed, the block clears.
- With 3 files read the gate allows — the boundary is asserted at both 3 and 4.
- Counting is per distinct path, not per call: re-reading one file 6 times does
  not cross the mapping threshold.

## REQ: observed-command-outcome

NODD derives a bash command's outcome only from the observed `tool_result`,
never from model prose. Because `BashToolDetails` carries no `exitCode`
(`dist/core/tools/bash.d.ts:14`) and pi's bash tool appends a status line and
throws for any nonzero code (`dist/core/tools/bash.js:321,337,341,347`), the
mapping is:

| observation | outcome |
| --- | --- |
| `isError === false` | `success` (exit code 0 by construction) |
| `isError === true`, last line `Command exited with code N` | `exit` with code `N` |
| `isError === true`, last line `Command aborted` | `aborted` |
| `isError === true`, last line `Command timed out after N seconds` | `timeout` with `N` |
| `isError === true`, anything else | `unknown` |

`success`, `exit`, `aborted`, `timeout` and `unknown` are five distinct
outcomes and are never collapsed into a boolean. **Fail-closed: `unknown` is
never treated as success** and never satisfies an evidence requirement.

Acceptance criteria:
- A table test asserts each of the five rows above, including
  `Command exited with code 137`, `Command timed out after 120 seconds`, and a
  non-matching error text mapping to `unknown`.
- Status parsing reads the last non-empty line, so a command whose *stdout*
  contains the text `Command exited with code 1` but which succeeded is still
  `success`.
- A test proves the recorded outcome comes from the observed tool result and
  not from a model claim: the same task checkoff is attempted twice — once
  with an assistant message asserting "tests pass" and no tool result, once
  with a real failing `tool_result` — and both are refused, while only a real
  successful `tool_result` is accepted.
- The outcome type has no `boolean` field named `ok`/`passed`/`success` that
  could re-collapse the five cases.

## REQ: evidence-ledger

`.nodd/<slug>/state.json` durably records observations that can back a
checkoff: `toolCallId`, `toolName`, the command string, the outcome, and a
timestamp. It is append-only within a run, survives session restart, and is
the only input to the evidence gate. Session-level recovery additionally uses
`pi.appendEntry` so a reloaded session rebuilds in-memory state.

Acceptance criteria:
- Appending two observations and re-reading the file yields both, in order.
- A truncated/corrupt `state.json` is reported as a defect and treated as
  empty; it never crashes the session and never counts as evidence.
- **The writer has a production caller.** A successful checkoff records the exact
  observation it relied on, keyed by `toolCallId`, and a test asserts the file
  exists on disk afterwards. A ledger module nothing calls makes every rule
  below unreachable code, which is how round 1 documented an
  `unverified`/`mismatch` distinction that could not occur.
- A record that contradicts an observation this process made reads as
  `mismatch`, not as `unverified`, and fails the checkoff closed: the observed
  calls are passed to the classifier so the branch is reachable.
- A failure to write the ledger never aborts a session or discards a checkoff
  the gate already allowed on observed evidence.
- The ledger writer is atomic (write temp + rename): a test asserts no partial
  file is visible under an interrupted write.
- The ledger never records model-authored text as an observation — a test
  asserts the append API accepts only observation records carrying a
  `toolCallId`.

## REQ: gate-evidence

`nodd_task check <id>` is refused unless this process observed a `success`
outcome **of the runner declared for the feature**, produced after the task's
last recorded write. An `exit`/`aborted`/`timeout`/`unknown` outcome never
satisfies it. When TDD mode is active for the run, a task additionally requires
an earlier observed non-`success` outcome (RED) before an implementation
checkoff is accepted. Flag: `gates.evidence`.

The binding to the declared runner is what makes the evidence about the task
rather than about the session: an exit-0 the model chose freely certifies
nothing. `nodd_declare` records the runner into the feature doc's
`## Verification` section before the work, so the check cannot be selected after
the fact to fit whatever passed. **Honest limit:** the model still chooses the
runner; NODD enforces only that the choice is durable and prior. With no runner
declared, the runner check is skipped and the recorded evidence says so.

Ordering against the last write uses the kernel's observation sequence, not
wall-clock timestamps: a write and the command that follows it routinely share a
millisecond, and a clock comparison then admits a run that preceded the edit.

Acceptance criteria:
- Empty ledger: `nodd_task check T1` is refused and the reason says which
  command class is missing and how to produce it.
- Ledger holding only `{ outcome: unknown }`: still refused.
- Ledger holding `{ outcome: exit, code: 1 }`: refused, reason quotes code 1.
- Ledger holding `{ outcome: success }` after the task's last write: accepted,
  and the rendered `feature.md` line carries `observed: <command> → success`.
- TDD mode on with only a `success` observation and no prior RED: refused with
  a reason naming the missing RED observation.
- `gates.evidence.enabled: false` accepts the checkoff but the rendered line
  records `observed: none (gate disabled)` — the artifact never claims
  evidence it does not have.
- **Stale-green attack:** a `success` of the declared runner observed *before*
  the task's last write is refused, asserted end to end from `nodd_declare`
  through a blocked `nodd_task check`, with the run and the edit in the same
  millisecond.
- **Echo attack:** `echo 'I have verified that all tests pass'` exits 0 and is
  refused, because it is not the declared runner; the model's prose never
  reaches the artifact. A command merely containing the runner as a substring is
  likewise not a run of it.
- Evidence observed in another process is not evidence here: on resume the
  kernel rebuilds declaration, files and counters but not command results, so a
  resumed session must re-run the check. A two-session test asserts the refusal
  and that re-running lifts it.
- **Mutation:** neutralizing the runner binding, or the write-ordering
  comparison, must each turn the suite red.

## REQ: subagent-enforcement-truth

It is **not established** that a parent-loaded pi extension runs inside
pi-subagent child processes. Before any capability depends on child-side
enforcement, an empirical spike must determine the answer, and the product must
then declare the truth about its enforcement scope rather than imply coverage
it does not have.

Acceptance criteria:
- A reproducible spike procedure is committed under `spike/subagent-enforcement/`
  (probe extension + exact commands to run).
- `spike/subagent-enforcement/RESULT.md` records the observed answer with the
  pi version, the command run, and the raw marker/blocked-call evidence.
- `README.md` contains an "Enforcement scope" section stating, based on that
  result, whether NODD gates apply inside delegated sub-agents; if they do not,
  it says so plainly and lists it as an uncovered vector in the bash classifier
  table.
- No task that depends on child-runtime enforcement is started before the spike
  result exists.

## REQ: nodd-agents-provisioning

If, and only if, the spike shows NODD's gates load in child runtimes, NODD
provisions its own pi-subagents agent files for the three model-backed steps
(`nodd-explore`, `nodd-resolve-uncertainty`, `nodd-implement`) in the
`~/.pi/agent/agents/nodd/` namespace, following the `sdd-agents.ts` pattern.
Provisioning failures never break a pi session. If the spike shows gates do
**not** load in children, this capability ships with the enforcement caveat
documented alongside it.

Acceptance criteria:
- Generated files land only under `~/.pi/agent/agents/nodd/` — never under
  `~/.pi/agent/agents/zero/`.
- Each generated file's frontmatter model comes from `~/.pi/nodd.json`, with
  the `default` slot as fallback.
- A failure writing one agent file does not prevent the other two.
- The renderer is pure and unit-tested against an expected frontmatter+body
  string; the extension only performs I/O.

## REQ: nodd-models-command

`/nodd-models` is a deterministic code handler (no LLM prompt) that displays
all seven canonical steps and configures only the five slots of
`REQ: canonical-steps`. The four mechanism steps render as
`mecanismo · sin modelo` and cannot be assigned. It supports direct assignment
(`/nodd-models implement=provider/model`) and an interactive picker via
`ctx.ui.custom`. Models come from pi's live `ctx.modelRegistry`, not a
hardcoded catalog. Patterns are **adapted from**, never imported from,
`zero-models.ts` / `zero-models-picker.ts` / `zero-models-profiles.ts`.

Acceptance criteria:
- `/nodd-models` output lists all seven steps in canonical order, with the four
  mechanism steps marked `mecanismo · sin modelo`.
- `/nodd-models classify=x/y` is rejected with a message saying `classify` is a
  mechanism step.
- `/nodd-models implement=unknown/model` is rejected against the live registry;
  a bare ambiguous model id is rejected with qualified suggestions.
- `/nodd-models implement=provider/model` writes only `models.implement` into
  `~/.pi/nodd.json`, preserving all other keys.
- The picker state machine module has no `node:fs` and no pi imports and is
  unit-tested headlessly; quitting the picker writes nothing, saving writes
  once.
- No NODD file imports `@earendil-works/pi-tui`, value or type.

## REQ: nodd-models-profiles

Named profiles store a full slot assignment set under `profiles` with
`activeProfile`, inside `~/.pi/nodd.json` only. Editing a slot while a profile
is active mirrors into that profile. Malformed profile data is discarded
safely rather than throwing.

Acceptance criteria:
- `new`, `save`, `use`, `delete` behave as unit-tested pure transforms
  returning updated data plus a message; the command decides whether to write.
- Reserved verb names and invalid characters are rejected as profile names.
- A profile written by NODD is never visible to `/zero-models` — asserted by
  the `zero.json` isolation test in `REQ: nodd-config-isolation`.
- Corrupt `profiles` value parses to an empty profile set with a defect note.

## REQ: forge-promotion

Promotion converts `.nodd/<slug>/` into forge-shaped artifacts: it writes
`.sdd/<slug>/requirements.md` from the feature doc's objective, problem, scope
and constraints, and carries already-completed tasks in as **context that must
not be redone**. It deliberately does **not** write `design.md` or `tasks.md`,
so forge's own resume algorithm (`orchestrator.md:102-105`) classifies the run
as `no-plan` and restarts at **plan**. Forge is an optional dependency: absent,
NODD keeps local state and reports that promotion cannot run, without blocking
normal use.

Acceptance criteria:
- Given a feature doc with 3 tasks, 2 checked, the converter emits a
  `requirements.md` containing the objective and constraints, and a section
  listing the 2 completed tasks with their observed evidence, explicitly
  labelled as already-resolved context.
- The converter writes exactly one file; asserting `design.md` and `tasks.md`
  are absent afterwards passes.
- Promotion into a slug directory that already holds a `requirements.md`
  refuses and reports, rather than overwriting.
- With forge unavailable, `/nodd-promote` still writes the artifacts and
  reports that `/forge --continue <slug>` must be run manually; it does not
  throw.
- The converter is pure (string in, string out); file I/O lives in the command.

## REQ: gate-promotion-trigger

Promotion triggers are observable, never a size judgement, and there are exactly
two: (a) the declared runner produces a non-`success` outcome twice
consecutively, (b) a task writes more distinct files than were declared for it.
Either blocks further implementation writes with an instruction to promote or to
override. Flag: `gates.promotion`.

A third trigger, "the user asks", was specified and **removed**. `/nodd-promote`
lives in its own extension, holds no kernel state and performs the promotion
itself, so no gate can observe the request while there is still something to do
about it. It was first shipped as a hardcoded `false`, which made the gate look
operational while being inert — the exact overclaim this requirement exists to
prevent — so the condition is deleted from `PromotionSignals` rather than
retained as an unimplementable clause.

Acceptance criteria:
- Two consecutive non-`success` outcomes of the declared runner block the next
  `write`, driven through the registered gate rather than the gate function, and
  the reason names both failures.
- One failure followed by a success does not block, and failures of some other
  command never count.
- Writing a 3rd distinct file when 2 were declared blocks with both counts in
  the reason, asserted end to end from `nodd_declare` through a blocked write.
- The reason offers exactly two ways forward: `/nodd-promote <slug>` or
  `/nodd-allow promotion`.
- `PromotionSignals` carries no field the kernel cannot derive from observed
  tool events; a test asserts `userRequested` appears in neither the type nor
  the gate's executable code.
- **Mutation:** deleting the `promotion` row from the gate registry must turn
  the suite red. A gate that can be unwired without a failing test is not
  covered, whatever its unit tests say.

## REQ: dynamic-prompt

`before_agent_start` injects only what applies right now, in two bounded
blocks, instead of a fixed ~10 KB prose wall. The handler chains on the
incoming `systemPrompt` rather than replacing it wholesale.

- **Block A — state.** Current step, enabled gates, what is missing now, the
  escape-hatch syntax, disabled-gate and used-hatch notices. Budget: **1500
  characters**.
- **Block B — forwarded prose.** Only the `(P)` clauses of
  `REQ: odd-parity-matrix` that belong to the current canonical step. Budget:
  **2500 characters**.

Acceptance criteria:
- The renderer is a pure function `(state, policy) => string`, unit-tested for
  three states: undeclared, tracked-with-pending-evidence, and all-gates-off.
- With every gate disabled, block A is at most a single line stating NODD is
  inactive; block B still forwards the current step's prose, because prose is
  not a gate and the kill switch governs gates only.
- Block A ≤ 1500 chars, block B ≤ 2500 chars, and the combined injection for a
  typical mid-implementation state ≤ 4000 chars — each asserted against the
  **corpus**, before any truncation, so the ODD prose-wall anti-pattern cannot
  creep back one clause at a time. Asserting the post-truncation length is
  tautological: it measures the truncator, not the corpus.
- **Mutation:** adding clauses to the corpus past a budget must make the
  assertion fail. A test that stays green while the corpus grows past its cap —
  as round 1's did, dropping 3,876 characters and all four real ODD clauses —
  is proving nothing.
- An over-budget block is still cut at runtime (the cap is the mechanism), but
  the cut is announced inside the block and listed in the rendered result's
  `overBudget`, never silent.
- Block B for step `implement` contains no clause tagged for `explore` only —
  asserted by test, so forwarding stays step-scoped rather than total.
- The handler returns `{ systemPrompt: incoming + block }`, never a replacement
  that drops the incoming prompt; asserted by a test on the handler's output.

## REQ: honest-scope-documentation

NODD's documentation states what it enforces and what it does not, in the
product itself — the failure mode it exists to correct is ODD's promise of
compliance backed only by delivery. No README sentence may assert a guarantee
the code does not implement.

Acceptance criteria:
- `README.md` contains: the covered/not-covered mutation table, the enforcement
  scope statement from the spike, the five command outcomes with the
  fail-closed `unknown` rule, the per-gate flag and escape-hatch reference, the
  `REQ: odd-parity-matrix` M/P/F table, and the
  `REQ: escalation-divergence` statement.
- A test asserts `README.md` mentions every registered gate id.
- A test asserts `README.md` contains no occurrence of the words
  "guarantees", "garantiza", "exhaustive" or "all writes" in the bash-gate
  section.

---

# ODD parity matrix

## REQ: odd-parity-matrix

Every clause of ODD's rendered guidance surface
(`/tmp/gentle-ai/internal/components/agentguidance/routing.go:40-120`,
commit `d4187c1d996754475f22fa7368d1c9afb1b8a938`) is classified into exactly
one of **(M)** mechanized, **(P)** forwarded prose, or **(F)** out of scope.
Nothing is left unclassified. A `(P)` classification must state *why* the
clause is not mechanizable — "we did not get to it" is not a reason, and a
clause must never be silently upgraded to an implied guarantee.

This matrix is the contract for what NODD inherits from ODD. It is the answer
to "do we have the useful parts of ODD and its foundations?".

A **(M)** classification is a claim about machinery, so it carries a burden of
proof: the row must name something that exists in this repository — a `REQ:`
with acceptance criteria, a registered gate id, a source file, a tool, or a
command. "Mechanized" with nothing named is the overclaim NODD accuses ODD of,
and round 1 shipped three such rows (13, 45, 46).

Acceptance criteria:
- `test/parity-matrix.test.ts` parses this matrix and asserts: row numbers are
  contiguous from 1 with no duplicates, every row carries one of the three
  classes, and every row cites the `routing.go` line it came from.
- Every **(M)** row names at least one mechanism that exists, verified by
  resolving the citation — a `REQ:` heading, a gate in `GATE_IDS`, a file on
  disk, a tool registered in the kernel, or a command file. A row citing
  something absent fails, so the matrix cannot be repaired with a plausible
  name.
- Every **(P)** row states a reason the clause resists mechanization; a row that
  defers ("we did not get to it", "later", "TODO") fails.
- Rows 13, 45 and 46 are each pinned by a dedicated test naming their specific
  mechanism, so a regression identifies the claim that broke.
- The README's summary of the matrix must not contradict it: every class the
  matrix assigns is explained in the README, and any clause total the README
  quotes equals the real row count. `assert.ok(README.includes("(M)"))` is **not**
  an acceptance criterion for this requirement — it passes on any document
  containing that substring.

### Protocol steps (`routing.go:41-53`)

| # | line | ODD clause | class | how / why |
| --- | --- | --- | --- | --- |
| 1 | `:41` | ODD is the predefined workflow; every request enters it; "never describe this workflow, run it" | **M** | NODD is a loaded extension: `extensions/nodd-kernel.ts` registers `tool_call` on load, so gates run on every session without the user asking. Enforcement is the running. |
| 2 | `:43` | Authorize: investigation/explanation/review/audit/planning are read-only unless change is explicitly requested | **M** | `REQ: gate-authorize` + `nodd_declare intent` |
| 3 | `:44` | Read-only may inspect/explain/compare/recommend but must not write, edit, delegate a writer, or create artifacts | **M** | `gate-authorize` blocks `write`/`edit`/mutating bash when intent is `read-only`, and delegation to a *writer*; delegating to a read-only worker is allowed (`a24b1cf`), which is what ODD `:70`/`:92` requires |
| 4 | `:45` | If change intent is ambiguous, ask one clarification and stay read-only until answered | **P** | "Ambiguous" is a judgement about natural language. NODD mechanizes the *consequence* (undeclared ⇒ blocked, `gate-classify`) but the asking is prose. |
| 5 | `:46` | Explore existing code and requirements first, proportionate to the request | **P** | Proportionality is a judgement. The delegation counters (`gate-delegate`) mechanize the *excess*, never the sufficiency: NODD cannot tell "enough exploration" from "too little". |
| 6 | `:47` | Resolve uncertainty: optional research for a named uncertainty; one focused question; at most one assumption challenge | **P** | Whether a premise is "high-consequence and unproven" is not observable from tool events. Forwarded as `resolve-uncertainty` step prose. |
| 7 | `:48` | Classify: substantial = 2+ meaningful steps or progress worth recovering; small work stays small | **M** (declaration) + **P** (judgement) | The *judgement* is not mechanizable — this is ODD's own admitted hole. The *declaration* is: `gate-classify` blocks the first write until a route is declared, so a skipped classification is observable instead of silent. |
| 8 | `:49` | Track before the first write: create the feature doc before the first source write, without asking permission | **M** | `REQ: gate-track`. The Engram mirror half is **(F)** — see `REQ: odd-parity-out-of-scope`. |
| 9 | `:49` | Tell the user in one line which doc was created and how many tasks it holds | **M** | `nodd_declare` returns exactly that line from the rendered doc. |
| 10 | `:50` | Implement task by task; check off only observed outcomes | **M** | `REQ: gate-evidence` + `REQ: observed-command-outcome` |
| 11 | `:50` | Every task closes with a work-unit commit, branch first when on the default branch, Conventional Commit, commit identity recorded as evidence | **M** (observation) + **P** (composition) | NODD observes commits from tool results and records the SHA (`REQ: evidence-ledger`). Creating branches and PRs composes with `/zero-branch` and `/zero-pr` — see `REQ: delivery-strategy`. Conventional-Commit *wording* is prose. |
| 12 | `:50` | Push, PR creation and merge remain the user's decisions | **M** | NODD never issues them, asserted by a source scan in `test/parity-matrix.test.ts`: no gate and no tool in NODD runs `git push`, `gh pr` or `git merge`. |
| 13 | `:51` | Close: report verified outcome, every failed/skipped/pending check, and the next step | **M** | `renderOutcome()` in `src/feature-doc.ts` derives `## Outcome` from the task list on every save, so a pending or unverified check cannot be omitted by a caller. `## Progress` is appended by `REQ: change-acceptance-rules` on reopen. The *next step* is **(P)**: which work comes next is a judgement. |
| 14 | `:51` | The review candidate is a work-unit commit or a PR slice, never a TODO checkbox and never the accumulated branch | **M** | `REQ: review-candidate-rule` |
| 15 | `:52` | Resume via `mem_context` → `mem_search` → `mem_get_observation` → the task file | **M** (disk) + **F** (memory) | `REQ: state-kernel-readonly`: `extensions/nodd-kernel.ts` rebuilds context from the session log on `session_start`, idempotent by `toolCallId`. Evidence is deliberately *not* replayed — see `REQ: gate-evidence`. Engram/Cortex is out of scope per `REQ: odd-parity-out-of-scope`. |

### Routes (`routing.go:53-71`)

| # | line | ODD clause | class | how / why |
| --- | --- | --- | --- | --- |
| 16 | `:53` | Exactly one route per authorized change: direct inline, delegated direct, or optional SDD | **M** | `nodd_declare route: inline\|tracked\|forge`, recorded and enforced |
| 17 | `:57` | Direct inline: decide/verify from 1–3 files; one mechanical understood change stays inline | **M** | `REQ: manifest-thresholds` feeds the `gate-delegate` comparator |
| 18 | `:63` | Delegated direct: delegate exploration at 4+ files, one writer at 2+ non-trivial files | **M** | `REQ: gate-delegate` |
| 19 | `:63`,`:81` | Reading that prepares a write, and broad research, delegate too | **P** | `REQ: preparation-trigger-prose`. Whether a read *prepares a write* is an intention, not an observable: the same `read` call looks identical whether it precedes an edit or ends the session. NODD forwards it as prose and mechanizes only the volume (`gate-delegate`). |
| 20 | `:67` | Optional SDD selected only by explicit request or accepted proposal; do not recommend SDD to resolve ambiguity | **M** | `gate-promotion` never fires on ambiguity; its triggers are observables only |
| 21 | `:68` | File count, changed lines, size, or perceived risk alone never selects SDD | **M**, **deliberately divergent** | `REQ: escalation-divergence` |
| 22 | `:69` | Automatic pace is not mutation authorization; once authorized, work continues under the selected route | **M** | `gate-authorize` keys on the declared intent, never on a gate's own activity |
| 23 | `:70` | Routes are not a ban on per-action delegation: tests, builds, installs and review actors may use fresh workers | **M** | `gate-delegate` counts only understanding reads and writer files for the mapping and writer triggers, so test/build/install commands never reach those. The long-session backstop (`routing.go:82`) is a separate clause and counts every tool call, these included: 25 runs of the declared runner with no delegation does fire it |
| 24 | `:71` | Direct and delegated work never create SDD artifacts, prompts, phase attempts or synthetic SDD runs | **M** | `REQ: no-sdd-artifacts-off-route` |

### Mandatory delegation triggers (`routing.go:77-84`)

| # | line | ODD clause | class | how / why |
| --- | --- | --- | --- | --- |
| 25 | `:78` | Triggers are mandatory, not advisory; executing past a fired trigger inline is a defect even if the work succeeds | **M** | This is the single clause ODD most conspicuously fails to enforce. `gate-delegate` blocks. |
| 26 | `:79` | Mapping trigger at 4+ understanding files | **M** | `gate-delegate`, distinct-path counting |
| 27 | `:80` | Writer trigger at 2+ non-trivial files | **M** | `gate-delegate`, counting committed writes plus same-batch pending write intent |
| 28 | `:81` | Preparation trigger | **P** | `REQ: preparation-trigger-prose`. A read that prepares a write is indistinguishable, in tool events, from a read that does not: the trigger is about intent, so it is forwarded as prose rather than counted. |
| 29 | `:82` | Long-session backstop: ~20 tool calls, 5 exploratory reads, or 2 non-mechanical edits without delegation | **M** (tool calls, reads) + **P** ("non-mechanical") | `REQ: manifest-thresholds` feeds `gate-delegate`: tool calls and distinct reads are counted exactly in `src/state.ts`. Whether an edit is "non-mechanical" is a judgement and is not counted; the backstop fires on the two observable counters. |
| 30 | `:83` | Route declaration per task with trigger evidence, so skipped delegation is observable | **M** | `nodd_declare` + the `## Route` section, rendered from observations |
| 31 | `:84` | Triggers never select SDD and never create SDD artifacts | **M** | `REQ: no-sdd-artifacts-off-route` |

### Organic flow detail (`routing.go:87-104`)

| # | line | ODD clause | class | how / why |
| --- | --- | --- | --- | --- |
| 32 | `:89` | Research optional; if declined continue only where safe; disclose unresolved uncertainty | **P** | Safety-under-missing-evidence is a judgement |
| 33 | `:90` | Establish problem/outcome/constraints/evidence; adapt depth to consequence; parent owns product decisions; workers return gaps | **P** (depth) + **M** (structure) | `src/feature-doc.ts` requires the Objective, Problem, Scope and Constraints sections, so the structure is enforced on every render; the depth is a judgement about consequence and stays prose. |
| 34 | `:91` | Prefer primary sources; attribute claims to URLs/code locations; distinguish verified facts from assumptions | **P** | Citation quality is not observable from tool events |
| 35 | `:92` | Return findings/recommendation/tradeoffs/open questions; forward research instructions to a fresh worker; research is read-only and does not authorize implementation | **P** (format) + **M** (authority) | "Research does not authorize implementation" is mechanized: an observed `subagent` result never sets intent. Only `nodd_declare` does. |
| 36 | `:93` | At most one scoped assumption challenge; name premise/evidence/consequence; no debate loop | **P** | Whether an utterance is a "challenge" — and whether a premise is high-consequence enough to deserve one — is a judgement about natural language, invisible in tool events. Forwarded as `resolve-uncertainty` prose. |
| 37 | `:94` | Small understood work creates no durable artifacts; substantial means coordinated steps, not a line count | **M** | Route `inline` creates no `.nodd/<slug>/`; `gate-track` does not fire. No NODD threshold converts size into a route. |
| 38 | `:95` | ~400 authored changed lines per task as a **planning heuristic only** — not an acceptance criterion, hard cap, counter-trigger, automatic stop, forced split or RDD trigger | **P** | `REQ: line-heuristic-anti-gaming`. Deliberately *not* mechanized: a counter on this number would become the cap the clause forbids, and would reward deleting comments and splitting work to fit it. The judgement of whether a task is too big stays with the reader. |
| 39 | `:95` | Never delete blank lines/comments for cosmetic savings, never minify, never omit tests, never split artificially; forward this same advisory to subagents | **P**, forwarded | `REQ: line-heuristic-anti-gaming`. "Cosmetic" and "artificial" are judgements about why a change was made, which no tool event carries: a deleted comment looks the same whether it was noise or savings. Forwarded verbatim, to subagents too. |
| 40 | `:96` | One feature document with objective, problem, scope, constraints, stable-ID checklist, acceptance criteria, checks, progress, evidence, next step; reuse feature identity; never overwrite another feature | **M** | `REQ: feature-doc-schema`; promotion refuses to overwrite |
| 41 | `:97` | Accepted changes preserve valid completed and unrelated work; add new or reopen invalidated tasks **with a reason**; findings alone never authorize scope expansion; business scope changes still need user authorization; checkboxes grant no approval or receipt | **M** (preservation, reason, checkbox) + **P** (business scope) | `REQ: change-acceptance-rules`: `src/change-acceptance.ts` refuses a reopen without a reason and preserves completed tasks. The **(P)** half is "business scope": whether a change is a product decision needing the user, rather than an implementation detail, is a judgement no tool event reveals. |
| 42 | `:98` | Read back both writes, they are not atomic; preserve both versions on irreconcilable edits; report limitations rather than claiming success | **M** (disk half) + **F** (Engram half) | `REQ: write-readback` covers the disk half. The Engram half is out of scope per `REQ: odd-parity-out-of-scope`: there is no second store to reconcile against. |
| 43 | `:99` | On resume, read the actual task file; do not infer active work from newest global memory; reconcile before continuing | **M** | `REQ: state-kernel-readonly`: resume reads the feature doc through `src/feature-doc.ts` and the session log, reconciled and idempotent by `toolCallId` |
| 44 | `:100` | Parent reads file and observation and passes the locator to workers; small work without a doc still receives authorized scope and checks | **P** | Prompt-level handoff discipline: NODD cannot read a subagent prompt's *meaning* to tell a well-briefed delegation from a bare one, so the quality of the handoff stays prose. `gate-delegate` mechanizes only whether delegation happened at all. |
| 45 | `:101` | Resolve TDD on/off from config or explicit choice; record mode, source and runner; presence of a framework does not enable TDD; when enabled require observed RED before implementation | **M** | `REQ: gate-evidence` TDD clause. RED is an observed non-`success` outcome, never a claim. Mode/source/runner are recorded in the doc. |
| 46 | `:102` | Run applicable functional checks per task, not a review cycle per checkbox | **M** | `REQ: gate-evidence`: a checkoff needs an observed success of the runner declared for the task, postdating that task's last write (`src/gates/evidence.ts`). Evidence is keyed to the declared runner and the write, never to the checkbox event. |
| 47 | `:102` | The native review candidate is a work-unit commit or a PR slice, never a checkbox, never the accumulated branch | **M** | `REQ: review-candidate-rule` |
| 48 | `:102`,`:104` | `gentle-ai review assess` tiers, consent ceremony, preflight STATUS, boundary advance | **F** | Depends on the `gentle-ai` binary, explicitly not copied (`PLAN.md` §9). NODD's analogue is forge's `veredicto`. |
| 49 | `:103` | Delivery strategy, line forecast, running count, chain strategy, slice boundaries | **M** (record) + **P** (ask) + **F** (execute) | `REQ: delivery-strategy`: `src/delivery.ts` records the strategy and the running count. Asking for a forecast is prose, because a line estimate is a prediction. Executing the chain is **(F)**: pushing and slicing PRs is the user's, per row 12. |

### Receipt-driven development kill switch (`routing.go:106-118`)

| # | line | ODD clause | class | how / why |
| --- | --- | --- | --- | --- |
| 50 | `:106-110` | The switch ships in the always-installed block because "a switch the agent cannot name does not exist for the user, who would otherwise ask to stop and be argued with instead of obeyed" | **M** | `REQ: gate-kill-switch-semantics` — inherited verbatim as NODD's gate-flag semantics |
| 51 | `:113` | Opt-in, off by default; do not treat off as a fault to diagnose or work around | **M**, inverted default | `REQ: gate-kill-switch-semantics`: NODD's gates are **on** by default (that is the product), but "off is not a fault" is inherited exactly — `resolveFlag` in `src/gates/policy.ts` returns a disabled gate as a normal state with its source, never an error. |
| 52 | `:114` | `status` is read-only; reports deciding source and effective mode; `default` source means nobody chose | **M** | `/nodd-gates status` |
| 53 | `:115` | When the user asks to stop, disable. Do not argue, do not work around, do not propose alternatives first | **M** | `REQ: gate-kill-switch-semantics` |
| 54 | `:116` | While disabled, keep working normally: do not start it, do not retry, do not reactivate, do not fall back to a retired path | **M** | `REQ: gate-kill-switch-semantics` |
| 55 | `:117` | Report `disabled/unmanaged`, never a fabricated approval | **M** | `REQ: gate-evidence`: a disabled `gates.evidence` renders `observed: none (gate disabled)` in `src/gates/evidence.ts` — never a claim of verification |
| 56 | `:118` | Never enable on the user's behalf unless explicitly asked | **M** | `REQ: gate-kill-switch-semantics` |

Acceptance criteria:
- Every row above resolves to exactly one primary class; no clause of
  `routing.go:40-120` is absent from the table.
- Every `(P)` row states a reason why the clause is not mechanizable.
- Every `(F)` row states why it is not carried.
- `README.md` reproduces this matrix.
- A test asserts each `(M)` row names a requirement or gate id that actually
  exists in the package, so the matrix cannot claim a mechanism that was never
  built.
- A test asserts the forwarded-prose corpus contains one entry per `(P)` row.

## REQ: odd-parity-out-of-scope

The `(F)` rows, consolidated with their reasons:

| clause | reason |
| --- | --- |
| Engram mirror `odd/<feature>/tasks`, `mem_context`/`mem_search`/`mem_get_observation` (`:49`,`:52`,`:96`,`:99`) | `clarifications.md` puts Cortex/Engram/remote memory outside this run. `.nodd/<slug>/` on disk is the source of truth, as forge already proves is sufficient. |
| `gentle-ai review assess`, candidate consent, preflight STATUS, risk tiers (`:102`,`:104`) | Requires the SHA-pinned `gentle-ai` binary, which `PLAN.md` §9 explicitly refuses as a dependency. Forge's `veredicto` is the analogue, reached by promotion. |
| Actual PR creation, push and merge (`:50`,`:103`) | They are the user's decisions (ODD `:50` says so) and are already solved by `/zero-pr` and `/zero-branch`. NODD composes, it does not reimplement. |
| Multi-runtime enforcement (Claude Code hooks, Codex, opencode) | `PLAN.md` §7: multi-runtime is what produced gentle's 11 variants. pi first and well. |

Acceptance criteria:
- `README.md` carries this table verbatim under "Not carried from ODD".
- No NODD code path imports, shells out to, or requires the `gentle-ai` binary
  — asserted by a source-scan test.

## REQ: gate-kill-switch-semantics

NODD inherits ODD's user-owned kill-switch semantics (`routing.go:106-118`)
**textually**, applied to its own per-gate flags. This is a product
requirement, not a note. The switch is `/nodd-gates enable|disable|status [gate]`,
consistent with the per-gate flags of `REQ: gate-framework` and the
`--nodd-off` CLI flag.

1. **Explicit on/off.** A gate is on or off because someone decided it, or
   because nobody did and the default applies. There is no third, implicit
   state.
2. **`status` is read-only.** It reports, per gate, the **deciding source**
   (`default` | `config` | `flag`) and the **effective mode**. A `default`
   deciding source means nobody has chosen. `status` changes nothing.
3. **Obey immediately.** When the user asks to turn a gate off, it is turned
   off. Do not argue, do not work around it, do not propose alternatives
   first. The one-line confirmation is the whole response.
4. **Never self-reactivate.** A disabled gate stays disabled until the user
   enables it. No session start, no threshold, no repeated block, and no other
   gate may re-enable it.
5. **Never enable on the user's behalf.** NODD does not turn a gate on unless
   the user explicitly asks.
6. **Work continues normally while off.** With a gate disabled, NODD keeps
   working through its normal route: it does not retry the gate, does not
   nag, does not fall back to a retired path, and does not degrade unrelated
   capabilities.
7. **Never fabricate approval.** Output produced while a gate is off says so
   (`disabled/unmanaged`) rather than implying the check passed.

The reason ODD gives is the reason NODD adopts it (`routing.go:108-110`): a
switch the agent cannot name does not exist for the user, who would otherwise
ask to stop and be argued with instead of obeyed. A gate that resists being
turned off is the same failure as a gate that does not exist.

Acceptance criteria:
- `/nodd-gates status` prints one row per registered gate with deciding source
  and effective mode, and a test asserts it performs no write.
- `/nodd-gates status` for an untouched gate reports source `default`.
- `/nodd-gates disable track` flips exactly `gates.track.enabled`, leaves every
  other gate untouched, and its output contains no alternative proposal, no
  warning about consequences and no re-enable suggestion — asserted by a test
  matching the output against a fixed one-line shape.
- After a disable, a subsequent `session_start` plus 50 folded observations
  leaves the gate disabled — asserted by test, covering self-reactivation.
- No code path writes `enabled: true` except the explicit `/nodd-gates enable`
  handler — asserted by a source-scan test.
- With `gates.track` disabled, a write proceeds, no block is emitted, no
  retry occurs, and the dynamic prompt states the gate is off rather than
  re-asking for the feature doc.
- The prompt's disabled-gate notice contains no instruction to re-enable.

## REQ: delivery-strategy

NODD inherits ODD's delivery-strategy vocabulary (`routing.go:103`) and splits
it honestly across mechanism, prose and composition:

- **(M) Recorded in the feature doc.** A `## Delivery` section holds:
  `strategy` (`ask-on-risk` default | `auto-chain` | `single-pr` |
  `exception-ok`), `chain` (`stacked-to-main` | `feature-branch-chain`),
  the line `forecast` captured at feature-doc creation, the `running` count,
  and the slice boundaries with the commits each slice holds. Both choices are
  cached in the doc so they are asked once.
- **(M) Running count from observed commits.** The count is additions plus
  deletions of **authored** changed lines, parsed from the observed output of
  NODD-issued `git` commands, never from a model estimate. Generated files are
  excluded by a documented path-pattern list.
- **(P) The asking.** `ask-on-risk` asking once for a chain strategy is
  conversational and stays prose. NODD makes the *moment* observable — crossing
  ~400 authored changed lines is computed — but it does not auto-ask.
- **(F) Executing the delivery.** Branch creation, slicing and PR creation are
  `/zero-branch` and `/zero-pr`, which already exist. NODD records the
  boundaries those commands act on; it does not reimplement them, and it never
  pushes, opens or merges.

The threshold crossing **never blocks**. It is a planning heuristic
(`routing.go:95`) and turning it into a gate would violate the clause it comes
from.

Acceptance criteria:
- The `## Delivery` section round-trips through `parseFeatureDoc`/`render`
  with all five fields.
- An invalid strategy or chain value is rejected by the tool schema.
- The line counter is a pure function over observed `git` output; a table test
  covers a normal diffstat, a diffstat containing a generated path, and
  unparseable output → the count is left unchanged and marked `unknown`,
  never guessed.
- Crossing the forecast threshold emits no block: a test asserts a `write` at
  600 running lines is allowed and only the prompt mentions the crossing.
- A test asserts no NODD code path invokes `git push`, `gh pr create`, or a
  merge.

## REQ: review-candidate-rule

The review candidate is a **work-unit commit or a PR slice** — never a TODO
checkbox and never the accumulated feature branch (`routing.go:51`, `:102`).
NODD records the candidate identity for each task as the observed commit SHA,
or as the slice boundary when the strategy defers to a slice. Checking a task
box is not a review event, does not create a candidate, and does not advance a
boundary.

Acceptance criteria:
- Checking off a task records the observed commit SHA as the candidate when
  one exists, and `candidate: pending-commit` when none does — never the
  checkbox itself.
- A test asserts no code path produces a candidate whose identity is a task id
  or a checkbox state.
- The accumulated branch is never emitted as a candidate; slice candidates
  carry an explicit boundary pair (base ref, head ref).
- The first boundary is the branch point, and each recorded boundary becomes
  the next base — asserted by a two-slice test.

## REQ: change-acceptance-rules

When user, review or verification findings change the work
(`routing.go:97`), NODD enforces:

1. **Preserve.** Valid completed and unrelated tasks are never silently
   dropped or rewritten.
2. **Reason required.** Adding a task or reopening a `[x]` task records a
   reason. Reopening without one is refused.
3. **(P) Findings never expand scope on their own.** A subagent's or a
   command's findings do not authorize new scope. Mechanized where observable:
   an observed `subagent` result cannot change the declared intent or route —
   only `nodd_declare` can.
4. **(P) Business scope changes still require user authorization.** Whether a
   change is a business-scope change is a judgement; the mechanism is that
   intent and route only ever change through an explicit declaration.
5. **Checkboxes grant nothing.** A `[x]` is not approval, not a receipt and
   not evidence; the evidence is the ledger entry it references.

Acceptance criteria:
- Reopening a checked task without a reason is refused, naming the missing
  reason; with a reason it succeeds and the doc records it under `## Progress`.
- A rewrite that would drop an unrelated completed task is refused, naming the
  task it would have lost.
- A test asserts no code path derives approval, verification or evidence from
  a checkbox state — evidence lookups key on ledger records only.
- An observed `subagent` result never mutates the declared intent or route —
  asserted by feeding a delegation observation and comparing declarations.

## REQ: preparation-trigger-prose

ODD's preparation trigger — "reading that prepares a write, and broad research
or context compression, delegate together with or ahead of the write"
(`routing.go:81`, `:63`) — is **(P) forwarded prose** and is deliberately not
mechanized.

**Why it cannot be mechanized.** `tool_call` receives a `read` with a path
(`types.d.ts:649-691`). Nothing in the event distinguishes a read that prepares
a write from a read that answers a question; the difference lives in the
model's intent, which arrives — if at all — only later, as prose. Any mechanism
would have to guess, and a gate that guesses about intent blocks correct work.
Inventing a fake trigger here would be exactly the ODD sin of asserting
enforcement that does not exist.

What NODD does instead is bound the *consequence*: the mapping trigger fires on
4+ distinct files read whatever the reason, so unbounded preparatory reading is
still caught by `gate-delegate`. That is a weaker and honestly-stated guarantee.

Acceptance criteria:
- The forwarded-prose corpus carries the preparation-trigger text under the
  `explore` step.
- `README.md` lists the preparation trigger under "advisory, not enforced",
  with the reason.
- A test asserts no gate id contains `prepar` and no gate consults read-intent
  — the mechanism does not exist and cannot be believed to exist.

## REQ: line-heuristic-anti-gaming

The ~400 authored-changed-lines figure is a **planning heuristic only**
(`routing.go:95`) and is carried as **(P) forwarded prose**. It is explicitly
not a task acceptance criterion, not a hard cap, not a counter-trigger, not an
automatic stop, not a forced split and not a review trigger. If the correct
solution naturally exceeds it, the agent explains briefly and continues, with
no size-only rework loop.

The anti-gaming clause is forwarded with it, intact: never delete blank lines
or comments for cosmetic savings, never omit tests, never minify, never add
gratuitous abstractions, never split artificially to fit the number. **The same
advisory-only instruction is forwarded to subagents** on every implementation
delegation, so a child does not optimize for a number the parent is merely
estimating with.

Acceptance criteria:
- No gate consults a line count — asserted by a test over the gate registry,
  so the heuristic can never become a block.
- The forwarded-prose corpus contains the heuristic and its anti-gaming
  sentence, under the `implement` step.
- The generated NODD agent files include the same advisory-only instruction —
  asserted against the rendered agent body.
- `README.md` states the figure is advisory and lists the six things it is not.

## REQ: write-readback

Writes are not atomic (`routing.go:98`). NODD reads back every artifact it
writes (`feature.md`, `state.json`, promoted `requirements.md`) and verifies
the content it intended is the content on disk. On failure it preserves the
existing state and reports the limitation rather than claiming success. On an
irreconcilable conflict — the on-disk doc diverging from NODD's expected
version — **both versions are preserved** (`feature.md` plus
`feature.conflict-<timestamp>.md`) and the user is asked about the real
conflict only.

The Engram-mirror half of the ODD clause is **(F)** per
`REQ: odd-parity-out-of-scope`; the disk half is fully carried.

Acceptance criteria:
- A write whose read-back mismatches reports a failure and leaves the previous
  file intact — asserted with an injected failing writer.
- A divergent on-disk doc produces both files, and neither is lost.
- The conflict report names the diverging sections, not the whole file.
- NODD never reports a successful write it did not read back — a test asserts
  the success path is reachable only after a matching read-back.

## REQ: no-sdd-artifacts-off-route

Routes `inline` and `tracked` never create `.sdd/` artifacts, forge prompts,
phase attempts or synthetic forge runs (`routing.go:71`, `:84`). Only an
explicit promotion (`REQ: forge-promotion`) writes into `.sdd/`.

Acceptance criteria:
- A full `tracked` run touching 10 files leaves `.sdd/` untouched — asserted
  by a test comparing a directory listing before and after.
- The only code path that writes under `.sdd/` is the promotion converter —
  asserted by a source-scan test.
- `gate-delegate` firing never creates an artifact of any kind; it only blocks.

## REQ: escalation-divergence

**This is a deliberate divergence from ODD, stated as such.**

ODD says: "File count, changed lines, size, or perceived risk alone never
selects SDD and never forces a heavier route" (`routing.go:68`). NODD **does**
escalate to `/forge`. The divergence is narrow and must not be read as a
rejection of ODD's rule.

**What ODD prohibits, NODD also prohibits.** ODD is banning *model judgement
about magnitude* as a routing input: "this feels big", "this looks risky",
"that is a lot of files". NODD forbids exactly that. No NODD threshold on size,
line count or perceived risk selects forge, and `gate-promotion` never consults
any of them.

**What NODD adds are three observables, none of which is a size judgement:**

1. A task's verification command produced a non-`success` outcome **twice in a
   row**. That is not "this is big", it is "the plan is wrong": the code has
   been changed twice and the observed result did not move. Planning is what
   forge does.
2. A task wrote to **more distinct files than were declared** for it. That is
   not a size threshold — one file over a declared one is enough, and a
   declared 30-file task never trips it. It means the scope was misunderstood
   at declaration time, which is a planning defect.
A third observable was specified — the user asking, which ODD already permits
(`routing.go:67`: "explicit request") — and was removed as undeliverable: the
command that would signal it is the command that performs the promotion. See
`REQ: gate-promotion-trigger`.

The difference from what ODD bans is the difference between an *estimate* and a
*measurement*. ODD's prohibition exists because size-based escalation in gentle
means paying the cost of switching to an entirely separate artifact system
("Size, ambiguity, or risk alone never selects SDD" is, as `PLAN.md` §4 notes,
a price signal wearing a design-principle costume). In NODD the transition is a
file conversion — `REQ: forge-promotion` writes one `requirements.md` and forge
resumes at `plan` — so the cost that motivated ODD's ban is absent.

Acceptance criteria:
- `gate-promotion` consults only: consecutive non-`success` outcomes of the
  declared runner, and declared-vs-observed distinct file counts.
- Both signals are derived from observed tool events; no signal is a constant.
- A test asserts a task with 40 declared files and 40 observed files does not
  trigger promotion, while a task with 2 declared and 3 observed does — proving
  the trigger is declaration mismatch, not magnitude.
- A test asserts no promotion code path reads a line count, a byte size or any
  risk score.
- `README.md` carries this divergence statement, naming `routing.go:68` and
  explaining why the observable triggers are not what ODD prohibits.
