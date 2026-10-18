# NODD — reference

The operating detail. The [README](../README.md) is the entry point; this file
holds what you need once NODD is running: exactly where enforcement reaches,
what the bash classifier covers, how to turn things off, and what NODD does not
do.

## Choosing models

`/nodd-models` with no argument opens a picker: profiles, then slots, then the
providers and models of pi's live registry, then a thinking level. Nothing is
written until `— guardar y salir —`; leaving with `q` writes nothing at all.

A **profile** is a named set of assignments — `rapido`, `barato`, whatever you
call it — and the picker can create, edit, duplicate, activate and delete them.
The active profile is what the generated agents read. Editing a slot while a
profile is active edits that profile, so the two never drift apart silently.

The slot and the level both reach the generated agent's frontmatter as `model:`
and `thinking:`. **Changes apply to the next pi session**, not the running one:
the agent files are rewritten from the config when the extension loads, which
happens at startup.

### The `orchestrator` slot was removed

Earlier versions let you assign a slot named `orchestrator`. Nothing read it:
the main session runs on the model you picked in pi, so an assignment there
looked like a choice and did nothing. It is gone from the picker.

Because the slot was assignable, real configs contain it. On load, NODD moves
`orchestrator` to `default` when `default` is unset, and drops it when both are
set. **It rewrites your profiles to do this**, since that is where the
assignments live: a profile holding `orchestrator` comes back holding `default`.
Every other slot, your active profile and the rest of the file are left alone.
The migration writes only when there is something to migrate, and takes a
timestamped backup of `~/.pi/nodd.json` before touching it.

The text forms do the same without the UI:

```bash
/nodd-models implement=anthropic/claude-opus-4-1
/nodd-models profile new rapido
/nodd-models profile use rapido
```

<p align="center">
  <img src="https://nodd.ceroclawd.com/img/fig2.jpg" alt="Grabado de 1893: la Corte de Honor de la Exposición Colombina, vista desde el edificio de administración" width="100%">
</p>

<p align="center">
  <sub><em>fig. 2 — del otro lado del gate · 1893</em></sub>
</p>

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
| formatters and linters that rewrite files (`eslint --fix`, `prettier --write`, `biome --write`, `ruff --fix`/`ruff format`, `black`, `isort`, `gofmt -w`, `cargo fmt`) | `npx eslint --fix src` |
| package installers (`npm`/`pnpm`/`yarn`/`pip`/`cargo` install or add) | `npm install lodash` |
| inline code for `node` or `python` (`-e`, `-c` or a heredoc) that can write: a write mode, a file or process API, `eval`/`exec` | `node -e "require('fs').writeFileSync('f','x')"` |
| an interpreter running a script file as its first argument (`node script.js`, `deno run main.ts`) | `node script.js` |
| a covered command behind a wrapper, an assignment or an absolute path (`env rm`, `timeout 5 rm`, `FOO=1 rm`, `/usr/bin/rm`) | `env rm -rf build` |
| downloaders, syncers and extractors that write files (`curl -o`/`-O`, `wget`, `rsync`, `tar -x`/`-c`, `unzip`, `find -delete`/`-exec rm`) and git commands that move history (`clone`, `pull`, `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `switch`) | `curl -o out.txt http://x` |

### Not covered

These mutation vectors reach the filesystem without this classifier noticing:

- a script run without naming an interpreter, or a build target: `./build.sh`, `make`, `npm run build`
- an interpreter whose script follows a bare flag, or is passed as a string: `node --import=./r.mjs app.js`, `bash -lc '…'` (flags after `run` *are* covered: `deno run --allow-write main.ts`)
- a script piped into an interpreter: `cat gen.py | python3`, or an argument NODD cannot see is a file: `node x` (no extension, no path)
- an interpreter reached through a variable or an alias: `I=node; $I x.js`
- a wrapper that names a command instead of running it: `command -v node`, `xargs -I node echo` (a wrapper that *runs* one is covered, whatever flags it carries)
- compilers, formatters and codegen writing as a side effect
- redirection hidden behind a variable or `eval`
- inline code that reaches a write through a name NODD does not list: `python3 -c "vars(sys.modules['o'+'s'])['rem'+'ove']('f')"`
- a pre-existing background process
- writes performed by other extensions' or MCP tools
- writes performed outside pi entirely
- a delegated child launched with its own `extensions:` list, which pi-subagents starts with `--no-extensions`

Several rows over-approximate on purpose. A command string cannot say what
`node server.js` will do, so a named script file is treated as a write even when it
only reads; and because a newline opens a command, the mover, permission, `tee`,
`patch` and installer rows read past the first line too. Data is excluded from all of
them — quoted strings, `#` comments and heredoc bodies — so searching for the word
`install`, or passing a script through `cat <<'EOF'`, is a read. The refusal carries its remedy and a one-shot escape hatch, so that cost
is bounded; an unnoticed write is not.

**What this gate is for.** It catches the write a model reaches for when it
takes the shortest way out after a refusal — the next obvious form, not the
next clever one. It does not catch a model determined to hide a write, and it
cannot: the surface of a Turing-complete shell does not close by enumeration.
Four review rounds on this list each found something, and the last one found a
newline. Treat the covered table as the floor, never as the boundary.

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
   **The exit status has to be the runner's own.** `npm test 2>&1 | tail -5`,
   `npm test || true`, `npm test; echo done` and `npm test &` all hand back
   another command's status, so a failing run reads as a success. Those runs
   count neither as evidence nor as failures. Redirects and `&&` keep the
   runner's status and are fine; to keep the output short, redirect it to a
   file and read the file with a second command.
3. **After the task's last write.** A run observed before the edit it supposedly
   verifies proves nothing about the edit. Ordering uses the kernel's
   observation sequence rather than the wall clock, because a write and the run
   after it routinely land in the same millisecond.
   A write through bash counts as a write too: a `sed -i`, a redirect or a
   codegen command run after the green run makes it stale, whatever file it
   touched, because NODD cannot tell which file a command wrote. Runs of the
   declared runner itself and `git commit`/`push`/`tag`/`add` do not count,
   since they leave the working tree's code as it was.
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

## The observed close

ODD asks the model to close with the outcome and the checks that failed, and
trusts it to. NODD computes the close from observations (`src/close-report.ts`)
and shows it after every request that wrote: in pi as a notification at
`agent_end`, in Claude Code beneath the answer.

The line is written in Spanish, like the rest of the author's tooling:

```
◆ NODD · auth · 2 archivos · `npm test` sin correr después de la última escritura
  ⚠ la respuesta afirma «listo», pero NODD no vio `npm test` completo y verde después de la última escritura
  ⚠ src/a.test.ts: se agregó .skip(
```

| it reports | from |
| --- | --- |
| the runner after the last write: green, partial (`npm test -- one.test.ts`), red with its code, exit status hidden, or not run | `commandResults` after the last `filesWritten` entry of this request |
| an answer claiming success with no full green run | the final assistant text |
| a test file edited between a red and a green run of the runner | write order against run order |
| `.skip`, `.only`, `xit`, `t.Skip`, `@pytest.mark.skip` added, assertions removed | the edit's old and new text |
| files written outside the declared `files` | the declared set against the written set |
| tests that vanished or got skipped: a green run passing fewer tests than an earlier green run of this request, or more skipped | the summary line of `node --test`, bun, jest, vitest, pytest, cargo and `go test -v` (`src/test-counts.ts`); no summary, no count |

A claim is flagged only when it is about tests ("pasan los tests", "suite verde",
"all tests pass", "veredicto: pasa"); a bare "done" is flagged only when a runner
was declared. Without a runner, any observed green test run after the last code
write backs the claim, `gh pr checks` included. When a run hid its exit status
(`| tail`, `; echo "exit=$?"`), the close reads it from the runner's summary or
the printed `$?` and says "green per the summary": the close is advice, so it
reads what the model read, while a checkoff still needs the real exit status.
Writes to docs, to Claude's own files or to the session scratchpad do not make a
green run stale, and a leading `cd … &&` is not part of the runner.

The warnings reach the model with the next request, so an unverified claim is
not left standing. The close never blocks: it reports. It covers the session
that wrote; a delegated child reports in its own process. Its language detection
is a list of patterns, so a claim phrased some other way, or a test file named
outside the usual conventions, goes unnoticed.

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

## Known limitations

These are open, not fixed. They are here because a declared problem is a result
and a hidden one makes everything above worthless.

- **Two sessions in one repo can lose observations.** NODD has no cross-process
  coordination of any kind. `appendRecord` (`src/ledger.ts`) reads
  `.nodd/<slug>/state.json`, appends, and writes the whole file back; two pi
  sessions interleaving that sequence leave only the second session's record,
  and no error is raised — the read-back guard compares the file against what
  *that* session wrote, so it cannot see a third party's change. There is no
  lock, no queue and no retry, and none is planned: coordinating across
  processes is a design problem, not a patch. Run one NODD session per
  repository. Pinned by a test that interleaves two appends and asserts the loss.
- **A delegated worker cannot declare its own route.** `nodd_declare` is a
  kernel tool and kernel state is per session, so a subagent starts with no
  declaration and no way to make one — its first write is refused by
  `gate-classify`. The refusal's second remedy, reporting back to the delegator,
  needs no tool and is always reachable, so this is not a dead end; but it costs
  one delegator round-trip per delegated writer. Measured: five consecutive
  subagents in one SDD run hit this. Exempting a directory or persisting a
  declaration for children to inherit were both considered and rejected —
  `.sdd/**` is the path ODD restricts most, and an inherited declaration would
  be authority the child's own session never observed.
- **There is no single switch that turns everything off.** `/nodd-gates disable
  <gate>` is per gate, so stopping NODD entirely means disabling all six. A
  global `all` flag exists in `resolveFlag` but nothing populates it, and
  `gates.all` in the config file does *not* work. To remove NODD completely,
  drop it from your pi config — the package owns no state outside
  `~/.pi/nodd.json` and the repo's `.nodd/`.
- **Only pi's builtin writers are gated.** Enforcement sees `write`, `edit` and
  `bash`. A write performed by any other tool — a filesystem MCP server, a tool
  from another harness — is invisible to every gate, because NODD classifies a
  call by the tool that makes it. If you run an MCP that writes files, NODD does
  not cover that path. Pinned in `src/gates/request.test.ts`.
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
