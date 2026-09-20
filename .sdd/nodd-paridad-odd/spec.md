# Spec delta — nodd-paridad-odd

**Canonical store status:** `.sdd/specs/requirements.md` does not exist
(`ls: .sdd/specs: No such file or directory`). Per the plan contract this is
treated as an **empty store**, so every requirement below is `## ADDED`. The
per-run document `.sdd/nodd/requirements.md` is a prior run's artifact, not the
canonical store; where this delta changes text inside it, that is an
implementation edit named in `tasks.md`, not a store MODIFY.

## ADDED

### REQ: bash-interpreter-script-coverage

The bash mutation classifier treats **an interpreter invoked with a script file
as its first argument** as `mutating`. The interpreters recognised are `node`,
`deno`, `bun`, `python`, `python3`, `ruby`, `perl`, `bash`, `sh` and `zsh`,
optionally prefixed by `sudo`, at the start of the command or after a shell
separator (`;`, `&`, `|`, `&&`, `||`). The first argument counts as a script
file when it does not begin with `-` and either carries a script extension
(`.js`, `.cjs`, `.mjs`, `.ts`, `.mts`, `.cts`, `.py`, `.sh`, `.bash`, `.rb`,
`.pl`) or contains a path separator.

The boundary is deliberately conservative in one direction and
over-approximating in the other, and both directions are published:

- **Only the first argument is inspected.** An interpreter given flags before
  its script (`node --experimental-strip-types x.ts`) is not covered, because
  scanning past flags would classify this repository's own test invocation
  `node --test test/parity-matrix.test.ts` as a write and break the suite.
- **A script file is assumed to mutate.** The command string does not say what
  the script does, so a read-only script is refused along with a writing one.
  The refusal carries its remedy and one-shot escape hatch, so the cost of this
  false positive is bounded and reversible; the cost of the false negative is a
  silent, ungated write.

Acceptance criteria:
- `classifyBash` returns `mutating` for `node script.js`, `python3 file.py`,
  `bash script.sh`, `sh ./run.sh`, `node ./bin/cli.mjs`,
  `python3 manage.py migrate`, `ruby rakefile.rb`, `perl script.pl`,
  `sudo bash install.sh` and `ls && node build.js`.
- `classifyBash` returns `non-mutating` for every command this project and its
  users run constantly: `node --test`, `node --test --experimental-strip-types`,
  `node --test test/parity-matrix.test.ts`, `node --version`, `npm test`,
  `git status`, `git log --oneline -5`, `python3 -m pytest`,
  `python3 -m http.server`, `bash -lc 'grep x'`, `bun test`, `deno task build`,
  `shellcheck script.sh`, `nodemon server.js`, `python3-config --includes`.
- The new pattern appears as a row in `COVERED_PATTERNS` with a label and an
  example, and the example classifies `mutating` (enforced by the existing
  "every pattern matches something" test).
- `NOT_COVERED` names the vectors this pattern does **not** reach: a script run
  without naming an interpreter (`./build.sh`), build targets (`make`,
  `npm run build`), an interpreter whose script is not its first argument or is
  passed as a string (`bash -lc '…'`), and a script piped into an interpreter
  (`cat gen.py | python3`).
- Both README tables render the new covered row and the revised not-covered
  entries verbatim, enforced by the existing drift test in
  `src/bash-classifier.test.ts`.
- `REQ: bash-mutation-classifier` in `.sdd/nodd/requirements.md` enumerates the
  new pattern, so the prior run's spec does not describe a boundary the code no
  longer has.
- No documentation string added by this change claims the bash gate is
  complete, exhaustive, or a guarantee.

### REQ: changelog-release-history

The package ships a `CHANGELOG.md` in *Keep a Changelog* format, newest first,
covering every published release from `0.2.0` to the current version, with each
entry derived from the commits between the preceding `chore: release` commit and
its own.

The `0.6.0` entry states explicitly that upgrading **rewrites the user's
`~/.pi/nodd.json`**: the inert `orchestrator` model slot was removed and
existing configs are migrated to `default` on load, taking a backup first.

Acceptance criteria:
- `CHANGELOG.md` exists at the repository root and carries one heading per
  published version: 0.2.0, 0.2.1, 0.2.2, 0.3.0, 0.3.1, 0.4.0, 0.4.1, 0.5.0,
  0.5.1, 0.6.0, 0.6.1, 0.6.2.
- The newest version heading equals `package.json`'s `version`, asserted by
  test, so a release that forgets the changelog fails the suite.
- `CHANGELOG.md` is listed in `package.json`'s `files` array, asserted by test,
  so npm consumers actually receive it.
- The `0.6.0` entry contains the string `~/.pi/nodd.json` and the word
  `backup`.
- No entry claims a change that its commit range does not contain.

### REQ: concurrency-limitation-disclosure

NODD provides **no** cross-process coordination. Two pi sessions working in the
same repository append to the same `.nodd/<slug>/state.json` through an unlocked
read-modify-write, so interleaved appends lose records. This is disclosed in the
README's *Known limitations* section as an open limitation, and no mechanism is
promised.

Acceptance criteria:
- A test drives two interleaved `appendRecord` calls through the injectable
  `Fs` and asserts a record is lost — proving the limitation is real rather
  than asserting a sentence exists. If locking is ever added, this test turns
  red and forces the README to be corrected.
- The *Known limitations* section names concurrent sessions and
  `.nodd/<slug>/state.json`.
- The disclosure promises no lock, no queue and no retry.

### REQ: delegated-declaration-boundary

A delegated subagent cannot declare its own route: `nodd_declare` is not in a
generated worker's toolset and slash commands are unavailable to it, so
`gate-classify` refuses its first write and the only reachable remedy is
reporting the refusal back to the delegator. This is the designed behaviour —
the refusal's remedy is reachable, which is the reachability invariant holding —
but its cost is one delegator round-trip per delegated writer, and the README
must say so.

Acceptance criteria:
- A test drives `classifyGate` with `emptyCommitted()` (the state a freshly
  started child kernel has) and asserts: the call is refused, and the refusal's
  remedy matches the universal-remedy pattern already used by
  `test/gate-reachability.test.ts` — i.e. an actor with no tools can act on it.
- The README's *Known limitations* section states that a delegated worker
  cannot self-declare and that each one costs a delegator round-trip.
- The disclosure does not promise an inheritable declaration or a future fix.

### REQ: no-dead-refusal-helper

`firstRefusal` is removed from `src/gates/policy.ts` together with its unit
test. First-refusal-wins remains implemented once, inline in the kernel, where
it can do what the helper's signature cannot express.

Acceptance criteria:
- `grep -rn "firstRefusal" --include=*.ts .` returns no results.
- The full suite passes with no test count regression other than the removed
  helper's own assertions.
- `extensions/nodd-kernel.ts`'s registry loop is unchanged.
