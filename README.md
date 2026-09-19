# NODD

**N**on-negotiable **O**rganic **D**riven **D**evelopment — the ODD protocol as
runtime mechanism for pi instead of injected prose: blocking gates fed by real
tool events, evidence read from observed tool results, and promotion of NODD
artifacts into `/forge` artifacts.

> **In progress.** The full honest-scope contract — the M/P/F parity matrix, the
> "Not carried from ODD" table, the enforcement-scope statement, the five
> command outcomes and the per-gate flag reference — is completed in T036. The
> bash-gate section below is final and is asserted by test.

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
| package installers (`npm`/`pnpm`/`yarn`/`pip`/`cargo` install or add) | `npm install lodash` |
| inline interpreters (`node -e`, `python -c`) | `node -e "require('fs').writeFileSync('f','x')"` |

### Not covered

These mutation vectors reach the filesystem without this classifier noticing:

- a script or build target that writes: `./build.sh`, `make`, `npm run build`
- compilers, formatters and codegen writing as a side effect
- redirection hidden behind a variable or `eval`
- a pre-existing background process
- writes performed by other extensions' or MCP tools
- writes performed outside pi entirely
- a delegated child launched with its own `extensions:` list, which pi-subagents starts with `--no-extensions`

ODD's failure was promising compliance while shipping delivery. A partial gate
that says which half it holds is worth more than a total one that is not.
