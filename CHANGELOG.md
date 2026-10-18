# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.3] - 2026-10-18

### Fixed

- Claude Code: a write counted as inside the session scratchpad when its path
  merely contained `/claude-<uid>/<dir>/<session>/`, so a `Write` to
  `/tmp/claude-1000/x/<session>/../../../repo/a.ts`, to
  `/repo/claude-1000/x/<session>/a.ts`, or through a symlink placed in the
  scratchpad skipped every gate. The path must now start at
  `/tmp/claude-<uid>/<dir>/<session>/`, carry no `..`, and resolve (symlinks
  followed) to a place still inside it; the same holds for each path a Bash
  command writes.
- Evidence scoped to declared files compared them with `includes`, so with
  `files: ["src/a.ts"]` the observed write to `/repo/src/a.ts` never counted
  as the last write and a green run from before the edit checked the task
  off. It now matches with `isDeclaredPath`, like the other gates.
- Claude Code: `nodd_task` did not reload the policy, so `/nodd allow
  evidence` or `/nodd gate evidence off` only took effect after some other
  tool call; a hatch it spent was not persisted either.
- Claude Code: launching any `forge:*` agent skipped the gates, so under
  `intent: read-only` the model could delegate to `forge:build`. Only the
  read-only reviewers (`forge:revisar`, `forge:bugs`, `forge:mejoras`) are
  exempt at launch now, and their own calls go through the gates with the
  inherited declaration, so a reviewer under `intent: read-only` can neither
  write nor launch `forge:build`.
- The bash classifier only recognised a covered command as the first word, so
  `env rm -rf build`, `timeout 5 rm -rf .nodd`, `command rm x`, `FOO=1 rm`
  and `/usr/bin/rm` read as reads. Commands are now found the way the
  interpreter row already found them, past wrappers, assignments and
  absolute paths. Downloaders, syncers and extractors that write files
  (`curl -o`/`-O`, `wget`, `rsync`, `tar -x`/`-c`, `unzip`, `find -delete`,
  `find -exec rm`) and git commands that move history (`clone`, `pull`,
  `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `switch`) are writes.
- Claude Code's destructive guard compared paths as text: `rm -rf
  /tmp/../home/x`, `rm -rf ../otro`, `cd sub && rm -rf ../..`, a `FOO=1` or
  `env` prefix, `find -delete` outside the project, `git clean --force`
  and `rm -rf` of the project root itself all passed. Paths are now resolved
  against the working directory and any `cd`, `..` is folded, and the
  session's starting directory is no longer treated as a root.
- `nodd_task add` wrote the title into the feature document as is, so a title
  with line breaks could plant a task already checked with invented evidence.
  Titles, reopen reasons and task ids must be one line; slugs must be one
  plain name, so `slug: "../../tmp/x"` no longer writes outside `.nodd/`.
- A run that `cd`s into another directory before the runner
  (`cd /tmp && npm test`) counted as the declared runner. It now has to run
  in the project root.
- A declared file matched any path ending the same way, so declaring
  `src/a.ts` also covered `/repo/other/src/a.ts`. Declared files are anchored
  at the project root and compared whole.
- Without a declared runner, a test script (`bash run_tests.sh`) counted as
  its own last write and its green run could never check a task off.
- In strict TDD a RED from an earlier task satisfied the next one. The RED
  must now come after the previous checkoff.
- Files written by bash (redirections, `cp`/`mv`/`rm`/`touch` operands,
  `sed -i`, `dd of=`) count as written files, so `promotion` refuses an
  undeclared one and `delegate` counts them toward its threshold.
- `gate-track` missed `echo x >.nodd/a` with no space after `>`, and refused
  `echo "use .nodd/" > notes.md`, where `.nodd/` is text. It now reads the
  command's words, quotes and heredoc bodies resolved.
- `writeVerified` wrote its temp file under a predictable name and followed a
  symlink planted there; a failed read-back left the new content in place.
  The temp file now has a random name and is created exclusively, a failed
  read-back puts the previous content back, and override files are written
  `0600`.
- Claude Code: the scratchpad exemption let `cp -t /repo <scratchpad>/a`
  through, and a glob after `ln -s` reached outside. It now names targets the
  same way as the classifier, so `-t`, link sources and globs are checked, a
  `cd` into the scratchpad is followed, `sed -i`/`chmod`/`truncate -s` on
  scratchpad files pass, and the value of an unrelated assignment is not
  taken for a target.
- Claude Code: a refused `nodd_task` or `nodd_declare` did not update the
  last refusal NERV shows; project agents were looked up in the starting
  directory instead of the repository root; a gate that threw let the call
  through unchecked, and now refuses it; headless sessions now export their
  state file too.

## [0.9.2] - 2026-10-13

### Fixed

- 0.9.0 stopped reading the body of a heredoc handed to node or python with
  the shell rules, so a JS arrow (`s=>s`) or a `truncate(` call no longer
  read as a write. Two cases slipped through: with an unquoted delimiter
  (`node <<EOF`) bash still runs the body's `$(...)` and backticks before
  node starts, and any node or python earlier on the line counted, even when
  the heredoc went to `eval` or `source`. The body is now judged as code
  only when the interpreter is the command that receives the heredoc, and an
  unquoted body still has its substitutions read as shell.
- 0.9.0 matched a relative write against a declared absolute path by its
  tail, so `spec.md` passed as declared when `/repo/.sdd/x/spec.md` was.
  Relative paths are now resolved against the working directory once, when
  the kernel receives the call, and every gate compares absolute paths.
- In Claude Code, a refused `nodd_task` named pi's `/nodd-allow <gate>` as
  its override. Gate refusals already said `/nodd allow <gate>`; the
  `nodd_task` path skipped that rewrite.

## [0.9.1] - 2026-10-12

### Fixed

- An evidence refusal named every command observed in the session, heredoc
  bodies included: one `nodd_task check` answer reached 98,975 characters.
  It now names the last three runs, each cut to its first line and 120
  characters, and how many came before. Measured on 41 real Claude Code
  sessions (234 requests), NODD's share of the context drops from 1,396 to
  about 540 tokens per request, and of the re-read context from 0.83 % to
  0.26 %.
- `nodd_task add` without an `id` gives the task the next free one (`T2`,
  `T3`…). Claude Code does not validate a mod tool's arguments, so the task
  used to be written as `undefined` and could not be checked off on its own;
  `check` and `reopen` without an `id` are refused, naming the remedy.
- `gate-delegate` offered "declare this as small inline work" on every
  refusal, but a new declaration only resets the writer trigger. The mapping
  and long-session refusals now name only the remedies that clear them.

### Documented

- Why `delegate` stays pending in Claude Code. Replayed against 30 days of
  real Claude Code sessions with NODD on, it would have refused 14 % of the
  requests that write and 80 % of subagent writes; per-request counters
  raise the first figure to 27 %.

## [0.9.0] - 2026-10-11

### Added

- `src/scratch.ts`: the Claude Code mod lets through a Bash command whose
  writes provably land in the session scratchpad (567 of 21538 real commands),
  and the destructive refusal names the safe form first (`git reset --keep`,
  `git stash`, `git clean -n`).

- The observed close (`src/close-report.ts`): after every request that wrote,
  NODD reports the files written and the declared runner's state after the
  last write (green, partial, red, exit status hidden, not run), and flags an
  answer that claims success without a full green run, a test edited between
  a red and a green run, added `.skip`/`.only`/`xit`/`t.Skip`/
  `@pytest.mark.skip`, removed assertions, files outside the declared set, and
  a green run that passes fewer tests than an earlier one or skips more.
  Shown at `agent_end` in pi and beneath the answer in Claude Code; the
  warnings reach the model with the next request.
- `src/test-counts.ts` reads the summary of node --test, bun, jest, vitest,
  pytest, cargo and go test -v.
- The Claude Code mod (`claude-code/`): gates authorize, classify, track and
  evidence, one declaration per request, the ODD protocol at the start of the
  conversation, the observed close across the main session, its subagents and
  forge's phase agents.
- `src/destructive.ts`: the Claude Code mod refuses irreversible commands
  (`git reset --hard`, `git clean -f`, `git checkout -- .`, `rm -rf` outside
  the project, `terraform destroy`, `kubectl delete`, a DROP/TRUNCATE against a
  non-local database) for every agent, forge's phase agents included;
  `/nodd allow destructive` lets one through.

### Fixed

- Third precision round of the observed close, measured on the same 14 days
  (2761 requests): warnings 53 → 24, confirmed-green requests 144 → 231,
  claim warnings 41 → 12. A Bash write only makes a green run stale in the
  close when it writes a code file NODD can name (`src/code-targets.ts`:
  redirect, cp/mv/tee/rm, `sed -i`, Python `open(…, 'w')`, `git apply`/`merge`/
  `restore`/`checkout --`, a formatter with `--fix`/`--write`), with `cd`,
  shell variables and Python string joins resolved; `git commit`, a branch
  checkout, `/tmp` and running a script no longer do. The runner is found in
  any segment of a chain, behind `timeout`/`env`/`nice`, and inside `$(…)`; a
  pipe, `;` or `)` after it is not a partial run; a missing script has no
  verdict; "todo verde" alone is not a test claim. The evidence gate keeps the
  strict rule. A subagent classified the remaining claim warnings: 1 true, 3
  defensible for another reason, the rest a green NODD cannot see (an
  `| tail` later in the line, a runner written as `.`, a glob, a subagent's run).
- The classifier counts formatters that rewrite files (`eslint --fix`,
  `prettier --write`, `ruff format`, `black`, `gofmt -w`, `cargo fmt`) as
  writes, so they also make the evidence stale.
- A script under `~/.claude/` or a worktree under `.claude/worktrees/` is code;
  only `~/.claude*/{projects,plans,todos,tasks,shell-snapshots}/` is the
  agent's own.
- The Claude Code mod keeps the declaration and the last declared feature in
  its store per session, so a hot reload of the mod no longer drops them.

- The observed close stopped crying wolf: replaying 14 days of real sessions
  (2761 requests), warnings went from 987 to 81 and confirmed-green requests
  from 10 to 72. A bare "done" with no runner is no longer flagged, test claims
  need test context, a hidden exit status is read from the runner's summary or
  the printed `$?`, `gh pr checks` counts, writes to docs and agent files do not
  stale a green run, negations are not claims, and test data that only
  mentions `.skip` is not an added skip.
- A leading `cd … &&` is no longer part of the runner, in evidence and in the
  close (`~` and `/home/<user>` match).
- The classifier no longer takes Python `.replace(`/`re.compile(`, JS
  `regex.exec(` or `require('./x.json')` for writes, understands `\"` inside
  double quotes, and judges `node -e` by the API it uses; a `require` of any
  module that is not read-only (better-sqlite3, a local file) is still a write.
  On 21538 real commands: 624 fewer counted as writes; the 18 suspicious ones
  were reviewed and the one real file write among them (better-sqlite3) closed.

- A run of the runner whose exit status is hidden (`| tail`, `|| true`,
  `; echo`, `&`) is no longer evidence, nor a failure in promotion's streak.
- A mutating bash command after the green run makes the evidence stale.
- The classifier reads the code of `python -c`, `node -e` and of a heredoc
  given to python or node: read-only code is a read, code that can write is a
  write. `python3 - <<'PY' … open(p, 'w') … PY` used to pass as a read.
- gate-promotion refuses a file the declaration never named even when the
  count fits; declared paths may be relative in promotion and delegate.
- A refused or malformed `nodd_declare` no longer counts as a declaration.
- gate-track refuses mutating bash that names `.nodd/`.
- `/nodd-allow evidence` is spent by the next refused checkoff and records
  `observed: none (override: <reason>)`.

## [0.8.5] - 2026-09-27

### Added

- `/nodd-gates enable all` and `/nodd-gates disable all` turn every gate on or
  off in a single write to `~/.pi/nodd.json`.

### Fixed

- `gate-delegate` no longer refuses a write to a file the declaration named on
  the read (>= 4 files) or tool-call (>= 20) triggers. A generated writer such
  as `nodd-implement` or `zero-build` has no `subagent` tool and no slash
  commands, so it could not reach any remedy and forge builds fell back to the
  orchestrator. Undeclared files and mutating bash still meet every trigger.
- The writer trigger counts only files the declaration never named.
- The README command table documents the real verbs: `enable` / `disable`.

## [0.8.4] - 2026-09-23

### Changed

- The README and the LICENSE credit ODD and its author,
  [Gentleman-Programming](https://github.com/Gentleman-Programming). The MIT
  grant is scoped to this implementation and makes no claim over ODD itself.

## [0.8.3] - 2026-09-23

### Changed

- The README is an entry point again: 594 lines down to 252. The operating
  detail moved to `docs/reference.md`, which ships with the package. The
  contract test reads both files, so splitting the document cannot drop a
  disclosure.

## [0.8.2] - 2026-09-23

### Changed

- The repository is public. `package.json` now declares `repository`, `homepage`
  and `bugs`, so the npm page links to the source instead of showing none, and
  the README header carries site, GitHub, npm and issues.

## [0.8.1] - 2026-09-23

### Changed

- The README leads with what NODD is: the thesis in both languages, an ODD/NODD
  table, a quick start showing a refusal and an allow, and the 1893 plates from
  the landing. The note on how the file is kept honest moved into a collapsible.
- `test/readme-contract.test.ts` checks gate *counts*, not just gate names. The
  rewrite shipped a badge claiming seven gates against a registry of six,
  because `registry.ts` lives in `src/gates/` and got counted as one of the
  gates it indexes; nothing in the suite could see it.

## [0.8.0] - 2026-09-21

### Added

- The three generated agents carry `nodd_declare`, so a delegated child can
  clear `gate-classify` itself. The spike had measured that NODD's gates load
  inside children; the children just had no way past them, so every delegated
  writer was blocked on arrival and a forge run could not coexist with NODD.
  The read-only agents can only declare `read-only`, which removes authority
  rather than granting it, and every other gate still measures the child's own
  observations.

### Fixed

- The reachability invariant measures the reachable remedy's position among the
  options instead of counting `or` separators, which had confused the separator
  introducing the universal remedy with one burying it. It now catches all four
  pre-`5d296ca` orders, where it previously caught two.

## [0.7.7] - 2026-09-21

### Fixed

- Re-declaring the same feature no longer clears its writer count. Scoping the
  count to the current declaration (0.7.6) meant a blocked actor could declare
  the same slug again and start from zero — measured at twelve writes with zero
  delegations. The boundary now moves only when the slug changes, so correcting
  a route or adding a runner mid-feature keeps the count, while a genuinely new
  feature still starts fresh.

## [0.7.6] - 2026-09-21

### Fixed

- `gate-delegate` counts the files the current task wrote, not everything the
  session ever touched. Finishing one feature and declaring the next carried
  the first one's file count forward, so the first write of a new task could be
  refused over work already done — and a threshold that fires on history nobody
  can undo is one an actor learns to route around. The threshold is unchanged:
  the second file of a single task still trips it.

## [0.7.5] - 2026-09-21

### Fixed

- The refusal from `gate-evidence` names the right cause. 0.7.4 blamed the
  pipe, which is false: a runner is matched by prefix, so `npm test | tail -15`
  is accepted and recorded. What refuses is anything *before* the runner, and
  the message now quotes it — `timeout 120` — and says a pipe after the runner
  is fine. It also stopped lecturing `grep -rn "npm test"`, `git commit -m
  "…npm test…"` and `echo npm test`, none of which ran anything.
- A declared `problem`, `scope` or `constraints` can no longer forge a section.
  Duplicate headings resolve last-wins and free prose renders before the
  structured sections, so a field containing `## Objective` silently rewrote
  the objective and lost its own tail on the next save. Headings inside prose
  are indented instead of refused: a `## ` in a recorded code sample should
  survive, just not as a heading.
- The reachability invariant measures against the remedies a subagent can
  actually perform. `ask the user` counts for a person and not for a delegated
  worker, and counting it made the clause blind to the ordering it was written
  to catch. `gate-track` now leads with `write … directly`.

## [0.7.4] - 2026-09-21

### Added

- `nodd_declare` accepts `problem`, `scope` and `constraints`. The feature
  document had those three sections and nothing could fill them, so every
  document was born one third empty — and `/nodd-promote` reads all three into
  the forge handoff, where they printed "Not recorded in the NODD run" every
  time. All optional: a small inline fix owes no problem statement.

### Fixed

- A refusal from `gate-evidence` now says *why* the observed run did not count.
  A real session ran `timeout 120 npm test 2>&1 | tail -15`, believed it had
  run the declared runner, and lost two cycles: the message listed what it had
  seen but never named the rule. (0.7.4 named the wrong rule — see 0.7.5.)

## [0.7.3] - 2026-09-21

### Fixed

- A wrapper no longer hides an interpreter, whatever flags it carries.
  `sudo -n bash <<EOF`, `sudo -u root bash <<EOF`, `command -p bash <<EOF`,
  `env -u VAR bash <<EOF` and `timeout --signal=KILL 5 bash <<EOF` all run the
  body, so the body is read as a script. Measured 48/48 against 41/48 in 0.7.2.
- Flag arity is no longer guessed. `-n` takes a value for `nice` and is boolean
  for `sudo`; three attempts to encode that as a rule each traded one breakage
  for another. The walk now skips a wrapper's flags and stops at the first
  interpreter, which needs no table.
- `env -u VAR cmd` runs `cmd`. An earlier release claimed `-u` named a command;
  it names a variable, and that claim cost four missed writes.

### Changed

- `Known limitations` states the boundary as behaviour rather than syntax: a
  wrapper that *runs* a command is covered whatever flags it carries; one that
  *names* a command — `command -v`, `xargs -I` — is not.

## [0.7.2] - 2026-09-20

### Fixed

- A wrapper no longer hides a heredoc body: `sudo bash <<EOF`,
  `sudo -u root bash <<EOF`, `nice -n 10 bash <<EOF`,
  `timeout --signal=KILL 5 bash <<EOF` and `cat <<EOF | env bash` all run the
  body, so the body is read as a script — including boolean short flags like
  `sudo -n` and `command -p`. What still hides one is a wrapper that *names* a
  command instead of running it: `command -v bash` and `xargs -I bash`.
  (`env -u VAR cmd` runs `cmd`; an earlier entry here claimed otherwise and was
  wrong.)
- The heredoc check and the script-file check now resolve a command word
  through one shared helper. They were two loops that kept drifting apart:
  one learned about `then`/`do` and the other did not, so
  `for f in a; do bash <<EOF` hid its body.

## [0.7.1] - 2026-09-20

### Fixed

- Data is data for every pattern, not just redirection. A covered word inside
  a quoted string, a `#` comment or a heredoc body is no longer read as a
  command: `grep -rn 'then install' docs/`, `jq '{install}' package.json` and
  `cat <<'EOF'` carrying an arrow function are reads again. Three reviewers hit
  the heredoc case while reading this repository.
- A heredoc handed to an interpreter keeps its body visible, because a body
  stops being data once something runs it: `cat <<EOF | bash`, `bash <<EOF` and
  `cat <<EOF | sudo bash` are writes. An unterminated heredoc swallows nothing.
- `(rm -rf build)` and `ls && { chmod +x f; }` are writes; a subshell and a
  brace group were load-bearing in the separator set and pinned by no test.

## [0.7.0] - 2026-09-20

### Changed

- **The bash gate sees a whole command, not a first line.** A newline now
  separates commands, as do `(`, `{`, `then` and `do`. Everything after line
  one used to be invisible to *every* pattern — `ls` followed by `rm -rf build`
  classified as a read — so this is more enforcement than any previous version
  had, on the nine pre-existing rows as well as the new one.
- Quoted data is excluded from every pattern, not just redirection. Searching
  for a covered word is a read: `grep -rn 'then install' docs/` and
  `jq '{install}' package.json` are not writes.

### Added

- An interpreter running a script file is a write: `node script.js`,
  `deno run main.ts`, `bash "my script.sh"`, `/usr/bin/env node app.js`,
  `timeout 10 node x.js`, `(node x.js)`, `sudo bash /opt/setup`. Ten evasions
  were found and closed across five review rounds; the README now states the
  posture plainly — this gate catches the write a model reaches for after a
  refusal, not the write a model is determined to hide.
- `Known limitations` records two limits that had no mechanism and no
  disclosure: two pi sessions in one repo lose observations through an
  unlocked read-modify-write, and a delegated worker cannot declare its own
  route, so each one costs a delegator round-trip. Both are pinned by tests of
  the underlying fact.
- A published CHANGELOG, asserted against `package.json` so a release cannot
  skip it.

### Removed

- `firstRefusal`, which had no production caller. First-refusal-wins is
  defined once, in the kernel.

## [0.6.2] - 2026-09-20

### Fixed

- The kill switch works on a machine that has never run pi. `/nodd-gates
  disable` died with `ENOENT` because the write did not create `~/.pi` — the
  one moment a kill switch exists for.
- `/nodd-allow` reaches the kernel. The command wrote its one-shot override
  into an object connected to nothing, so it reported success and changed no
  behaviour, while every refusal in the product told the user to run it.
- `--nodd-off` turns gates off. The flag was registered, accepted by pi, and
  read by nobody.
- A config NODD cannot parse is reported instead of silently resetting every
  gate to its default.

### Added

- `Known limitations` records that only pi's builtin writers are gated, and
  that there is no single switch that stops everything.

## [0.6.1] - 2026-09-20

### Fixed

- A call abandoned mid-turn no longer inflates the counter that refuses the
  next one. pi never reports a result for a blocked or aborted call, so the
  entry leaked and each refusal fed the following one.
- The reachability invariant is driven by real refusals instead of a scan of
  gate source, which a comment could satisfy.

### Added

- The footer counts tasks: `nodd · tracked · my-feature · 0/2`.

## [0.6.0] - 2026-09-19

### Changed

- **The `orchestrator` model slot was removed, and existing configs are
  migrated on load.** Nothing read that slot, so assigning it looked like a
  choice and did nothing. On startup NODD moves `orchestrator` to `default`
  when `default` is unset and drops it when both are set. **This rewrites
  `~/.pi/nodd.json`**, including the profiles that hold the assignment; a
  timestamped backup is taken before the file is touched, and the migration
  writes only when there is something to migrate.
- Read-only work may delegate to a read-only worker. `gate-authorize` now
  refuses delegation to a *writer* rather than delegation as such.

### Fixed

- Refused tool calls no longer count as observed effects. A blocked write was
  recorded as a real one, so the counters escalated over work that never
  happened and locked the session out of itself.
- `classify`, `delegate` and `promotion` name remedies their recipient can
  actually perform. A subagent has no slash commands, so a refusal offering
  only those was a dead end.
- The canonical step router covers `resolve-uncertainty` and `close`, which
  were unreachable.

## [0.5.1] - 2026-09-19

### Fixed

- Tools register `execute`, the field pi actually calls.
- A redirect into `/dev/null` is not a write.
- The declared feature document can be created. The gate that demanded it also
  blocked writing it.

## [0.5.0] - 2026-09-19

### Added

- The footer says NODD is on, and what it is tracking.

## [0.4.1] - 2026-09-19

### Fixed

- The model picker browses the providers you actually have, and stops doubling
  the provider prefix.

## [0.4.0] - 2026-09-19

### Added

- Two framed panels in the model picker, with providers browsable by prefix.

## [0.3.1] - 2026-09-19

### Fixed

- The picker opens on the profiles that are saved.

## [0.3.0] - 2026-09-19

### Changed

- Gate policy is injected and re-read on every tool call, not captured once at
  startup. Disabling a gate on disk now takes effect without restarting pi.

## [0.2.2] - 2026-09-19

### Added

- Documentation for choosing models and when a choice takes effect.

## [0.2.1] - 2026-09-19

### Fixed

- Gates read `file_path`, the field pi's write tool sends. Reading only `path`
  left the write record empty.

## [0.2.0] - 2026-09-19

### Added

- First published release: the session state kernel, the six gates
  (`authorize`, `classify`, `track`, `delegate`, `evidence`, `promotion`), the
  bash mutation classifier, the evidence ledger, extension-owned feature
  documents, model slots with profiles and a picker, generated agents, and
  `/nodd-promote`.
