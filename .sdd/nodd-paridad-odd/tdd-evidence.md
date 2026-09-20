# TDD Cycle Evidence — nodd-paridad-odd

## A process defect, recorded rather than hidden

Strict TDD governed this run. The round-1 veredicto flagged that no evidence
table was written, and it was right: the build phase never produced one.

The reason is the finding this run documents. All five delegated subagents —
`zero-clarify`, `zero-plan`, `zero-analyze`, and `zero-build` — were refused by
`gate-classify` on their first write, because a subagent has no `nodd_declare`
and kernel state is per session. Each one reported back instead of evading, and
the work moved to the orchestrator by handoff. The evidence artifact was the
casualty: the agent that would normally write it could not write anything.

Reconstructed below from the run's own transcript and re-verified by mutation.
Every command was run with an isolated `HOME`.

## Cycles

| Task | Test file | Layer | Safety net | RED | GREEN | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| T001 interpreter+script | `src/bash-classifier.test.ts` | unit | 10/10, 49 cases | ✅ `"node script.js" should be mutating` | ✅ 72 cases | ✅ delete row → 10 cases flip |
| T002 concurrency | `src/ledger.test.ts` | unit | 10/10 | ✅ asserted 2 records, got the loss | ✅ 11/11 | n/a — pins a fact, no production change |
| T003 delegation boundary | `test/gate-reachability.test.ts` | unit | 4/4 | ✅ trimmed the delegator clause → remedy fails `UNIVERSAL_REMEDY` | ✅ 5/5 | ✅ killed |
| T004 CHANGELOG | `test/package-invariants.test.ts` | contract | 5/5 | ✅ `ENOENT: CHANGELOG.md` | ✅ 7/7 | ✅ stale heading → red; drop from `files` → red |
| T005 delete `firstRefusal` | — | — | — | n/a — pure deletion, declared in the plan | ✅ `grep` empty, suite green | n/a |
| veredicto round 1 fixes | `src/bash-classifier.test.ts` | unit | 13/15 | ✅ `deno run` and quoted-data cases failed | ✅ 570/570 | ✅ all three mutants die |

## Where the plan was wrong and the measurement won

T002 is worth recording in detail, because the artifact contradicts the plan
three times over.

1. The plan predicted a silently lost record.
2. The first faithful double showed `writeVerified` **throwing** on read-back
   mismatch — which would have made the README bullet false.
3. Tracing the reads showed `appendRecord` performs exactly two: the ledger read
   and the read-back. Modelling only the *first* as stale — which is what a
   separate process actually experiences — reproduces a **silent loss**, with no
   error anywhere.

The veredicto independently rebuilt this scenario without the flag and got the
same result. The README states what was measured, not what was planned.

## Residual

`(?!-)`, `run`-subcommand handling and quote-stripping are each pinned by a test
whose mutant was verified to die. The `\b` guard in the interpreter pattern is a
proven-equivalent mutant — a 400 000-character differ search found no input that
distinguishes it — so it is deliberately unpinned.
