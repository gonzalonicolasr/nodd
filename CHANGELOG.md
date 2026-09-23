# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
