# Design — NODD

## Code roots

- `/home/gon/projects/nodd` — **the destination**. All product code is written
  here. At plan time it contains only the tracked `PLAN.md` plus untracked
  `.sdd/` and `.pi/`.
- `/home/gon/zero/packages/zero-pi` — **read-only reference**. Source of the
  `/zero-models` command pattern (`extensions/zero-models.ts:929-1161`), the
  dependency-free picker state machine (`extensions/zero-models-picker.ts`),
  profiles (`extensions/zero-models-profiles.ts`), agent provisioning
  (`extensions/sdd-agents.ts:220-270`) and the forge resume contract
  (`prompts/orchestrator.md:65,102-105`). **Adapted, never imported.**
- `/tmp/gentle-ai` — **read-only reference**, commit
  `d4187c1d996754475f22fa7368d1c9afb1b8a938`. ODD protocol text
  (`docs/usage.md:11-21`), thresholds
  (`internal/agents/capabilitymanifest/manifest.go:203-216`), feature-doc shape
  (`odd/tasks/odd-mandatory-delegation.md`). Volatile: values are copied into
  NODD's manifest, never read at runtime.
- `/home/gon/.local/share/mise/installs/node/26.2.0/lib/node_modules/@earendil-works/pi-coding-agent`
  — pi runtime/API, outside the code root. Key evidence:
  `dist/core/extensions/types.d.ts:649-691,692-734,779-787,883,897`,
  `dist/core/tools/bash.d.ts:14`, `dist/core/tools/bash.js:321,337,341,347`,
  `docs/extensions.md:751-766,757-758,815-819`, `docs/packages.md:116-134`.
- `/home/gon/.pi/agent/npm/node_modules/pi-subagents` — composition dependency,
  outside the code root. `src/extension/index.ts:672,716` registers the
  `subagent` tool.

---

## 1. Shape of the package

```
/home/gon/projects/nodd
├── package.json                 type:module, pi.extensions, peerDep pi
├── README.md                    honest scope: covered / NOT covered
├── src/                         PURE. no pi import, no pi-tui import
│   ├── manifest.ts              thresholds + canonical step list
│   ├── config.ts                ~/.pi/nodd.json schema, read/merge/write-plan
│   ├── observations.ts          Observation types, bash outcome parser
│   ├── state.ts                 pure reducer: Observation[] -> NoddState
│   ├── bash-classifier.ts       mutating / non-mutating, documented pattern set
│   ├── gates/
│   │   ├── policy.ts            flags + escape-hatch resolution, GateDecision
│   │   ├── authorize.ts  classify.ts  track.ts  delegate.ts
│   │   ├── evidence.ts   promotion.ts
│   │   └── registry.ts          the gate list, ordered
│   ├── feature-doc.ts           parse + render .nodd/<slug>/feature.md
│   ├── ledger.ts                pure shape of state.json (I/O in extensions)
│   ├── promote.ts               featureDoc -> requirements.md string
│   ├── delivery.ts              strategy/chain/forecast + diffstat line counter
│   ├── odd-prose.ts             the (P) corpus, tagged by canonical step
│   ├── prompt.ts                (state, policy) -> block A + block B
│   ├── models/
│   │   ├── slots.ts  picker.ts  profiles.ts  assign.ts
│   └── *.test.ts                node --test --experimental-strip-types
├── extensions/                  THIN. the only place pi is imported
│   ├── nodd-kernel.ts           tool_call / tool_result / session_start /
│   │                            before_agent_start + nodd_declare, nodd_task
│   ├── nodd-models.ts           /nodd-models  (+ ctx.ui.custom picker host)
│   ├── nodd-allow.ts            /nodd-allow <gate>
│   ├── nodd-gates.ts            /nodd-gates enable|disable|status [gate]
│   ├── nodd-promote.ts          /nodd-promote <slug>
│   └── nodd-agents.ts           generates ~/.pi/agent/agents/nodd/*.md
└── spike/subagent-enforcement/  probe + RESULT.md
```

**The seam that makes this testable.** `src/` never imports
`@earendil-works/pi-coding-agent`. The extensions translate pi events into
`Observation` values and translate `GateDecision` refusals into
`{ block: true, reason }`. Every rule is therefore a pure function under
`node --test`, with no pi runtime. This mirrors zero-pi's own split
(`zero-models-picker.ts:5-11`) and is what lets a `~400`-line task ship with a
focused test.

**The no-`pi-tui` rule** is absolute, copied from
`zero-models.ts:22-32`: not a value import, not `import type`. The picker host
declares a local `interface Component { render(width): string[]; ... }` and
hands it to `ctx.ui.custom`. A stray ambient specifier would crash
`node --test` with `ERR_MODULE_NOT_FOUND`.

---

## 2. State: committed vs pending

`extensions.md:757-758` is explicit: sibling tool calls in one assistant
message are preflighted sequentially, then executed concurrently, and
`tool_call` is **not guaranteed** to see sibling results. This is a correctness
hazard, not a nuisance: a gate that read evidence from a sibling would accept
evidence that does not exist yet.

The design makes the hazard unrepresentable by typing the two halves
differently:

```ts
type NoddState = {
  committed: Committed;                  // advanced ONLY by tool_result
  pending: Map<string, PendingCall>;     // keyed by toolCallId, from tool_call
};
```

- `tool_call` → insert into `pending`, then evaluate gates.
- `tool_result` → delete from `pending`, fold an `Observation` into `committed`.

Rules, enforced by types and by test:

1. **Evidence functions take `Committed`, never `NoddState`.** `gate-evidence`
   and `gate-promotion` physically cannot see a pending sibling.
2. **Intent counting may use `pending`.** `gate-delegate` counts files a batch
   is *about to* write; that is intent, already known at preflight, and does not
   depend on a result.
3. When a gate refuses because the needed evidence is still in flight, the
   reason says so and instructs the model to reissue the call on the next turn.
   That is the documented, non-surprising resolution.
4. **`terminate` is never set.** `types.d.ts:781-786` says the agent stops early
   only when *every* finalized result in the batch is terminating; blocking one
   sibling must not abort the others.

Session reload rebuilds `committed` from `pi.appendEntry` entries replayed at
`session_start` (`extensions.md:1850-1868`, `examples/extensions/todo.ts:105-134`),
reconciled with `.nodd/<slug>/state.json` on disk, which is the durable truth.
Replay is idempotent by `toolCallId`.

---

## 3. Evidence: what the API actually gives us

`BashToolDetails` has only `truncation` and `fullOutputPath`
(`bash.d.ts:14-17`) — **no `exitCode`**. But pi's bash tool does something we
can exploit without wrapping or overriding anything
(`bash.js:321,337,341,347`):

```js
const appendStatus = (text, status) => `${text ? `${text}\n\n` : ""}${status}`;   // :321
throw new Error(appendStatus(text, "Command aborted"));                          // :337
throw new Error(appendStatus(text, `Command timed out after ${s} seconds`));     // :341
if (exitCode !== 0 && exitCode !== null)
  throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`)); // :347
```

Every non-zero termination throws, and the thrown message ends with a status
line. Therefore:

| observed | outcome |
| --- | --- |
| `isError === false` | `{ kind: "success" }` — exit 0 **by construction**: nothing non-zero returns without an error |
| `isError`, last line `Command exited with code N` | `{ kind: "exit", code: N }` |
| `isError`, last line `Command aborted` | `{ kind: "aborted" }` |
| `isError`, last line `Command timed out after N seconds` | `{ kind: "timeout", seconds: N }` |
| `isError`, no match | `{ kind: "unknown", raw }` |

Design commitments:

- **Five distinct outcomes, never a boolean.** A timeout is not a failing test;
  an abort is not a red. Collapsing them would re-import exactly the
  information loss that makes ODD's "Evidence: tests pass" worthless. The type
  is a discriminated union with no `ok` field.
- **Fail-closed on `unknown`.** Unparseable means unknown, and unknown never
  satisfies evidence. The only thing worse than no gate is a gate that green-lights
  on ambiguity.
- **Last non-empty line only.** The status is appended after the output, so
  scanning the whole text would let a command that *prints*
  `Command exited with code 1` poison its own successful result.
- **No bash wrapper, no tool override.** Rejected in this round: wrapping is
  invasive, changes UX, and would have to be re-verified against every pi
  upgrade. Reading pi's own appended status is read-only and needs nothing from
  the model.

The anti-hallucination test is a first-class requirement, not a nicety: the
same checkoff is attempted (a) with an assistant message claiming "tests pass"
and no tool result, (b) with a real failing `tool_result`, (c) with a real
successful one. Only (c) is accepted. That test is the difference between NODD
and a prompt.

Git SHA follows the same rule: parsed only from a NODD-issued command's
observed output, never from prose.

---

## 4. Gates

```ts
type GateDecision =
  | { allow: true }
  | { allow: false; gate: GateId; reason: string; remedy: Remedy };  // remedy REQUIRED

type Remedy = { action: string; escapeHatch: `/nodd-allow ${GateId}` };
```

`remedy` is non-optional so a gate that blocks without telling the agent how to
proceed does not typecheck. A blocking message always carries three things: the
observation, the concrete action, and the escape hatch.

| gate | fires on | needs | flag |
| --- | --- | --- | --- |
| `authorize` | write / edit / mutating bash | declared intent `read-only` | `gates.authorize` |
| `classify` | first write / edit / mutating bash | no committed declaration | `gates.classify` |
| `track` | write / edit / mutating bash | route `tracked`\|`forge`, `feature.md` absent | `gates.track` |
| `delegate` | write / edit | counts ≥ manifest threshold, no delegation observed | `gates.delegate` |
| `evidence` | `nodd_task check` | no committed `success` after the task's last write | `gates.evidence` |
| `promotion` | write / edit | 2 consecutive failures on a task, or undeclared file spread | `gates.promotion` |

Ordering is fixed in `gates/registry.ts`; the first refusal wins, so a call
never receives two overlapping messages. `authorize` and `classify` are
deliberately disjoint: `authorize` only speaks when an intent *was* declared as
read-only, `classify` only when nothing was declared.

**Flags.** Each gate reads `gates.<id>.enabled` from `~/.pi/nodd.json`
(default `true`), overridden by the registered CLI flag `--nodd-off=<id|all>`
(`pi.registerFlag` / `pi.getFlag`, `types.d.ts:918-926`) and driven by
`/nodd-gates`. Disabling one gate leaves every other active — a mis-calibrated
gate is removed surgically, not by uninstalling NODD. That is `PLAN.md` §7's
mitigation, made literal.

**The flags obey ODD's kill-switch semantics, inherited verbatim.**
`routing.go:106-118` ships gentle's RDD switch inside the always-installed
block, and the comment explains why: *"a switch the agent cannot name does not
exist for the user, who would otherwise ask to stop using receipt-driven
development and be argued with instead of obeyed."* NODD adopts that reasoning
whole, because a gate that resists being turned off is the same product failure
as a gate that does not exist — and NODD is shipping six of them.

Resolution is a three-source precedence with the source retained, not
collapsed: `flag` (`--nodd-off`) > `config` (`~/.pi/nodd.json`) > `default`.
`/nodd-gates status` prints both the deciding source and the effective mode and
writes nothing; a `default` source means nobody chose. `disable` obeys in one
line with no counter-argument, no consequence warning and no alternative — that
is asserted by a test matching the output shape, because "do not argue" is a
behaviour and behaviours drift. Nothing re-enables a gate but an explicit
`/nodd-gates enable`: a source-scan test asserts `enabled: true` is written from
exactly one handler, which is what makes "never reactivate itself" and "never
enable on the user's behalf" mechanical rather than aspirational. While a gate
is off, work proceeds on the normal route with no retry and no nagging, and any
artifact produced under it says `disabled/unmanaged` rather than implying a
check passed.

The one inversion: NODD's gates default **on** (enforcement is the product,
where RDD is opt-in). Everything else — read-only `status`, obey without
arguing, never self-reactivate, never enable for the user, keep working while
off, never fabricate approval — is carried unchanged.

**Escape hatch.** `/nodd-allow <gate> [reason]` grants one override, consumed
by the next refusal of that gate, audited through `pi.appendEntry`. One-shot,
never implicit, never permanent. A disabled gate and a used hatch are both
visible in the dynamic prompt, so the agent is never confused about why
something suddenly passed.

---

## 5. The bash gate, and what it is not

`tool_call` receives `BashToolCallEvent.input.command` as a **string**
(`types.d.ts:653-656`). It is not a declaration of filesystem intent. `write`
and `edit` are typed and gated exactly; bash is gated by a denylist of mutation
patterns. That is option (c) from this round's decisions: (b) fail-closed on all
bash was rejected for unacceptable friction, (d) overriding the bash tool was
rejected as invasive.

Covered patterns (the classifier's documented set): `>`/`>>` redirection
excluding fd-only forms like `2>&1`; `tee`; `sed -i`, `perl -i`; `mv`, `cp`,
`rm`, `rmdir`, `ln`, `install`, `dd`, `truncate`, `touch`, `mkdir`; `chmod`,
`chown`; `patch`; `git apply|checkout|restore|reset|commit|stash|clean|mv|rm`;
`npm|pnpm|yarn|pip|cargo install|add`; `node -e`, `python -c`.

**Not covered — stated in `README.md`, not buried here:**

- a script or target that writes: `./build.sh`, `make`, `npm run build`
- compilers, formatters and codegen writing as a side effect
- redirection behind a variable or `eval`
- a pre-existing background process
- writes by other extensions' or MCP tools
- writes outside pi entirely
- writes inside pi-subagent children, pending §7

ODD's original sin was claiming compliance while shipping delivery. NODD must
not claim completeness while shipping a denylist. The README table is
asserted by test against the classifier's own pattern list so the two cannot
drift, and a second test forbids the words "guarantees"/"exhaustive"/"all
writes" in that section. An honest partial gate beats a dishonest total one.

---

## 6. Feature doc, ledger and promotion

`.nodd/<slug>/feature.md` follows gentle's structure
(`odd/tasks/odd-mandatory-delegation.md`): title, Objective, Problem, Scope,
Constraints, Route, Tasks (`T<n>` + `[ ]`/`[x]`), Outcome, Progress. It is
**extension-owned**: the model mutates it only through the `nodd_declare` and
`nodd_task` tools, and while `gates.track` is on, `write`/`edit` targeting
`.nodd/**` is blocked. A doc the model can rewrite is a doc the model can forge,
and then evidence is prose again.

**Corrected during build (T017).** An earlier draft of this section said that
block was unconditional. It is not: REQ: gate-framework says a flag is obeyed
"without exception" and REQ: gate-kill-switch-semantics 3 forbids working
around the user's decision, so `/nodd-gates disable track` turns the whole gate
off, doc protection included. That is the documented way to hand-edit a feature
doc. A gate that keeps enforcing half of itself after the user switched it off
is exactly the workaround `routing.go:115` prohibits.

The feature doc and the ledger are not the same kind of artifact, and only the
doc is the user's. `state.json` records what the extension **observed**, so it
is never hand-editable in a meaningful sense: entries that do not match what the
kernel observed this session are not trusted, they are degraded to unverified
and reported (§6.1). Disabling `track` must not become a way to forge evidence
quietly — evidence has to keep meaning "observed", not "was written in a file".

Checked tasks render `observed: <command> → success` sourced from the ledger.
When `gates.evidence` is off the line renders `observed: none (gate disabled)`
— the artifact never overstates what was verified.

`.nodd/<slug>/state.json` holds observation records (`toolCallId`, tool, command,
outcome, timestamp), written atomically (temp + rename), corrupt-tolerant
(reported as a defect, treated as empty, never as evidence).

### 6.1 Ledger integrity: observed, not merely written

The ledger is the extension's record of what it saw, so a record the kernel did
not see is not evidence no matter how well-formed it looks on disk. Two ways one
gets there: a human editing the file with `track` off, and a delegated child
rewriting it whole (the T010 probe child did exactly that — it had `write` but no
append tool, so it re-emitted the entire file).

The rule is the fail-closed rule already used for command outcomes (T019),
applied to provenance: **a ledger record counts as observed evidence only when
its `toolCallId` is one this kernel committed this session.** Anything else —
unknown id, or an id whose command or outcome disagrees with what was observed —
is degraded to unverified, excluded from evidence, and reported. It is never
assumed valid and never silently dropped.

Detection, degradation, report. No signatures, no hash chain: an in-memory id
set already answers the only question that matters, which is whether *this*
process saw it happen. The honest limit, stated rather than papered over: a
fresh process has an empty observed set, so a pre-existing ledger is unverified
rather than proven false — the two are reported differently and neither is
counted as success.

**Promotion** (`src/promote.ts`, pure) emits **only**
`.sdd/<slug>/requirements.md`. Leaving `design.md` and `tasks.md` absent is the
whole trick: forge's resume algorithm reads exactly that and lands on state
`no-plan`, resuming at **plan** (`orchestrator.md:102-105`). Completed NODD
tasks arrive inside `requirements.md` as already-resolved context, so the work
is not redone. Zero changes to zero-pi; NODD writes files, forge reads them
with code it already has.

Promotion refuses to overwrite an existing `requirements.md`. Forge absent →
artifacts are still written and the command reports that `/forge --continue`
must be run by hand; NODD keeps working.

---

## 7. Sub-agent enforcement: unknown until measured

Nothing in the inspected pi docs establishes that a parent-loaded extension is
also loaded inside pi-subagent child processes. If it is not, then every
delegated write is ungated — and since `gate-delegate` actively *pushes* work
into sub-agents, NODD would be shipping a gate that routes work around its own
enforcement. That is not an acceptable unknown to build on.

**T009 is a spike, and it blocks the work that depends on it.** A probe
extension marks a file and attempts a write from a child; `RESULT.md` records
the pi version, the exact commands and the raw output. Both outcomes are
actionable:

- **gates load in children** → `nodd-agents.ts` provisioning proceeds
  (`~/.pi/agent/agents/nodd/`, never `zero/`), enforcement scope is "parent and
  delegated children".
- **gates do not load** → provisioning still ships, but README's *Enforcement
  scope* says plainly that delegated sub-agents are not gated, and the
  uncovered-vector list names it. `gate-delegate`'s block message says it too.

Either way the product states the truth. Faking coverage here would be the same
failure as `ErrUnloadableGuidance`: heroic engineering on the delivery side,
none on the compliance side.

---

## 8. `/nodd-models`

A deterministic handler registered with `pi.registerCommand("nodd-models", …)`
(`extensions.md:1498-1511`; names collide with numeric suffixes, so NODD owns
its own name). Adapted from `zero-models.ts`, not imported.

- Displays all **seven** canonical steps in order. `authorize`, `classify`,
  `track`, `close` render `mecanismo · sin modelo` and reject assignment — they
  are comparators and file writers, not model calls. Showing them keeps the ODD
  protocol visible; giving them slots would be decoration.
- Configures five slots: `default`, `orchestrator`, `explore`,
  `resolve-uncertainty`, `implement`.
- Models come from `ctx.modelRegistry.getAll()`, grouped by provider, as in
  `zero-models.ts:505-525`. Assignment validation mirrors
  `zero-models.ts:411-460`: qualified `provider/model` accepted, unknown
  rejected, ambiguous bare id rejected with suggestions.
- Persists to `~/.pi/nodd.json` with a spread that preserves unrelated keys.
  `~/.pi/zero.json` is never opened — asserted by a source-scan test. Forge's
  phases stay `/zero-models`' business.
- The picker is a pure state machine in `src/models/picker.ts` (no fs, no pi),
  hosted by `ctx.ui.custom`. Quit writes nothing; save writes once.

---

## 9. Dynamic prompt, and the prose that stays prose

`before_agent_start` (`types.d.ts:525-535,806-810`) returns
`{ systemPrompt: incoming + block }` — chained, never replacing, so other
extensions' contributions survive. Two blocks, each budgeted:

- **Block A — state** (≤ 1500 chars): current step, enabled gates, what is
  missing now, escape-hatch syntax, disabled-gate and used-hatch notices.
- **Block B — forwarded prose** (≤ 2500 chars): only the `(P)` clauses of the
  parity matrix belonging to the current canonical step, from
  `src/odd-prose.ts`.

Block B is the honest part of the answer to "do we keep the useful parts of
ODD?". Roughly a third of ODD's surface is not mechanizable — proportionality
of exploration, whether a premise is high-consequence, whether a scope change
is a business decision, whether a read prepares a write. Those clauses are
good guidance and NODD keeps them, as guidance, labelled as guidance. What
NODD refuses to do is what gentle did: let prose stand in for a mechanism and
then call the result compliance.

The budgets are the ratchet-prevention mechanism. ODD pays ~10 KB even for
"what does this function do?", and it got there one clause at a time — the
`.refusal-ratchet-baseline.txt` at 105,993 bytes is the receipt. A renderer
without a hard number grows back into the wall. Block B is step-scoped, so the
`implement` turn never carries `explore` prose, and a test asserts it. If a
rule needs to say more than the budget allows, it is code, not a paragraph
(`PLAN.md` §9).

---

## 10. ODD parity: what is mechanism, what stays prose

`REQ: odd-parity-matrix` classifies all 56 clauses of `routing.go:40-120` as
**(M)** mechanized, **(P)** forwarded prose or **(F)** out of scope. The full
table lives in requirements and is reproduced in `README.md`. The design
consequences:

**Two tests keep the matrix honest.** One asserts every `(M)` row names a gate
or requirement that actually exists in the package — so the matrix cannot claim
a mechanism nobody built. One asserts the `(P)` corpus in `src/odd-prose.ts`
has an entry per `(P)` row — so a clause cannot be quietly dropped by calling
it prose. Without those two, the matrix is just more prose about prose.

**Delivery strategy** (`routing.go:103`) splits three ways rather than being
faked as one mechanism. The **record** is (M): a `## Delivery` section in the
feature doc holding strategy (`ask-on-risk` default | `auto-chain` |
`single-pr` | `exception-ok`), chain (`stacked-to-main` | `feature-branch-chain`),
forecast, running count and slice boundaries, cached so both choices are asked
once. The **running count** is (M) and measured: additions plus deletions
parsed from observed `git` diffstat output with a documented generated-file
exclusion list; unparseable output leaves the count `unknown` rather than
guessed — same fail-closed rule as the command outcomes. The **asking** is (P),
because asking is conversation. The **execution** is (F): `/zero-branch` and
`/zero-pr` already do it, and NODD never pushes, opens or merges — ODD itself
says those stay the user's (`routing.go:50`). Crucially the 400-line crossing
**never blocks**; turning a stated planning heuristic into a gate would violate
the very clause it comes from.

**The line heuristic** (`routing.go:95`) is (P) for the same reason, and a test
over the gate registry asserts no gate consults a line count — the guarantee is
structural, not a promise. The anti-gaming sentence travels with it (never
strip blank lines or comments for cosmetic savings, never minify, never omit
tests, never split artificially) and is forwarded into the generated NODD agent
bodies, so a child does not optimize for a number the parent is only
estimating with.

**Review candidate** (`routing.go:51`,`:102`): a work-unit commit or a PR
slice, never a checkbox and never the accumulated branch. Checking a box
records the observed commit SHA, or `candidate: pending-commit` — never the
checkbox itself. Slice candidates carry an explicit (base, head) boundary pair,
the first base being the branch point. This is the same principle as the
evidence gate: the artifact records what was observed, not what was ticked.

**Change acceptance** (`routing.go:97`): completed and unrelated work is
preserved (a rewrite that would drop a finished task is refused, naming it);
reopening a `[x]` requires a recorded reason; findings never expand scope on
their own, mechanized as "an observed `subagent` result can never mutate the
declared intent or route — only `nodd_declare` can"; business-scope judgement
stays (P); and checkboxes grant nothing, enforced by evidence lookups keying on
ledger records only.

**Preparation trigger** (`routing.go:81`) is (P) and stays (P). A `read` event
carries a path and nothing else; whether it prepares a write lives in the
model's intent, which the API never exposes. Any mechanism here would guess,
and a gate that guesses about intent blocks correct work. A test asserts no
gate id contains `prepar` and no gate consults read-intent — the absence is
verified, so nobody can later believe the mechanism exists. What NODD does
instead is bound the consequence: the 4-file mapping trigger fires whatever the
reason for the reads. That is a weaker guarantee, and it is stated as one.

**Read-back** (`routing.go:98`): writes are not atomic, so every NODD artifact
write is read back and verified; a mismatch preserves the previous file and
reports the limitation instead of claiming success. A divergent on-disk doc
produces `feature.md` plus `feature.conflict-<ts>.md` — both versions survive,
and the user is asked about the real conflict only. The Engram half of the
clause is (F).

**No SDD artifacts off-route** (`routing.go:71`,`:84`): routes `inline` and
`tracked` never write under `.sdd/`. The promotion converter is the only code
path that does, asserted by a source scan, and a firing gate creates no
artifact at all — it only blocks.

---

## 11. Deliberate divergence: NODD escalates, ODD does not

`routing.go:68` — "File count, changed lines, size, or perceived risk alone
never selects SDD and never forces a heavier route." NODD escalates to forge.
This is a conscious divergence and requirements states it as one.

What ODD is banning is *model judgement about magnitude* as a routing input:
"this feels big", "this looks risky", "that is a lot of files". **NODD bans
exactly the same thing.** No threshold on size, line count or perceived risk
selects forge; `gate-promotion` reads none of them, and a test asserts it.

The three triggers NODD adds are observations, not estimates:

1. **Two consecutive non-`success` outcomes on one task.** Not "this is big" —
   the code changed twice and the measured result did not move. That is a
   planning defect, and planning is what forge does.
2. **A task wrote more distinct files than it declared.** Not a size threshold:
   3-observed-against-2-declared trips it, 40-against-40 does not. It means the
   scope was misunderstood when it was declared.
3. **The user asked** — which ODD already allows (`routing.go:67`).

The gap between what ODD forbids and what NODD does is the gap between an
estimate and a measurement. And ODD's prohibition has a cause worth naming:
in gentle, escalating means restarting inside an 11-phase artifact system
behind a SHA-pinned binary. "Size, ambiguity, or risk alone never selects SDD"
is, as `PLAN.md` §4 puts it, a price signal wearing a design principle's
costume. In NODD the transition is one file — promotion writes
`requirements.md`, forge resumes at `plan`, finished work arrives as context.
The cost that justified the ban is not there, so the ban does not transfer.

---

## Constitution / Steering check

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | No `.sdd/constitution.md`, `.sdd/steering.md` or `.kiro/steering/*` in the repo |
| Scope matches product/tech constraints | pass | Scope is `PLAN.md` §6 phases 1–5 + `/nodd-models`, exactly as fixed in `clarifications.md`; Phase 0 stays a non-goal of code |
| No forbidden dependency or workflow change | pass | Zero edits to `zero-pi`; no `pi-tui` import; no compile pipeline; pi as peerDependency; gentle-ai read-only reference only |

## Notes on the plan inputs

`.sdd/nodd/findings.md` was **absent from disk** when this phase started. It was
restored from the zero-explore subagent run log at
`/tmp/pi-subagents-uid-1000/async-subagent-runs/dccbf345-5b05-4c63-9fdf-82b90754e637/`
and every load-bearing citation in this design was re-verified against the live
sources (`bash.js:321-350`, `bash.d.ts:14-17`, `types.d.ts:649-691,779-787`,
`extensions.md:757-758`, `orchestrator.md:102-105`,
`pi-subagents/src/extension/index.ts:672,716`). The restored file carries a
header saying where it came from.
