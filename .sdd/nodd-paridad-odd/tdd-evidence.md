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
| veredicto round 1 fixes | `src/bash-classifier.test.ts` | unit | 12 tests | ✅ `deno run` and quoted-data cases failed | ✅ 570/570 | ✅ all three mutants die |
| veredicto round 2 fixes | `src/bash-classifier.test.ts` | unit | 15 tests | ✅ quoted paths with spaces, and reads regressed by round 2 | ✅ 573/573 | ✅ four mutants die |

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

## Rounds 3 and 4

Round 3 replaced the regex with a tokeniser, after round 2 proved content cannot
separate a grep needle from a script path. Round 4 attacked the tokeniser the
way a model would and closed what it found, in two passes:

| pass | evasion found | closed by |
| --- | --- | --- |
| self-attack | `(node x.js)`, `$(node b.js)`, `nohup`, `env node x.js` | subshell chars break a token; wrappers are transparent |
| veredicto round 3 | `/usr/bin/env node`, `/usr/bin/node`, `timeout 10 node`, `exec`, `setsid`, `node -- x.js`, `bash script\ name.sh` | interpreters and wrappers matched by basename; backslash escapes; `--` ends flags; numeric wrapper arguments |
| veredicto round 4 | a **newline** — `ls\nnode build.js` — plus control-flow bodies | newline, `{`, `then` and `do` open a command, in `tokenise` *and* in `commandWord` |
| veredicto round 5 | the round-4 fix made the gate **refuse reads**: `grep -rn 'then install' docs/` became a write | every regex row now matches against the command with quoted data blanked; the interpreter row is exempt because it tokenises quotes itself |
| closing pass | the two declared false positives — a `#` comment and a heredoc body — plus a surviving mutant on the comment's word boundary | comments and heredoc bodies join quoted strings as data; `echo a#b > f` pins that a `#` mid-word is not a comment |

`/usr/bin/env node` is the most idiomatic interpreter invocation there is and
`timeout N` is this project's own test idiom; both evaded on the first try,
which is the only standard a denylist is measured against.

## Residual

Every mechanism in `runsScriptFile` is pinned by a test whose mutant was
verified to die: the command-word position check, quote-aware tokenising, the
flag guard, the `run` subcommand and its flags, subshell characters, the
wrapper loop, basename matching, backslash escapes, `--`, numeric wrapper
arguments, and `SCRIPT_FILE`'s slash branch — which round 3 found load-bearing
and unpinned, so deleting it left the suite green while
`bash /usr/local/bin/setup` stopped being a write.

Deliberately not covered, and disclosed in `NOT_COVERED`: an argument NODD
cannot see is a file (`node x`, no extension and no path), a script piped into
an interpreter, a bare flag's own value, and a script run without naming an
interpreter.

Round 4's finding is the one worth remembering. Nine evasions needed an
adversary; the tenth needed only two lines of bash, which is the ordinary shape
of agent work. It also exposed that the blind spot was never new code's fault:
`commandWord` had been missing the newline since `19167a7`, so `ls\nrm -rf build`
had been invisible to *every* pattern, not just the interpreter row. The fix
lands in both places.

Round 5 is the one that closes the loop. Widening the separators to `\n`, `(`,
`{`, `then` and `do` widened `commandWord`'s quote-blindness along with them, and
a regex that had been *almost* harmless became a gate that refused `grep`, `jq`
and `git log`. The fix was already precedented one function above:
`redirectsToFile` had blanked quoted data since the day it was written. Now every
regex row does, and the interpreter row opts out because it parses quotes itself
and needs the filename in `bash "my script.sh"` to survive.

The two false positives that round 5 left declared were then closed, because
they turned out to be the same idea one more time rather than a new sweep: a
`#` comment and a heredoc body are data, exactly like a quoted string, and
`blankQuotedData` already existed to say so. Three reviewers had hit the
heredoc case while reading this repository, which is as close to a field report
as a gate gets.

One mutant survived that pass and was kept honest: dropping the word-boundary
from the comment rule left the suite green while `echo a#b > f` stopped being a
write, so it is pinned. A second — keeping the heredoc terminator line — was
genuinely equivalent, since a terminator is a bare word that never carries
syntax, so the code was simplified instead of defended by a test.

That is also the argument for stopping. A denylist over a Turing-complete shell
does not close by sweeping, so the README now states the posture plainly: this
gate catches the write a model reaches for after a refusal, not the write a
model is determined to hide. The remaining known gaps — variables, aliases,
flag-carrying wrappers — are declared rather than chased.

One mutant was found equivalent rather than pinned: skipping `$` in the
tokeniser. `(` already ends the token, so the line did nothing and was deleted
instead of defended by a test.

## Round 2, and why the classifier was rewritten rather than patched

Round 2 rejected the whitespace heuristic, correctly. Blanking a quoted run
that contains whitespace closes round 1's false positive and simultaneously
opens two complementary holes, because *a quoted token with a space is both the
shape of a grep needle and the shape of a real path*. The reviewer named the
consequence precisely: content cannot separate them, position can.

So `runsScriptFile` now tokenises the command — keeping a quoted run as one
token — and fires only when an interpreter is a **command word**: the start of
the line or of a `;`/`&&`/`|` segment. `bash "my script.sh"` is a write;
`grep -rn ';node' src/` is a read. Both are pinned, and four mutants die:
dropping the position check, the flag guard, the `run` handling, or quote-aware
tokenisation each turns a test red.

A second test now asserts that `NOT_COVERED` does not *deny* coverage the
classifier has. Round 1's defect was a table naming coverage that did not
exist; round 2 produced the inverse, and the drift test could not see either,
because it compares README text to code text and never to behaviour.
