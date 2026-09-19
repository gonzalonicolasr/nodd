# NODD

**N**on-negotiable **O**rganic **D**riven **D**evelopment — the ODD protocol as
runtime mechanism for pi instead of injected prose: blocking gates fed by real
tool events, evidence read from observed tool results, and promotion of NODD
artifacts into `/forge` artifacts.

ODD's failure was promising compliance while shipping delivery. This file is
where NODD refuses to repeat it: everything below states what is mechanized,
what is only advice, and what is not carried at all.

`test/readme-contract.test.ts` holds part of that line mechanically: it fails if
the README names a gate, a module or a command that does not exist, drops a
canonical step, quotes a matrix total that disagrees with the matrix, or lets
the bash, enforcement-scope, resume and kill-switch sections stop stating their
limits. It does **not** parse English: a newly written sentence promising more
than the code does will not turn it red. Prose added next to a fix is therefore
the known way this document can drift ahead of the product, and the defence is
review, not the suite. Round 3 found three such sentences and closed them.

## Install

```bash
pi install npm:@gonrocca/nodd
```

Global installation is the path enforcement is verified on. A pi-subagent child
process does its own ambient discovery and finds installed packages, so gates
also run inside delegated work — see **Enforcement scope** for what that does
and does not cover. `pi -e npm:@gonrocca/nodd` runs the package for one session
without installing it, and in that mode children do **not** load it: the parent
is gated and delegated work is not.

Install into one project instead of the whole account with `-l`, which writes
`.pi/settings.json`. Remove with `pi remove npm:@gonrocca/nodd`.

Nothing is configured after install: every gate is on, the flags are documented
under **Flags, the kill switch and the escape hatch**, and model slots keep
pi's defaults until `/nodd-models` is run.

## Using it

NODD runs on its own. A normal session looks like this:

**Read-only work stays read-only.** Ask a question and nothing changes. Declare
intent `read-only` and a write is refused by `gate-authorize`.

**Substantial work is declared before the first write.** The agent calls
`nodd_declare` with the slug, the route, the files and — this is the part worth
caring about — the `runner`: the command a checkoff will be measured against.

```
nodd_declare  slug: dark-mode  title: "Dark mode"  summary: "Theme the editor"
              intent: change  route: tracked
              runner: "npm test"  tdd: strict  files: [src/theme.ts]
→ .nodd/dark-mode/feature.md created with 0 tasks
```

Until that file exists, the first write is refused. The refusal says what to do
about it.

**Tasks are checked off with observed runs, not with claims.** `nodd_task` marks
an item done only when `gate-evidence` finds four facts lined up: a success, of
the declared runner, after the task's last write, with a RED before it under
strict TDD. A model writing "all tests pass" changes nothing — the evidence line
in the document is rendered from the observed tool result, never from prose.

**When a gate is wrong, turn it off.** `/nodd-gates off track` disables it
entirely and stays disabled; `/nodd-allow track` grants exactly one override.
Neither is argued with.

**When the work outgrows NODD, promote it.** `/nodd-promote dark-mode` writes
`.sdd/dark-mode/requirements.md` and `/forge --continue dark-mode` starts at its
plan phase with the finished work as context.

To watch it work on something disposable, run `pi` in an empty git repo and ask
for a two-file change: the declaration is demanded before the first write, and
the first checkoff without a real test run is refused.

## The seven canonical steps

`authorize` → `explore` → `resolve-uncertainty` → `classify` → `track` →
`implement` → `close`.

Four of them — `authorize`, `classify`, `track` and `close` — are **mechanism
steps**: they run no model and cannot be assigned one. `/nodd-models` shows them
as `mecanismo · sin modelo` and refuses an assignment. The other three are the
steps where a model actually does work.

## The gates

| gate | fires on | refuses when |
| --- | --- | --- |
| `gate-authorize` | writes, mutating bash, delegation | intent was declared `read-only` |
| `gate-classify` | the first write | nothing was declared at all |
| `gate-track` | the first source write on a `tracked`/`forge` route | no feature doc exists yet |
| `gate-delegate` | writes and mutating bash | the mapping, writer or long-session threshold fired and nothing was delegated |
| `gate-evidence` | checking a task off | the declared runner was not observed succeeding after the task's last write |
| `gate-promotion` | writes | the work diverged from what was declared |

Every refusal names what was observed, the action that unblocks it, and a
one-shot `/nodd-allow <gate>` escape hatch. A gate that blocks without naming
the exit is a dead end, so `src/gates/policy.ts` makes the remedy a required
field rather than an encouraged one.

## The bash gate

`write` and `edit` are typed tool calls, so NODD gates them exactly. A bash call
arrives as a command *string* — pi's `tool_call` event carries no model of what
the shell will touch — so bash is gated by a denylist of mutation patterns.

A denylist is a partial mechanism. What it covers and what it does not are
published together, here, and both lists are generated from the classifier's own
pattern set (`src/bash-classifier.ts`) and asserted against by
`src/bash-classifier.test.ts`, so the table and the code cannot drift apart.

### Covered

| pattern | example |
| --- | --- |
| output redirection (`>`, `>>`), excluding fd-only forms like `2>&1` | `echo hi > f.txt` |
| `tee` | `ls \| tee out.txt` |
| in-place editors (`sed -i`, `perl -i`) | `sed -i 's/a/b/' f.ts` |
| movers and removers (`mv`, `cp`, `rm`, `rmdir`, `ln`, `install`, `dd`, `truncate`, `touch`, `mkdir`) | `rm -rf build` |
| permission changes (`chmod`, `chown`) | `chmod +x run.sh` |
| `patch` | `patch -p1 < fix.diff` |
| mutating `git` subcommands (`apply`, `checkout`, `restore`, `reset`, `commit`, `stash`, `clean`, `mv`, `rm`) | `git commit -m 'x'` |
| package installers (`npm`/`pnpm`/`yarn`/`pip`/`cargo` install or add) | `npm install lodash` |
| inline interpreters (`node -e`, `python -c`) | `node -e "require('fs').writeFileSync('f','x')"` |

### Not covered

These mutation vectors reach the filesystem without this classifier noticing:

- a script or build target that writes: `./build.sh`, `make`, `npm run build`
- compilers, formatters and codegen writing as a side effect
- redirection hidden behind a variable or `eval`
- a pre-existing background process
- writes performed by other extensions' or MCP tools
- writes performed outside pi entirely
- a delegated child launched with its own `extensions:` list, which pi-subagents starts with `--no-extensions`

A partial gate that says which half it holds is worth more than a total one that
is not.

## Enforcement scope

**Where NODD's gates run:** in the process that loaded them, and in delegated
pi-subagent children. This was measured, not assumed
(`spike/subagent-enforcement/RESULT.md`, pi 0.84.2, 2026-09-19): when NODD is
installed as a pi package — the documented install path — a child process
launched by pi-subagents performs its own ambient extension discovery, finds
NODD, and the child's `write` was blocked by the child's own copy of the gate.
Enforcement scope is therefore "parent and delegated children".

Children also inherit the parent's working directory, so they read and write the
same `.nodd/<slug>/` artifacts. `gate-track` transfers through the file, not
merely per call.

**Four vectors this does not cover:**

1. **An agent definition with its own `extensions:` list.** That sets
   `disableAmbientExtensions` and pi-subagents launches the child with
   `--no-extensions`; NODD is absent from that child unless listed explicitly.
   An agent file NODD did not author can opt out of NODD. NODD's own generated
   agents deliberately declare no `extensions:` line, and a test enforces it.
2. **A capability ceiling with `denyExtensions`** has the same effect.
3. **Grandchildren were never probed.** Only depth 1 was measured. Nothing here
   claims anything about a child's child.
4. **Session state is not shared.** Each process folds its own observations; a
   child does not see the parent's in-memory counters.

Also: this is a behaviour of how pi-subagents builds the child's argv, not a
documented API guarantee. It can change on upgrade.

### Counters are per-process, and there is no session total

This is the correct semantics rather than a gap, but it must be stated plainly.
The mapping, writer and long-session triggers exist to keep *one process's
context* thin enough to orchestrate. A child runs in its own process with its
own context window, so a child that reads four files has filled *its* context,
not the parent's — and it is the child that should then delegate.

What does not exist is an **aggregate whole-session total across parent and
children**. NODD does not claim one. What it has is a per-process count plus a
shared on-disk artifact.

### What actually satisfies a checkoff

An observed exit-0 is not enough. `gate-evidence` requires four facts to line
up, because a green command proves something only about *which* command ran and
*when*:

1. **A success**, parsed from the observed tool result (`src/outcome.ts`).
2. **The declared runner.** `nodd_declare` records a `runner` into the feature
   doc's `## Verification` section, and only runs of that command count.
   `npm test -- one.test.ts` counts; `echo "all tests pass"` does not, and
   neither does any other command that merely mentions the runner. A pinned
   runner cannot be re-pinned: re-declaring with a different one is refused, so
   a refused checkoff cannot be repaired by renaming the check to whatever did
   pass.
3. **After the task's last write.** A run observed before the edit it supposedly
   verifies proves nothing about the edit. Ordering uses the kernel's
   observation sequence rather than the wall clock, because a write and the run
   after it routinely land in the same millisecond.
4. **A RED first, under strict TDD**, when the declaration set `tdd: strict`.
   `tdd: strict` without a runner is refused at declaration, because a RED run
   is a failing run *of the declared runner*: accepting it would write
   `- tdd: strict` into the document while checking nothing. Strict is pinned
   the same way the runner is: once set, re-declaring without it is refused, so
   the discipline cannot be dropped after the work by leaving one field out.

The honest limit: **the model still chooses the runner.** NODD cannot know what
the right check for your project is. What it enforces is that the choice is made
up front, in a durable artifact, before the work — so the command the work is
judged by cannot be invented afterwards to fit whatever happened to pass.

Declaring no runner at all is still allowed, and then fact 2 cannot be checked.
It is skipped rather than faked, and the evidence line itself discloses it:
`observed: <cmd> → success (runner not pinned)`. That caveat appears only on
an unpinned checkoff, so a reader auditing the artifact can tell a run certified
by the declared runner from one certified by whatever exited 0. What NODD does
**not** do on that path is refuse: with nothing pinned there is nothing to
compare against, so an unpinned feature buys disclosure, not enforcement.

### Resume: prior evidence comes back as `unverified`

When you resume a feature in a new session, the previous session's evidence is
**not** enough to check a task off. The check has to be re-run.

This is expected behaviour, and the reason is one line: evidence means "observed
by the kernel", and a fresh process has observed nothing yet. It is fail-closed
on purpose. You will meet it as friction; it is not a bug.

Two outcomes that look similar and are not:

- **`unverified`** — NODD has no observation of this command in this process.
  Nothing contradicts it; it simply was not seen here.
- **`mismatch`** — NODD *does* have an observation and it contradicts what the
  ledger claims. That is a different and more serious failure, and it reads
  differently in the refusal.

The evidence ledger is distinct from the feature document. Editing the ledger
from outside degrades its entries rather than being silently accepted, and a
degraded entry counts as no evidence at all.

## Command outcomes

A command's outcome is parsed from the observed tool result
(`src/outcome.ts`), from the last non-empty line only — a runner that prints
"Command exited with code 0" in its own stdout must not thereby rewrite its own
verdict.

| outcome | meaning | satisfies evidence |
| --- | --- | --- |
| `success` | the tool reported no error | **yes** |
| `exit <code>` | the command exited non-zero | no |
| `aborted` | the command was aborted | no |
| `timeout <n>s` | the command timed out | no |
| `unknown` | the result could not be parsed | **no — fail closed** |

`unknown` not counting is the whole rule. An unparseable result is an
unobserved result, and treating it as success is exactly how a protocol starts
certifying work nobody checked.

## Flags, the kill switch and the escape hatch

| control | effect |
| --- | --- |
| `--nodd-off=<gate>` | turns that gate off for the session |
| `--nodd-off=all` | turns every gate off |
| `gates.<id>.enabled: false` in `~/.pi/nodd.json` | turns that gate off persistently |
| `/nodd-allow <gate>` | one-shot override for the next call only |
| `/nodd-gates status` | read-only: effective mode and deciding source per gate |

The semantics are inherited verbatim from ODD's own kill switch:

- **Off means off, entirely.** When you ask NODD to stop, it stops. It does not
  argue, does not work around it, does not propose an alternative first, and
  does not re-enable itself later.
- **Off is not a fault to diagnose.** A disabled gate is a user decision, not a
  broken state, and nothing in the prompt suggests turning it back on.
- **A disabled gate reports `disabled`, never a fabricated approval.** With
  `gates.evidence` off, a task records `observed: none (gate disabled)` — never
  a claim that something was verified.
- `status` reports the deciding source; `default` means nobody chose.

Turning off `track` is also the documented way to hand-edit a feature document.

## Deliberate divergence from ODD

ODD selects the SDD route by predicted magnitude (`routing.go:68`: file count,
changed lines, size, perceived risk). **NODD diverges here deliberately.**
`gate-promotion` reads no size, no line count and no risk score. Its triggers
are observables only, and there are exactly two: two consecutive non-success
outcomes of the runner the task declared, and a task writing more distinct
files than it declared.

A third trigger, "the user asked", was specified and removed. `/nodd-promote`
performs the promotion itself and holds no kernel state, so no gate can observe
the asking and still have something useful to do about it — blocking a write to
suggest the command you just ran is circular. It shipped once as a hardcoded
`false`, which is precisely the overclaim this gate exists to prevent, so it is
gone from the type and the docs rather than left looking operational.

A big task that succeeds is not divergent. A three-line task that fails twice
is. A source-scan test rejects every size-flavoured identifier in the promotion
path, so this divergence cannot quietly decay back into a threshold.

The ~400-line figure survives only as **advice** (see the matrix below), never
as a gate.

## The M/P/F parity matrix

Every clause of ODD's guidance surface is classified as exactly one of:

- **(M)** mechanized — a gate or module enforces it;
- **(P)** forwarded prose — kept as injected text, with a stated reason why it
  cannot be mechanized;
- **(F)** out of scope — not carried, with a stated reason.

The full row-by-row matrix lives in `.sdd/nodd/requirements.md` under
`REQ: odd-parity-matrix`. Its `(P)` rows are implemented as data in
`src/odd-prose.ts` — one entry per row, tagged with the canonical step it
belongs to — and a test asserts the two stay in correspondence.

**A `(P)` reason may never be "we did not get to it."** A clause with no stated
obstacle is a mechanism someone skipped, and a test rejects that wording.

The two most load-bearing `(P)` clauses:

- **The preparation trigger** (`routing.go:81`). Reading that prepares a write
  should be delegated too — but intent-to-write is not visible in a read event.
  NODD ships no `prepare` gate, and a test asserts no gate id contains `prepar`:
  a mechanism here would have to guess intent, and a gate that guesses is worse
  than prose that admits it.
- **The ~400-line advisory** (`routing.go:95`), with its full anti-gaming
  sentence. A line count measures typing, not correctness. Mechanizing it would
  make the number an objective to optimize against — which is exactly what the
  clause forbids. A test asserts no gate consults a line count.

### Not carried from ODD

| clause | why not |
| --- | --- |
| Engram/Cortex memory mirror | out of scope by decision; NODD's durable truth is `.nodd/<slug>/` on disk |
| `gentle-ai review assess` tiers, consent ceremony, preflight STATUS | depends on the `gentle-ai` binary, which is deliberately not copied. A test asserts no code path invokes it. NODD's analogue is forge's `veredicto` phase |
| push / PR creation / merge | these remain the user's decisions. No gate and no tool in NODD pushes, opens a PR or merges, and a test asserts no code path runs them |

## The prompt budget

NODD injects two blocks per turn: block A (the session state) and block B (the
forwarded prose for the current step only). They are capped at **1500** and
**2500** characters. The budget is asserted against the *corpus* — the text
before any truncation — so adding a clause that does not fit turns the test red
instead of silently pushing an existing clause out. If a block does overflow at
runtime it is cut, and the cut announces itself inside the block and in the
rendered result's `overBudget` list, never silently.

The cap is the mechanism. gentle's guidance surface reached 105,993 bytes one
individually-defensible clause at a time: no single addition was wrong, the sum
was. Adding a clause that does not fit is therefore a decision to shorten
another one — the conversation that never happened in gentle.

Turning every gate off collapses block A to a single line, but block B still
forwards the step's prose. Turning enforcement off is not a request to stop
being useful.

## Commands

| command | does |
| --- | --- |
| `/nodd-gates [status\|on\|off] [<gate>]` | inspect and set gate flags |
| `/nodd-allow <gate>` | grant a one-shot override |
| `/nodd-models [<slot>=<provider>/<model>\|profile …]` | assign models per slot; no argument opens the picker |
| `/nodd-promote <slug>` | hand a feature to `/forge` |

`/nodd-promote` writes exactly one file, `.sdd/<slug>/requirements.md`, and
deliberately emits no `design.md` and no `tasks.md` so forge's resume lands on
`no-plan` and restarts at its plan phase. It refuses to overwrite an existing
`requirements.md`, and it is the only module in the package permitted to write
under `.sdd/` — a test scans every other source file to keep it that way.

Forge is an optional dependency. When it is absent, the artifact is still
written and the exact command to run by hand is reported.

## Known limitations

These are open, not fixed. They are here because a declared problem is a result
and a hidden one makes everything above worthless.

- **An unpinned feature is not enforced, only disclosed.** `runner` is optional
  at declaration. Omit it and fact 2 cannot be checked, so any observed exit-0
  after the write can check a task off. The evidence line says
  `success (runner not pinned)` so the artifact never passes it off as a
  certified run, but the checkoff does happen. Pin a runner to get enforcement.
- **`isDeclaredRunner` matches whole tokens by prefix, so a flag that redirects
  the working directory passes.** `npm test --prefix /tmp` is accepted as a run
  of `npm test`; the gate cannot tell a flag that narrows scope from one that
  moves it elsewhere. It requires the model to pin a runner and then invoke it
  with a redirecting flag.
- **`readLedger` reports defects that no production caller reads.** A corrupt
  ledger is treated as empty, which is fail-closed for evidence (nothing to
  support a checkoff) but the corruption itself is not surfaced to the user.
- **No test parses the English in this file.** See the note at the top: the
  README contract checks names, sections and totals, not whether a sentence
  promises more than the code delivers.
- **Enforcement in grandchildren was never measured.** Only depth 1 was probed;
  see *Enforcement scope*.
