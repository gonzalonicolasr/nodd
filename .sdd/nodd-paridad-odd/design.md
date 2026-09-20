# Design — nodd-paridad-odd

## Code roots

Carried forward from `.sdd/nodd-paridad-odd/findings.md`:

- `/home/gon/projects/nodd/src/bash-classifier.ts` — the mutation denylist (M4)
- `/home/gon/projects/nodd/src/bash-classifier.test.ts` — table test + README drift test
- `/home/gon/projects/nodd/src/gates/` — `authorize.ts`, `classify.ts`, `track.ts`,
  `delegate.ts`, `evidence.ts`, `promotion.ts`, `policy.ts`, `registry.ts`, `request.ts`
- `/home/gon/projects/nodd/src/ledger.ts` — the append-only observation record (M9)
- `/home/gon/projects/nodd/extensions/nodd-kernel.ts` — runtime, `checkCall` at `:345-368`
- `/home/gon/projects/nodd/test/` — `readme-contract.test.ts`, `parity-matrix.test.ts`,
  `gate-reachability.test.ts`, `package-invariants.test.ts`
- `/home/gon/projects/nodd/README.md` — the tested contract
- `/home/gon/projects/nodd/.sdd/nodd/requirements.md` — prior run's REQs + parity matrix

**Unavailable:** `/tmp/gentle-ai` does not exist in this environment. No ODD
clause is cited in this plan except through `.sdd/nodd/requirements.md`, which
carries its own verified `routing.go` line numbers at commit `d4187c1d99…`.

---

## A. M4 — where interpreter coverage starts and stops

### The pattern added

One new row at the end of `COVERED_PATTERNS`, in the file's existing style:

- **label:** `` an interpreter running a script file as its first argument (`node script.js`, `bash script.sh`) ``
- **example:** `node script.js`
- **test:** a single regex, no I/O, no state:

```
(^|[;&|])\s*(sudo\s+)?(node|deno|bun|python3?|ruby|perl|bash|sh|zsh)\b\s+(?!-)\S*(\.(js|cjs|mjs|ts|mts|cts|py|sh|bash|rb|pl)|/)
```

Three decisions are load-bearing and each was validated empirically against 35
commands before this plan was written:

1. **`\b` after the interpreter name.** Without it, `shellcheck script.sh`,
   `nodemon server.js` and `python3-config --includes` all match. With it, all
   three are `non-mutating`. Verified.

2. **`(?!-)` — only the *first* argument is examined.** This is the answer to
   the hard half of decision A: *where does coverage stop?* The tempting
   implementation skips flags to find the first non-flag token. It must not be
   used, because `node --test test/parity-matrix.test.ts` — this repository's
   own way of running a single test file — would then classify as a write and
   break the suite and the workflow. Requiring the script to be the immediate
   first argument is the conservative line that keeps every flag-carrying
   invocation (`node --test`, `node --version`,
   `node --experimental-strip-types x.ts`, `python3 -m pytest`,
   `bash -lc 'grep x'`) out of the gate. The cost — flags-then-script is not
   covered — is published in `NOT_COVERED` rather than hidden.

3. **Extension-or-slash, not bare tokens.** `deno task build`, `bun test` and
   `bun run build.js`'s subcommand form stay `non-mutating` because `task`,
   `test` and `run` are neither path-like nor script-suffixed. Only something
   that *looks like a file* trips the pattern.

### Verified behaviour (run before planning, 35 commands)

Classified **mutating**: `node script.js`, `python3 file.py`, `bash script.sh`,
`sh ./run.sh`, `node ./bin/cli.mjs`, `python3 manage.py migrate`,
`ls && node build.js`, `sudo bash install.sh`, `ruby rakefile.rb`,
`perl script.pl`.

Classified **non-mutating** (the ones a wrong gate would break — this is the
list the delegator asked to be verified, and it includes `node --test`,
`npm test` and `git status`): `node --test`,
`node --test --experimental-strip-types`,
`node --test test/parity-matrix.test.ts`, `node --version`, `npm test`,
`npm test 2>&1 | tail -5`, `git status`, `git log --oneline -5`, `git diff`,
`TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test`, `python3 -m pytest`,
`python3 -m http.server`, `bash -lc 'grep x'`, `bun test`, `deno task build`,
`shellcheck script.sh`, `nodemon server.js`, `python3-config --includes`,
`cat package.json`, `grep -rn 'a>b' src`, `./run.sh`, `cat gen.py | python3`,
`rg pattern --files-with-matches`, `wc -l src/*.ts`, `echo hello`,
`find . -name '*.ts'`.

### What moves into NOT_COVERED, and why both tables stay true

`NOT_COVERED` today says *"a script or build target that writes: `./build.sh`,
`make`, `npm run build`"*. After this change that sentence is no longer precise,
because `bash build.sh` **is** now covered while `./build.sh` is not. It is
rewritten and two entries are added, so the published boundary matches the code
exactly:

- replace with: ``a script run without naming an interpreter, or a build target: `./build.sh`, `make`, `npm run build` ``
- add: ``an interpreter whose script is not its first argument, or a script passed as a string: `node --flag s.js`, `bash -lc '…'` ``
- add: ``a script piped into an interpreter: `cat gen.py | python3` ``

The existing test `the not-covered list … names scripts and indirect writers`
requires the words `script`, `make`, `compiler`, `eval`, `background` and
`outside pi` to survive — the rewrite keeps all six.

Because `src/bash-classifier.test.ts` asserts `section.includes(entry.label)`
for every covered row **and** every not-covered item, the README tables and the
code cannot drift: changing `COVERED_PATTERNS` without editing README turns the
suite red. This is why the classifier change and the README edit are **one
task** — splitting them would leave the tree red between tasks.

### Honesty about the over-approximation

`node server.js` may only read. The command string cannot say. The bash-gate
section gains one sentence stating that this row over-approximates and why, so
the README does not imply a precision the pattern lacks. The existing
"claims no guarantee it cannot keep" test still forbids *guarantees*,
*exhaustive* and *all writes* in that section; the new sentence uses none.

### The prior run's REQ text

`.sdd/nodd/requirements.md`'s `REQ: bash-mutation-classifier` enumerates the
covered set in prose and ends with *"and inline interpreters (`node -e`,
`python -c`)"*. Left alone it would describe a boundary the code no longer has —
the precise failure mode this product exists to refuse. Three lines are added
there in the same task.

---

## B. CHANGELOG — format and content

**Format:** *Keep a Changelog* 1.1.0, newest first, `## [x.y.z] - YYYY-MM-DD`,
grouped under `### Added` / `### Fixed` / `### Changed`. No `[Unreleased]`
section (nothing unreleased at plan time). No link refs — there is no public
commit host configured, and inventing one would be a dead link.

**Correction to the brief, accepted by the delegator:** there are **12**
releases, not 9. `0.1.0` was never published. Verified:
`git log --pretty='%h %ad %s' | grep release` → 12 results, 0.2.0 … 0.6.2.

The content is derived, not invented — each entry is the commit range between
the previous `chore: release` and its own. The mapping, already computed:

| version | date | commit range content |
| --- | --- | --- |
| 0.2.0 | 2026-09-19 | first published release: state kernel, the six gates, bash classifier, evidence ledger, feature docs, model slots/picker/profiles, agent provisioning, `/nodd-promote` |
| 0.2.1 | 2026-09-19 | `9006fa0` gates read `file_path`, the field pi's write tool actually sends |
| 0.2.2 | 2026-09-19 | `2a6f112` docs: how to choose models and when the choice takes effect |
| 0.3.0 | 2026-09-19 | `0427cd8` policy is injected and re-read, not a startup global |
| 0.3.1 | 2026-09-19 | `d259ccf` the picker opens on the profiles that are saved |
| 0.4.0 | 2026-09-19 | `2d2a83f` two framed panels, providers browsable by prefix |
| 0.4.1 | 2026-09-19 | `21036b9` browse the providers you have, stop doubling the prefix |
| 0.5.0 | 2026-09-19 | `b29f12a` the footer says NODD is on |
| 0.5.1 | 2026-09-19 | `01aac97` register `execute`; `44ec72f` a redirect into `/dev/null` is not a write; `8ac835a` let the declared feature document be created |
| 0.6.0 | 2026-09-19 | **user-config migration** (`1791e22`, `27dd261`): the inert `orchestrator` slot is removed and existing `~/.pi/nodd.json` is migrated to `default` on load, backup taken first. Also: refused calls no longer count as observed effects (`c9bf2f2`, `c16872c`), read-only may delegate to a read-only worker (`a24b1cf`), reachable remedies for classify/delegate/promotion (`ef76a18`, `f7f32ac`, `20023f4`), reachability held as a class (`ecf980c`) |
| 0.6.1 | 2026-09-20 | `7836573` task counter in the footer; `e39c9dc` abandoned calls cleared at the turn boundary; `75604a7` reachability driven by real refusals; `cbfb533` state comment corrected |
| 0.6.2 | 2026-09-20 | `6eb3715` kill switch works on a fresh machine; `8f7e98b` `/nodd-allow` reaches the kernel; `403db70` `--nodd-off` turns gates off; `7d33854` say when the config could not be read |

**Why it is testable rather than decorative.** Two assertions in
`test/package-invariants.test.ts`: the newest heading equals
`package.json.version`, and `CHANGELOG.md` is in `package.json.files`. The first
makes the next release fail the suite if the changelog is skipped; the second
makes it actually reach npm consumers. A test that merely asserted the file
exists would be the "a word in prose is not documentation" mistake this project
already corrected once (`92b8ade`).

---

## C. `firstRefusal` — delete, not wire

**Decision: delete the function and its test.**

The kernel's loop at `extensions/nodd-kernel.ts:345-368` is not a reimplementation
of `firstRefusal`; it does strictly more, and the difference is behavioural:

1. It evaluates gates **lazily** — each gate is a thunk, and evaluation stops at
   the first refusal. `firstRefusal(decisions: GateDecision[])` takes an array,
   which means every gate has already run before the winner is picked.
2. On a refusal it **consumes a one-shot hatch for that specific gate**
   (`consumeHatch(policy, gate)`), and on success it mutates `policy`, calls
   `spendHatch(gate)` and returns `null` — *continuing past* a refusal that was
   pardoned. `firstRefusal` returns the first refusal unconditionally and has no
   way to express "this one was pardoned, keep going".
3. It carries the gate id alongside the decision, which the hatch lookup needs.

Wiring `firstRefusal` in would therefore require either running all gates
eagerly (losing laziness) or restructuring it to take gate ids and a hatch
callback — at which point it is the kernel loop with extra indirection. A
helper that cannot express the behaviour its only candidate caller needs is not
a shared abstraction; it is a second, weaker definition of the same rule sitting
where someone will eventually use it by mistake. Deleting it leaves
first-refusal-wins defined exactly once.

Risk: none measurable. `grep -rn "firstRefusal" --include=*.ts .` shows exactly
two sites, `policy.ts:68` (the definition) and `policy.test.ts:63-65` (the
test). Verification is the grep returning empty plus the full suite green.

---

## D. `gate-classify` blocks the SDD planning phase — decided, not deferred

**The finding, reproduced in this run.** Writing `proposal.md` was refused:

```
nodd/classify: no route has been declared for this session, and write would be
the first change. To proceed: call `nodd_declare` … or, if that tool is
unavailable, report this back to the delegator so it can declare one.
```

A delegated worker has no `nodd_declare` and no slash commands. The delegator
confirmed the structural reason: kernel state is **per session**, rebuilt by
`replay()` over that session's own entries, so a declaration made in the parent
is invisible to the child.

The delegator asked for an explicit choice between (i) exempting `.sdd/**` from
`gate-classify` and (ii) an inheritable declaration. **Both are rejected, and
the disclosure in §E is adopted instead.** The reasoning:

**(i) A `.sdd/**` exemption is backwards on ODD's own terms.** ODD `:71` and
`:84`, carried as `REQ: no-sdd-artifacts-off-route`
(`.sdd/nodd/requirements.md:995-1007`), require that direct and delegated work
*never* create SDD artifacts off-route — `.sdd/` is the one directory ODD
singles out for **more** control, not less. Exempting it would make the single
most-restricted path the only unguarded one, and would hand every agent a
one-line universal evasion: write to `.sdd/` first, and `gate-classify` never
fires again for that session. The comparison to `gate-track`'s emergency door
does not hold: that door is narrow along three axes at once — only this slug's
own `feature.md`, only while it is absent, only for the declared slug — and it
exists because that gate blocked the repair of its own cause. `gate-classify`
does not block its own repair; its second remedy is reachable, and it worked.

**(ii) An inheritable declaration converts observed fact into ambient
authority.** For a child kernel to inherit a route, the declaration must be
persisted and re-read from disk. That is a declaration the child's own session
never observed — precisely the "evidence NODD did not observe" failure the whole
product refuses, and the same class of error as the forged-feature-doc risk
`gate-track` exists to prevent. It is also unlocked cross-process state, i.e.
the M9 limitation being documented three metres away in this same plan. And it
would often have nothing to inherit into: `NOT_COVERED` already records that
pi-subagents starts children with `--no-extensions` in the documented path, so
there is frequently no child kernel at all.

**What is true instead:** the gate behaved correctly. Its refusal named a remedy
reachable by an actor with no tools; the delegator acted on it; the work
proceeded. That is `test/gate-reachability.test.ts`'s invariant holding in
production, observed rather than asserted. The real defect is that this cost —
one delegator round-trip per delegated writer — is **undisclosed**. That is a
README gap, and it is closed in §E with a test that pins the behaviour, not the
sentence.

---

## E. M9 and the delegation boundary — two honest limitations

Both land as bullets in README *Known limitations* (line ~425), matching the
seven existing bullets in tone: state the limit, name the file, promise nothing.

**Concurrency (M9).** Draft:

> **Two sessions in one repo can lose observations.** NODD has no cross-process
> coordination of any kind. `appendRecord` (`src/ledger.ts`) reads
> `.nodd/<slug>/state.json`, appends, and writes the whole file back; two pi
> sessions interleaving that sequence leave only the second session's record.
> There is no lock, no queue and no retry, and none is planned — coordinating
> across processes is a design problem, not a patch. Run one NODD session per
> repository. Pinned by a test that interleaves two appends and asserts the loss.

**Delegated declaration.** Draft:

> **A delegated worker cannot declare its own route.** `nodd_declare` is a
> kernel tool and kernel state is per session, so a subagent starts with no
> declaration and no way to make one — its first write is refused by
> `gate-classify`. The refusal's second remedy, reporting back to the delegator,
> needs no tool and is always reachable, so this is not a dead end; but it costs
> one delegator round-trip per delegated writer. Exempting a directory or
> persisting a declaration for children to inherit were both considered and
> rejected — see the note on ambient authority above.

**Why these are tests, not sentences.** The project already learned (`92b8ade`,
`75604a7`) that asserting a word appears in prose proves nothing. Each bullet is
backed by a test of the *underlying fact*:

- M9: drive two interleaved `appendRecord` calls through the injectable `Fs`
  (`src/ledger.ts` takes `fs: Fs = nodeFs`) and assert a record is lost. If
  anyone adds locking, this test turns red and forces the README to be
  corrected — the sentence cannot outlive the fact.
- Delegation: drive `classifyGate(emptyCommitted(), write, emptyPolicy(), new Map())`
  — literally the state a fresh child kernel has — assert it refuses, and assert
  the remedy matches the `UNIVERSAL_REMEDY` pattern already defined in
  `test/gate-reachability.test.ts`. If someone makes the gate self-declarable,
  the test turns red.

---

## Non-goals, restated

`/nodd-help`; any locking mechanism; any change to the (P) rows; B2; any change
to `~/.pi/nodd.json`; any new gate, command or dependency.

## Constitution / Steering check

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | No `.sdd/constitution.md`, `.sdd/steering.md`, `.sdd/config.json` or `.kiro/` found |
| Scope matches product/tech constraints | pass | — |
| No forbidden dependency or workflow change | pass | No `@earendil-works/pi-tui` import, no build step, no runtime dependency, `fold()` untouched |
| Tests run with isolated HOME | pass | Every `evidence:` uses `TMPH=$(mktemp -d) && HOME=$TMPH …` |
| `~/.pi/nodd.json` not modified | pass | No task writes it; the CHANGELOG only *describes* the 0.6.0 migration |
