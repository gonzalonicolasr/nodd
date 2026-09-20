# Proposal — ODD phases and subagents: close the gap to ~90%

## What this run changes

NODD already mechanizes the seven ODD phases and the three ODD delegation
roles. This run does **not** port new phases. The parity work on phases and
subagents is essentially done; what is missing is that several of those
mechanisms do not do what the product says they do.

This run closes five verified defects. All five were found by *running* the
product in its own repository during this session — not by reading it. The
baseline of 497 green tests covers none of them.

### D1 — Refused writes are recorded as real writes (the worst one)

`src/state.ts:124` records a path into `filesWritten` without consulting
`obs.isError`:

```ts
if (WRITE_TOOLS.has(obs.toolName) && path) next.filesWritten.set(path, { at: obs.at, seq: next.toolCalls });
```

Three lines below, `commandResults` *does* store `isError`. The asymmetry is
visible inside one function.

Reproduced by the supervisor independently:
`fold(empty, observation({toolName:"write", input:{file_path:"/tmp/jamas-existio.txt"}, isError:true}))`
yields `filesWritten: ['/tmp/jamas-existio.txt']` while `existsSync` is `false`.

Observed live in this session: three consecutive **refused** writes (zero files
created, confirmed by `ls`) drove `gate-delegate` from "2 distinct files" to "3
distinct files". The defect is **self-amplifying** — each refusal increments the
counter that causes the next refusal — so once the writer threshold of 2 is
crossed, every future write in that session is blocked with no exit.

Blast radius is three gates, not one: `gate-delegate` (writer trigger),
`gate-promotion` (`observedFiles` vs `declaredFiles`, so fabricated divergence)
and `gate-evidence` (`lastWrite()` seq moves forward on a write that never
happened, invalidating legitimate evidence).

This inverts the product's governing principle. The other four defects promise
more than the mechanism delivers; **this one enforces on fabricated evidence**,
blocking correct work while citing files that do not exist. The user has no way
to know the premise is false.

### D2 — `close` and `resolve-uncertainty` prose is never forwarded

`currentStep()` (`src/prompt.ts:62-68`) has no branch returning `close` or
`resolve-uncertainty`. The 621 characters of `resolve-uncertainty` prose and 119
of `close` prose sit in the corpus, are counted by `src/odd-prose.test.ts` as
forwarded, and reach no turn. Parity-matrix rows 6, 32, 34, 35, 36 and 49 claim
a forwarding that does not occur — the exact sin NODD indicts ODD for,
committed inside NODD.

### D3 — `gate-authorize` blocks ODD's mandated read-only delegation

`src/gates/authorize.ts:24` blocks *every* `subagent` call under
`intent: read-only`. ODD `:44` forbids delegating a **writer**; ODD `:70` and
`:92` *require* a read-only exploration/research worker to stay available. Today
`intent: read-only` makes `nodd-explore` — NODD's own read-only agent —
unreachable, so the gate forbids the delegation path ODD makes mandatory.

### D4 — Refusals whose remedy is unreachable from a subagent

`gate-classify` prints "call `nodd_declare` … or `/nodd-allow classify`". A
subagent has neither: `nodd_declare` is not in its toolset and slash commands do
not exist there. `src/gates/track.ts:41-50` already documents this exact class
and ships an emergency door for it; `classify` has the same defect without the
fix. Encountered live: it blocked every write of this planning run.

### D5 — The `orchestrator` slot is inert

`/nodd-models` offers it and the user's `~/.pi/nodd.json` assigns it in **all 10
profiles**, yet no code reads it. `grep -rn orchestrator` over `src/` and
`extensions/` returns only `slots.ts:23`, `manifest.ts:55` and tests. No
`nodd-orchestrator` agent exists. The picker promises a slot with no consumer.

## Scope

In scope: the state reducer's write accounting, the step router that selects
prose, the authorize/delegation distinction, the unreachable-remedy class across
all six gates, the slot surface and its migration, and the README claims
covering each.

Out of scope, deliberately: the ~20 `rdd-*` / `persona` / `engram` / `gga`
specs. Per mid-run steering they are *analysed* — see `design.md` § "Inventory:
analysed, not implemented in this run" — but none enters `tasks.md`. Also out of
scope: new phases, new agents, `existsSync` verification inside `fold()`, and
any write to `~/.pi/agent/settings.json`.

## Rationale for the `orchestrator` decision

**Give it real effect** would require writing the parent process model into
`~/.pi/agent/settings.json`, verified as the only place pi resolves a parent
model from (`pi-subagents/docs/models.md` precedence chain). That is a second
config-writing surface, in a file NODD does not own, to steer a process NODD
does not launch. Rejected.

**Remove it** is the honest exit — but not the naive removal explore proposed,
which would silently discard a real assignment from all 10 profiles. Removal is
paired with an **idempotent migration**: the slot leaves `CONFIGURABLE_SLOTS`,
and a one-time reconciler rewrites `orchestrator` → `default` only where
`default` is unset, writing nothing when there is nothing to migrate. That is
the semantics the user was reaching for anyway, since `default` is the real
fallback all three agents already read (`extensions/nodd-agents.ts:160`).

`default` stays — it is **not** inert — and is relabelled so the picker states
what it does.

## The "better things", as mechanism

- Read-only delegation is allowed by **capability**, never by a hardcoded list
  of NODD agent names: a read-only worker passes, a writer under
  `intent: read-only` does not.
- `close` and `resolve-uncertainty` become reachable, so prose the matrix
  already claims is forwarded actually is.
- Every gate gains an auditable invariant (design.md § "The deadlock class"):
  a refusal must offer at least one remedy executable by its recipient, and must
  never worsen the state that caused it.

## Prose budget

No prose entries are added. Measured per step today: `implement` 758,
`resolve-uncertainty` 621, `explore` 496, `track` 285, `classify` 128, `close`
119, `authorize` 99 — all inside the 2500-character block B budget. Block A is
unchanged. **Nothing is cut.**

## Session note

Gates `track`, `classify`, `delegate`, `evidence` and `promotion` are currently
disabled in `~/.pi/nodd.json` (backup: `~/.pi/nodd.json.bak-odd-run`) so this
planning run could write at all. **They must be re-enabled when the run
closes.**
