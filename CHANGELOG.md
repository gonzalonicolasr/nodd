# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
