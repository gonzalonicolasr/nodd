# Proposal — NODD parity with ODD: close the real gaps

## The request, and why it is answered differently than asked

Verbatim: *"fijate que cosas le falta de odd a nodd para estar ok y ser mejor
mejora los puntos que encuentres"*.

The explore phase measured the 56-row ODD parity matrix
(`.sdd/nodd/requirements.md:633-882`) row by row and found the obvious reading
of the request — *"the 11 (P) rows are the missing work"* — is wrong. Each (P)
row is irreducible judgement over natural language ("is this intent ambiguous?",
"is this exploration proportionate?"), each already carries an explicit reason,
and `test/parity-matrix.test.ts` already refuses any (P) row whose justification
defers instead of explaining. Mechanizing them would mean guessing intent from
tool events — the exact sin NODD exists to refuse. **They are not debt; they are
the correct result, and it already lives in the code.**

Explore also found that B1 (gate-reachability breadth) and most of M8 were
already closed by the previous run `.sdd/nodd-odd-completo` (commits `ecf980c`,
`75604a7`, `a24b1cf`, `ef76a18`). What remains is small and concrete.

## What this run changes

One real enforcement defect, four pieces of honesty debt.

1. **The bash classifier's undocumented blind spot (M4).** Reproduced in
   explore: `node script.js`, `python3 file.py` and `bash script.sh` all
   classify `non-mutating` and slip past every gate.
   `src/bash-classifier.ts:44-53` knows only the *inline* forms (`node -e`,
   `python -c`). This differs in kind from `./run.sh`, which is honestly listed
   in `NOT_COVERED`: the interpreter-plus-script form is in **neither** list, so
   the README's published coverage boundary is silently untrue, and it is the
   first evasion any agent reaches for once `node -e` is blocked. This is the
   only item that is a defect rather than a gap.

2. **No CHANGELOG.** `git log` shows 12 `chore: release` commits — 0.2.0 through
   0.6.2. (This corrects the brief's "9 releases": `0.1.0` was never published.)
   One of them, 0.6.0, **rewrites the user's `~/.pi/nodd.json` on load**
   (`migrateOrchestratorSlot`, commits `1791e22`, `27dd261`). A package that
   edits user config across a version boundary and publishes no changelog is
   asking the user to trust prose.

3. **Concurrency has no mechanism and no disclosure (M9).** Two pi sessions in
   one repo append to the same `.nodd/<slug>/state.json` through an unlocked
   read-modify-write (`src/ledger.ts:64-74`). There is no locking anywhere in
   `src/` or `extensions/`. Cross-process locking is a design problem, not a
   fix; the honest move is the one NODD already makes seven times in *Known
   limitations* — declare it, and pin the declaration to a test that proves the
   loss is real.

4. **A delegated writer cannot declare its own route.** Found by running into
   it: this very planning phase was refused by `gate-classify`, because a
   delegated subagent has neither `nodd_declare` in its toolset nor slash
   commands. The gate behaved exactly as designed — its second remedy ("report
   this back to the delegator") is reachable without any tool, and it worked —
   but the cost is one delegator round-trip per delegated writer, and the README
   never says so. Disclosure, not mechanism (see `design.md` §D for why neither
   a `.sdd/**` exemption nor an inheritable declaration is acceptable).

5. **`firstRefusal` is dead, duplicated code.** `src/gates/policy.ts:68` has no
   production caller; the kernel implements first-refusal-wins inline at
   `extensions/nodd-kernel.ts:345-368`.

## What this run deliberately does **not** change

- **The (P) rows.** Touching them would be a regression in honesty.
- **`/nodd-help` (M6).** The first refusal an agent meets already self-explains
  with concrete syntax (measured this run, verbatim: `nodd/classify: no route
  has been declared … call nodd_declare with an explicit intent and route
  (inline, tracked or forge) …`). A help command would restate it.
- **A locking mechanism for M9.** Cross-process coordination is not a
  documentation-sized change and was not asked for.
- **B2 (`turn_end` missed on process death).** Explore confirmed pending state
  is in-memory only and dies with the process that held it. Nothing to clean up.
- **A `.sdd/**` carve-out in `gate-classify`.** Rejected on ODD grounds; see
  `design.md` §D.

## On "ser mejor" — the honest answer

NODD is already better than ODD wherever a mechanism is possible: 44 of 56
clauses became blocking gates, observed-evidence checks or counters, against
ODD's injected prose that shipped with no budget at all. The README states this
in *Deliberate divergence from ODD* and the M/P/F matrix, and
`test/parity-matrix.test.ts` refuses an (M) row naming a mechanism that is not
on disk. **No speculative feature is invented here.** The one place NODD was
genuinely worse than its own published claim is item 1: a gate whose
documentation asserted a coverage boundary that was not where the code put it.
Closing that hole *and publishing the new boundary in the same change* is what
"being better" means for this product.

## Scope and budget

One behavioural code fix, one deletion, three documentation artifacts — matching
the budget explore proposed, plus the one item the delegator explicitly added to
scope (item 4). No new dependency, no new command, no new gate, no change to
`fold()` purity, no `@earendil-works/pi-tui` import.
