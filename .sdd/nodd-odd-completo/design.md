# Design — nodd-odd-completo

## Code roots

- **NODD (the product being modified):** `/home/gon/projects/nodd`
  - `src/state.ts` — the reducer; `fold()` is where D1 lives (line 124)
  - `src/prompt.ts` — `currentStep()` (lines 62-68), the block A/B renderers and
    the budgets (`BLOCK_A_BUDGET` 1500, `BLOCK_B_BUDGET` 2500)
  - `src/gates/` — `authorize.ts`, `classify.ts`, `track.ts`, `delegate.ts`,
    `evidence.ts`, `promotion.ts`, plus `registry.ts`, `policy.ts`, `request.ts`
  - `src/models/` — `slots.ts`, `picker.ts`, `assign.ts`, `profiles.ts`,
    `thinking.ts`, `layout.ts`
  - `src/manifest.ts` — `THRESHOLDS`, `CANONICAL_STEPS`, `MECHANISM_STEPS`,
    `CONFIGURABLE_SLOTS`
  - `src/odd-prose.ts` — the forwarded-prose corpus, one entry per (P) row
  - `src/config.ts` — `~/.pi/nodd.json` parsing and merging (pure)
  - `extensions/` — `nodd-kernel.ts` (gate evaluation, tool registration,
    `lastWrite()`, promotion signals), `nodd-agents.ts` (agent provisioning,
    `modelFor` at :160), `nodd-models.ts`, `nodd-gates.ts`, `nodd-allow.ts`,
    `nodd-promote.ts`
  - `test/` — `parity-matrix.test.ts`, `readme-contract.test.ts`,
    `package-invariants.test.ts`
  - `README.md` — every claim is contract-tested
- **ODD source (read-only checkout, never modified):** `/tmp/gentle-ai`
  - `internal/components/agentguidance/routing.go` — the 52-`WriteString` engine
  - `internal/agents/capabilitymanifest/manifest.go:203-216` — canonical
    thresholds
  - `openspec/specs/organic-agent-trigger-rules/spec.md` — canonical routing spec
- **pi runtime (verification only):**
  `/home/gon/.pi/agent/npm/node_modules/pi-subagents` — the real subagent
  mechanism; `src/extension/index.ts:672` defines the `subagent` tool,
  `docs/models.md` holds the model precedence chain.

## Constraints carried into the build

- TypeScript ESM, **no build step**. Tests: `node --test --experimental-strip-types`.
- Always run with an isolated HOME:
  `TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test`.
- Baseline: **497 tests, 497 passing** (re-verified this session). No regressions.
- Importing `@earendil-works/pi-tui` is forbidden, including `import type`.
- Adapt, never import from zero-pi.
- Every gate keeps its escape hatch (`/nodd-allow <gate>`) and its individual
  off flag (`resolveFlag`).
- Prose budget is hard: block A 1500, block B 2500 characters.
- Never touch `~/.pi/nodd.json` without a backup.
- Method: RED test first → fix → **mutation check** (neutralize the mechanism,
  watch tests die). A test that survives the mutation proves nothing.
- Commits: Conventional, no AI attribution, `git commit -- <paths>`, never
  `--amend`.

## Session state to restore

`track`, `classify`, `delegate`, `evidence` and `promotion` are disabled in
`~/.pi/nodd.json` so this planning run could write. Backup:
`~/.pi/nodd.json.bak-odd-run`. **Re-enable all five when the run closes.** The
build phase should expect them off and must not interpret that as the shipped
default.

## The deadlock class

Three defects in this repository share one shape: **a gate can trap an agent
with no reachable exit.**

| # | gate | how it traps | status |
|---|---|---|---|
| 1 | `track` | refused every write until the feature doc existed, while the only tool that could create it was broken | **fixed** — narrow emergency door, `src/gates/track.ts:41-50` |
| 2 | `classify` | tells the caller to run `nodd_declare` or `/nodd-allow`; a subagent has neither | **open** — D4 |
| 3 | `delegate` | counts refused writes, so each refusal raises the counter causing the next; past threshold 2 the session can never write again | **open** — D1, root cause |

These are not three unrelated bugs. The invariant that would have caught all
three:

> **Gate reachability invariant.** Every refusal must offer at least one remedy
> executable by the actor that received it, and no refusal may worsen the state
> that caused the refusal.

The first clause fails when a remedy names a capability the recipient lacks
(tools and slash commands differ between a parent session and a subagent). The
second fails when the refusal path feeds its own trigger — a *monotonic trap*,
strictly worse, because it converts a recoverable block into a permanent one.

`REQ: gate-refusal-reachability` makes this auditable across all six gates so
`veredicto` can re-run the audit rather than re-derive it.

## D1 — write accounting: the counter-semantics rule

The fix is four words of condition, but the reasoning must be recorded or it
will be "fixed" backwards later.

Each counter in `fold()` answers a different question:

| field | models | should a **refused** call count? |
|---|---|---|
| `toolCalls` | session **activity** — how long has this run gone without delegating | **yes.** The long-session backstop measures effort spent. `nodd-kernel.ts:613-615` is right about this. |
| `filesWritten` | **workspace state** — which files this session changed | **no.** A refused write touched no disk. |
| `filesRead` | context accumulated | **no** — a failed read loaded nothing into context |
| `delegations` | whether delegation happened | **no** — a failed `subagent` delegated nothing |
| `commandResults` | observed outcomes | **yes, with its flag** — already stores `isError`; `src/outcome.ts` owns the vocabulary and evidence depends on failures being visible |

`commandResults` is the precedent: it keeps `isError` three lines below the
write recording that ignores it. The build applies the same discipline to
`filesWritten`, and should audit `filesRead` and `delegations` in the same task
— both currently record unconditionally, and both are wrong for the same reason,
though neither produced an observed lockout.

**`fold()` stays pure.** No `existsSync`, no `node:fs`. A non-error tool result
is the best evidence available at that layer; adding I/O would trade a fully
testable reducer for an untestable one. A source scan pins this.

Blast radius to re-verify after the fix: `src/gates/delegate.ts:35`
(`writtenFiles`), `extensions/nodd-kernel.ts:495-496` and `:540` (promotion
signals and `lastWrite`).

## D2 — making the router total

`currentStep()` is a chain of five returns over `committed`. Two steps own prose
and are unreachable. The selection rules must derive from observed state only:

- **`resolve-uncertainty`** — reachable when the session has delegated to a
  read-only worker and has not yet declared a change intent. That is the
  observable shape of "research is in flight": `delegations > 0` with no
  `change` declaration. It must be checked before the `explore` branch, which
  currently absorbs every read-only declared state.
- **`close`** — reachable when the declared work is done: a declaration exists,
  files were written, and the feature document's tasks are all checked with
  evidence. The kernel already computes checkoff state, so this reads existing
  data rather than introducing a new signal.

Both rules are heuristics over observed state, exactly like the existing five,
and neither guesses intent. If the build finds the `close` signal is not
reachable from `Committed` alone without adding I/O to a pure module, it should
narrow `close` to the simplest observable rule available and record the
limitation, rather than widening the module's dependencies.

Budget: block B is rendered per step, and the largest corpus is `implement` at
758 characters against 2500. Making two more steps reachable costs nothing.

## D3 — capability, not names

`gate-authorize` must distinguish a read-only worker from a writer. The rule
reads the **target agent's declared tools**, which is what NODD itself writes
into every generated frontmatter (`tools: read, grep, ls, bash` for
`nodd-explore`; `… write, edit, bash` for `nodd-implement`).

Design constraints:
- No literal NODD agent name in `src/gates/authorize.ts` — pinned by a test.
  A name list misclassifies user-defined agents and breaks on rename.
- Resolution needs the agent definition, which lives on disk under
  `~/.pi/agent/agents/`. The gate module is pure, so the **lookup is injected**
  by the kernel exactly as `trackGate` already receives `docExists(slug)`. That
  pattern exists; follow it rather than inventing a second one.
- **Unknown capability refuses.** Under an explicit read-only declaration, an
  unresolvable target is refused with a message saying the capability could not
  be determined. Failing open here would let a rename silently reopen the writer
  path the gate exists to close.

## D5 + migration — slots

Removal is mechanical: drop `orchestrator` from `GLOBAL_SLOTS`
(`src/models/slots.ts:23`) and `CONFIGURABLE_SLOTS` (`src/manifest.ts:55`), and
relabel the `default` row as the fallback.

The migration is the risky half, because it edits the file holding the user's 10
profiles.

- Runs on extension load, before agent provisioning reads models.
- Pure transform in `src/models/profiles.ts` (or a sibling); the extension does
  the I/O. This keeps it testable against a fixture of the real 10-profile file.
- Rule: for the loose config and each profile, if `orchestrator` is set and
  `default` is unset, move the value; if both are set, drop `orchestrator`; if
  neither, do nothing. Apply the same rule to the parallel `thinking` map.
- **Writes only when something changed.** A no-op migration performs no write
  and creates no backup — otherwise every session start rewrites the user's
  config, which is its own defect.
- A timestamped backup precedes the first mutating write.
- Malformed config: leave untouched, report. Never partially rewrite.

`CONFIGURABLE_SLOTS` becomes `default, explore, resolve-uncertainty, implement`.
A new test asserts every remaining id has a real consumer, so the next inert
slot fails on arrival instead of shipping.

## Steering / constitution check

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | No `.sdd/constitution.md`, `.sdd/steering.md` or `.kiro/steering/*` found; `.sdd/config.json` absent |
| Scope matches product/tech constraints | pass | ESM, no build step, no new dependency, no pi-tui import |
| No forbidden dependency or workflow change | pass | No import of `@earendil-works/pi-tui` or zero-pi; no write to `~/.pi/agent/settings.json`; `fold()` stays free of `node:fs` |
| TDD shape | pass | Every task pairs a production file with its test file; `tdd.mode` is unset, so Strict TDD applies |
| Prose budget respected | pass | No corpus entry added; largest per-step block B is 758/2500 |

---

# Inventory: analysed, not implemented in this run

Per mid-run steering: the `rdd-*`, `persona`, `engram` and `gga` specs are now in
scope for **analysis**, not for implementation. Nothing below appears in
`tasks.md`, none of it consumes prose budget, and none of it is approved. This is
a map for a later decision, with evidence.

Swept: all 28 spec directories under `/tmp/gentle-ai/openspec/specs/`.

## Worth having on the table

| # | item | where | why NODD might want it | mechanism or prose? |
|---|---|---|---|---|
| I1 | **Kill switch consulted before authority is read** — "the hook MUST report no active review context without letting a missing, stale, ambiguous, or corrupted authority read alter that status" | `rdd-receipt-only-gates/spec.md:27-44` | NODD's gates read config then decide. This inverts it: check the switch *first*, so a corrupted state file can never produce a block when the user already said off. Directly relevant to the deadlock class — a damaged `.nodd/` must not be able to trap a session. | **Mechanism.** Small: reorder `resolveFlag` ahead of state reads in each gate, plus a test with a corrupted feature doc. |
| I2 | **Six prohibited actions during evaluation** — evaluation must not start review, create authority, consume budget, invalidate a receipt, create a lineage, or compose an unrelated graph | `rdd-receipt-only-gates/spec.md:45-62` | This is the general form of the invariant D1 violated. NODD's version: *a gate evaluation must have no side effects on the state it evaluates.* A source-scan test over the six gates would catch the next D1 before it ships. | **Mechanism.** A purity audit test. Cheap and high value. |
| I3 | **Read-only resolution is a total function of relation × hook** | `rdd-receipt-only-gates/spec.md:109` | Same shape as D2: a router that cannot reach a state is an incomplete function. Generalizes "every step with prose is reachable" into "gate decisions are total over their input space". | **Mechanism**, as a test-shape discipline. |
| I4 | **Advisory-only shadow evaluation** — run a new rule in parallel, record agreement/divergence, never block | `rdd-shadow-evaluation/spec.md:9-48` | The missing tool for shipping a *new gate* safely. A proposed gate could run in shadow for a while and report what it would have blocked, instead of the current all-or-nothing. Would have exposed D1's false positives immediately. | **Mechanism.** The larger item here, but it is the honest way to add future gates. |
| I5 | **Divergence records never persist to production state** | `rdd-shadow-evaluation/spec.md:49-59` | If I4 is ever built: shadow output goes to test/bench output, never into `.nodd/`. Keeps observation from becoming authority. | **Mechanism**, a constraint on I4. |
| I6 | **Every integrity result carries repair guidance** | `rdd-receipt-only-gates/spec.md:63-80` | NODD already does this well (`remedy` is non-optional on refusal, `policy.ts`). ODD states it as a requirement; worth citing as convergent evidence that the design is right. | Already mechanized. **No action.** |
| I7 | **Interaction discipline: one question, then stop; no option menus without a real tradeoff; verify before agreeing** | `persona-behavior-contract/spec.md:25-57` | Sharper than ODD `:45`, which NODD already forwards as row 4. "Verify before agreeing or correcting a user claim" is a genuinely useful clause NODD does not carry. | **Prose only** — judgement about natural language. Would cost ~120 chars in block A/authorize. Not free; needs a budget decision. |
| I8 | **Artifact language independence** — persona governs chat replies; generated artifacts default to English | `persona-behavior-contract/spec.md:58-76` | NODD's own surface is mixed: gate refusals are Spanish, agent bodies English. A stated rule would end the drift. | **Prose/convention**, or a lint test over refusal strings. |
| I9 | **Claim → source mapping, with contradictions and freshness recorded separately from product choices** | `sdd-research/spec.md:25-40` | Sharpens `nodd-resolve-uncertainty`'s body. NODD already forwards "attribute every claim to a URL or code location" (row 34); the *structure* (claims separate from choices, contradictions explicit) is more than that. | **Prose**, in the agent body. Does not touch block A/B budget — agent files are not the injected corpus. |
| I10 | **Idempotent injection and clean uninstall across upgrades** | `engram-protocol-injection/spec.md:77-96` | NODD writes three agent files on every load and has no uninstall. An upgrade leaving stale `nodd-*.md` files behind is a real scenario, and `orchestrator`'s removal is exactly this problem in miniature. | **Mechanism.** Worth considering independently of the rest. |
| I11 | **Golden fixture coverage per adapter** | `engram-protocol-injection/spec.md:97-111` | NODD tests `buildAgentFile` output but has no golden file: frontmatter drift would pass silently. | **Mechanism.** Cheap. |
| I12 | **Characterization tests precede removal** | `rdd-delivery-exception-removal/spec.md:31-40` | Directly applicable to this run's `orchestrator` removal: pin current behaviour *before* deleting, so the delta is visible. `tasks.md` T007 follows this without citing it. | **Mechanism**, already being applied. |

## Deliberately not worth it

| item | where | why not |
|---|---|---|
| The RDD review lifecycle as a whole — authority store, lineages, receipts, freeze/expansion, disposition plans, relation algebra (~15 specs) | `rdd-authority-*`, `rdd-candidate-*`, `rdd-closure-*`, `rdd-leaf-*`, `rdd-new-lineage-*`, `rdd-review-core-transitions`, `rdd-sdd-receipt-consumption`, `rdd-backlog-*`, `rdd-ownership-*` | An entire second product: a receipt-based review authority system with its own state machine and persistence. NODD's analogue is forge's `veredicto`, already declared **(F)** out of scope in `REQ: odd-parity-out-of-scope` row 48. Porting it would duplicate forge and multiply NODD's state surface. |
| `gga` — PowerShell shim, Windows install step | `gga/spec.md` | Platform installer concern. NODD is an npm package; pi owns installation. |
| `antigravity-support`, `installer-picker-navigation` | those dirs | Adapter/installer specifics of the gentle binary. `installer-picker-navigation` was checked for picker UX ideas — it is about *installer* flow, not model selection. |
| `sdd-orchestrator-assets`, most of `sdd-research` | those dirs | SDD lifecycle. NODD reaches SDD by promotion to forge; re-implementing is the duplication `PLAN.md` §9 refuses. |
| `review-findings-ledger` | `review-findings-ledger/spec.md` | 255 lines of review-transaction machinery (freeze, correction transactions, Judgment Day replacement, terminal receipts). Same reason as the RDD block. |
| `persona-behavior-contract` adapter-specific halves (Claude/Kimi output styles, fingerprint continuity, drift reconciliation) | `persona-behavior-contract/spec.md:77-298` | Multi-runtime persona injection — precisely the 11-variant sprawl `PLAN.md` §7 refuses. Only I7/I8 are runtime-neutral. |

## Items that may be better than something currently in `tasks.md`

Flagged as required, but **the scope decision is the user's, not mine** —
nothing here changed `tasks.md`.

- **I2 (no side effects during gate evaluation) is arguably a better framing of
  T001.** T001 fixes `filesWritten` specifically. I2 would add a purity audit
  across all six gates, catching the *next* instance of the same class rather
  than this one. My recommendation: keep T001 as-is (it fixes an active lockout
  and must land now), and consider I2 as a follow-up hardening task. They are
  complementary, not alternatives.
- **I4 (shadow evaluation) is a better way to ship any future gate** than this
  project's current practice of enabling a gate on by default and discovering
  false positives in production — which is exactly how D1 stayed hidden behind
  497 green tests. It changes no task in this run, but it is the strongest
  process idea in the swept corpus.
- **I1 (check the kill switch before reading state)** would have limited D1's
  blast radius: with `delegate` disabled, a corrupted counter could not block.
  Small enough to fold into this run if the user wants it; I did not add it,
  because it widens scope beyond the five agreed defects.
