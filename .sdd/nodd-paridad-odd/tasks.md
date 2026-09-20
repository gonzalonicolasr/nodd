# Tasks — nodd-paridad-odd

Strict TDD applies (no `.sdd/config.json`, test runner present). Tasks marked
**TDD strict** require a RED test, run and observed failing *for the right
reason*, before any production edit. Verification is by **mutation**: revert the
production change, confirm the new test fails, restore.

Every `evidence:` command runs with an isolated HOME, per project rule.

---

### T001 — Cover an interpreter running a script file, and republish the boundary

- files:
  - `/home/gon/projects/nodd/src/bash-classifier.test.ts`
  - `/home/gon/projects/nodd/src/bash-classifier.ts`
  - `/home/gon/projects/nodd/README.md`
  - `/home/gon/projects/nodd/.sdd/nodd/requirements.md`
- detail: **TDD strict.** RED first: add to the `CASES` table the ten mutating
  commands and the fifteen non-mutating guards listed in
  `REQ: bash-interpreter-script-coverage`, plus a dedicated test named for the
  false-positive risk (`node --test test/x.test.ts` and `bash -lc 'grep x'`
  stay non-mutating). Confirm the ten new mutating cases fail and the guards
  pass — failing for the right reason, i.e. "should be mutating", not a syntax
  error. Then add exactly one row to the end of `COVERED_PATTERNS` using the
  regex in `design.md` §A; do not skip flags to find the script argument, the
  script must be the first argument. Rewrite the `./build.sh` entry of
  `NOT_COVERED` and add the two new entries verbatim from `design.md` §A,
  keeping the words `script`, `make`, `compiler`, `eval`, `background`,
  `outside pi` present. Update **both** README tables under `## The bash gate`
  to render the new label/example and the three not-covered lines exactly — the
  existing drift test compares them by `includes`, so a mismatch is red. Add one
  sentence to that section stating the row over-approximates (a script file is
  assumed to mutate because the command string does not say otherwise); do not
  use the words `guarantees`, `exhaustive` or `all writes`. Finally extend the
  covered-set enumeration in `REQ: bash-mutation-classifier`
  (`.sdd/nodd/requirements.md:243-260`) so the prior run's spec stops describing
  a boundary the code no longer has. README and classifier ship together on
  purpose: changing one without the other leaves the suite red.
- depends: []
- evidence: `TMPH=$(mktemp -d) && HOME=$TMPH node --test --experimental-strip-types src/bash-classifier.test.ts` passes; mutation check — delete the new `COVERED_PATTERNS` row and confirm the ten new mutating cases fail, then restore.
- review: ~160 changed lines

### T002 — Pin the concurrency limitation to a test, then disclose it

- files:
  - `/home/gon/projects/nodd/src/ledger.test.ts`
  - `/home/gon/projects/nodd/README.md`
- detail: **TDD strict.** RED first: a test that constructs two in-memory `Fs`
  views over one backing store and interleaves `appendRecord` — read A, read B,
  write A, write B — then asserts the ledger holds **one** record, not two,
  naming the lost one. It must fail first against an assertion of two records so
  the interleaving is proven to be doing what it claims, then be inverted to
  assert the loss. No production code changes: `src/ledger.ts` is not touched.
  Then add the *Known limitations* bullet from `design.md` §E, naming
  `src/ledger.ts`, `.nodd/<slug>/state.json` and "one NODD session per
  repository", promising no lock, queue or retry. The test is what keeps the
  bullet true: if locking is ever added the test turns red.
- depends: T001
- evidence: `TMPH=$(mktemp -d) && HOME=$TMPH node --test --experimental-strip-types src/ledger.test.ts` passes, and the new test is present in the output by name.
- review: ~60 changed lines

### T003 — Pin the delegated-declaration boundary, then disclose it

- files:
  - `/home/gon/projects/nodd/test/gate-reachability.test.ts`
  - `/home/gon/projects/nodd/README.md`
- detail: **TDD strict.** RED first: a test driving
  `classifyGate(emptyCommitted(), { toolName: "write", input: { path: "src/a.ts" } }, emptyPolicy(), new Map())`
  — the exact state a freshly started child kernel has — asserting the decision
  is a refusal **and** that `decision.remedy.action` matches the file's existing
  `UNIVERSAL_REMEDY` regex, i.e. an actor with neither `nodd_declare` nor slash
  commands can act on it. Verify RED by temporarily trimming the remedy's
  "report this back to the delegator" clause and confirming the new test fails;
  restore. This adds no production change — `src/gates/classify.ts` is not
  touched, because the gate is already correct (see `design.md` §D). Then add
  the *Known limitations* bullet from `design.md` §E, stating the per-worker
  delegator round-trip and recording that a `.sdd/**` exemption and an
  inheritable declaration were considered and rejected.
- depends: T002
- evidence: `TMPH=$(mktemp -d) && HOME=$TMPH node --test --experimental-strip-types test/gate-reachability.test.ts` passes; mutation check as described above.
- review: ~55 changed lines

### T004 [P] — Ship a CHANGELOG that a release cannot silently skip

- files:
  - `/home/gon/projects/nodd/CHANGELOG.md` (new)
  - `/home/gon/projects/nodd/package.json`
  - `/home/gon/projects/nodd/test/package-invariants.test.ts`
- detail: **TDD strict.** RED first: two assertions in
  `test/package-invariants.test.ts` — (a) `CHANGELOG.md`'s newest
  `## [x.y.z]` heading equals `package.json.version`, (b) `CHANGELOG.md` appears
  in `package.json.files`. Both must fail before the file exists, for the right
  reason (missing file / missing entry). Then write `CHANGELOG.md` in *Keep a
  Changelog* format, newest first, with the twelve entries and dates from the
  table in `design.md` §B, and add `"CHANGELOG.md"` to `package.json`'s `files`
  array. The `0.6.0` entry must contain `~/.pi/nodd.json` and the word `backup`
  and state that the `orchestrator` slot was removed and existing configs are
  migrated to `default` on load. Do not invent entries: every line traces to the
  commit range in the design table. Do not add an `[Unreleased]` section. `[P]`
  with T001-T003: disjoint files.
- depends: []
- evidence: `TMPH=$(mktemp -d) && HOME=$TMPH node --test --experimental-strip-types test/package-invariants.test.ts` passes; `git log --pretty=%s | grep -c "^chore: release"` returns `12`, matching the number of version headings.
- review: ~150 changed lines

### T005 [P] — Delete the dead `firstRefusal` helper

- files:
  - `/home/gon/projects/nodd/src/gates/policy.ts`
  - `/home/gon/projects/nodd/src/gates/policy.test.ts`
- detail: Pure deletion — **no RED test, triangulation skipped**, recorded here
  so the build phase does not invent one. Remove `firstRefusal` and its doc
  comment from `policy.ts`, and the assertions that exercise it from
  `policy.test.ts` (`:63-65`) together with its now-unused import. Do **not**
  touch `extensions/nodd-kernel.ts`: its inline loop is lazy, consumes a
  per-gate one-shot hatch and continues past a pardoned refusal — behaviour the
  helper's array signature cannot express (`design.md` §C). `[P]` with T001-T004:
  disjoint files.
- depends: []
- evidence: `grep -rn "firstRefusal" --include=*.ts . ` returns no results, and `TMPH=$(mktemp -d) && HOME=$TMPH node --test --experimental-strip-types src/gates/policy.test.ts` passes.
- review: ~25 changed lines

### T006 — Full-suite and contract verification

- files:
  - (none — verification only)
- detail: No edits. Run the whole suite with an isolated HOME and confirm no
  regression against the 562-test baseline (expect 562 minus the removed
  `firstRefusal` assertions, plus the tests added by T001-T004). Confirm the
  contract suites specifically: `test/readme-contract.test.ts`,
  `test/parity-matrix.test.ts`, `test/gate-reachability.test.ts`,
  `test/package-invariants.test.ts`. Confirm `git status --short` shows no
  staged files and that `~/.pi/nodd.json` is unmodified (`git status` cannot see
  it — check its mtime is unchanged instead).
- depends: T001, T002, T003, T004, T005
- evidence: `TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test` reports 0 failures; `git status --short` shows no staged entries.
- review: ~0 changed lines

---

## Review Workload

Budget: **400** changed lines per task.

| task | estimate |
| --- | --- |
| T001 — interpreter/script coverage + both README tables + REQ prose | ~160 |
| T002 — concurrency limitation test + README bullet | ~60 |
| T003 — delegated-declaration boundary test + README bullet | ~55 |
| T004 — CHANGELOG.md + package.json files + invariant tests | ~150 |
| T005 — delete `firstRefusal` | ~25 |
| T006 — full-suite verification | ~0 |

**Total: ~450 changed lines.**

Over-budget exceptions: none. Every task is at or under 400.

### PR batching

Three reviewable batches, ordered:

1. **PR 1 — `fix(classifier): an interpreter running a script file is a write`**
   (T001). The only behavioural change in the run; reviewed alone so the
   coverage boundary gets full attention. Must land first: T002 and T003 edit
   the same README.
2. **PR 2 — `docs: disclose the two limits the gates do not cover`**
   (T002, T003). Documentation plus two behaviour-pinning tests, no production
   change. Depends on PR 1 only for README ordering.
3. **PR 3 — `chore: publish the release history; remove the dead helper`**
   (T004, T005). Independent of PR 1 and PR 2 by file; may be opened in
   parallel, merged in any order.

T006 runs after the last batch merges.
