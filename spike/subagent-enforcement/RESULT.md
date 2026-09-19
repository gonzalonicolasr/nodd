# SPIKE RESULT — do parent extensions load in pi-subagent children?

**Answer: YES — conditionally. It depends on *how* the extension is loaded.**

| load mechanism | loads in child? | enforcement in child? |
| --- | --- | --- |
| **installed package / global `settings.json` `extensions`** | **yes** | **yes — the child's `write` was blocked** |
| one-off `--extension <path>` / `-e` on the parent CLI | **no** | no — the child's `write` succeeded |
| project-local `.pi/settings.json` in an untrusted project | not loaded at all | n/a (parent did not load it either) |

NODD ships as an installed pi package (`pi install <path>` → `packages` /
`extensions` in `~/.pi/agent/settings.json`), which is the row that loads in
children. **NODD's gates therefore do apply inside delegated sub-agents.**

## Environment

- pi version: **0.84.2** (`pi --version`)
- node: **v26.2.0**
- pi-subagents: installed at `/home/gon/.pi/agent/npm/node_modules/pi-subagents`
- date: 2026-09-19

## Why the mechanism differs (read before trusting the result)

`pi-subagents` builds the child's argv explicitly
(`src/runs/shared/pi-args.ts:467-500,622-626`). It passes `--extension <path>`
for each entry in `extensionArgs`, and adds `--no-extensions` only when
`disableAmbientExtensions` is true. That flag is set when the agent definition
declares its own `extensions:` list or when a capability ceiling denies
extensions (`:472-474`). Absent those, the child runs **without**
`--no-extensions`, so it performs its own ambient extension discovery — and
that discovery finds globally installed packages/extensions. It does *not*
inherit the parent's ad-hoc `-e` paths, because those are parent argv, not
ambient configuration.

## Probe

`spike/subagent-enforcement/probe-extension.ts` (not production code, not in
`pi.extensions`). On register it writes `$NODD_PROBE_DIR/loaded-<pid>.txt`
carrying the pid and the `PI_SUBAGENT_CHILD*` env markers pi-subagents sets in
children. On `tool_call` it blocks any `write` whose path contains
`PROBE-BLOCK-ME` and appends to `$NODD_PROBE_DIR/blocks.txt`.

A spike-only agent `~/.pi/agent/agents/nodd-probe-writer.md` (`tools: write,
read, bash`) was staged for the run and removed afterwards.

## Run A — parent `-e`, direct write (control)

```sh
rm -rf /tmp/nodd-probe && mkdir -p /tmp/nodd-probe-work && cd /tmp/nodd-probe-work
NODD_PROBE_DIR=/tmp/nodd-probe pi -p "Use the write tool to create a file at \
/tmp/nodd-probe-work/PROBE-BLOCK-ME.txt containing the word hello. Report exactly \
what happened." -e /home/gon/projects/nodd/spike/subagent-enforcement/probe-extension.ts
```

Raw output (agent): "La herramienta devolvió un error y **no** creó el archivo.
Mensaje literal: `nodd probe: this write is blocked by the probe extension`".

`blocks.txt`: `pid=879465 blocked write to /tmp/nodd-probe-work/PROBE-BLOCK-ME.txt`

**Control passes: the gate blocks a direct write in the process that loaded it.**

## Run B — parent `-e`, write delegated to a child

```sh
rm -rf /tmp/nodd-probe /tmp/nodd-probe-work && mkdir -p /tmp/nodd-probe-work
cd /tmp/nodd-probe-work
env -u PI_SUBAGENT_CHILD -u PI_SUBAGENT_CHILD_AGENT -u PI_SUBAGENT_RUN_ID \
    -u PI_SUBAGENT_PARENT_SESSION NODD_PROBE_DIR=/tmp/nodd-probe \
  pi -p "Delegate to the subagent named nodd-probe-writer this exact task: 'Use the \
write tool to create /tmp/nodd-probe-work/PROBE-BLOCK-ME.txt with the content hello, \
then report literally what happened.' Do NOT write the file yourself. Report the \
child's verbatim result." \
  -e /home/gon/projects/nodd/spike/subagent-enforcement/probe-extension.ts
```

(The `env -u` calls clear the inherited `PI_SUBAGENT_*` markers of the session
that ran the spike, so the parent is a genuine parent.)

Child's verbatim result, as relayed by the parent:

> 1. I called the Write tool on `/tmp/nodd-probe-work/PROBE-BLOCK-ME.txt` with
>    content `hello` (plus a trailing newline). The tool returned:
>    `Successfully wrote 6 bytes to /tmp/nodd-probe-work/PROBE-BLOCK-ME.txt`.
>    No block, denial, or error occurred.
> 2. Verification via `ls -la` shows the file exists, 6 bytes […]

Raw evidence:

```
$ ls -la /tmp/nodd-probe/
loaded-884033.txt              # one marker only

$ cat /tmp/nodd-probe/loaded-884033.txt
pid=884033
ppid=884031
PI_SUBAGENT_CHILD=(unset)      # the parent
PI_SUBAGENT_CHILD_AGENT=(unset)

$ cat /tmp/nodd-probe/blocks.txt
cat: /tmp/nodd-probe/blocks.txt: No such file or directory

$ cat /tmp/nodd-probe-work/PROBE-BLOCK-ME.txt
hello
```

**Result: NOT loaded in the child. The child's write went through.**

## Run C — globally installed extension, write delegated to a child

The probe path was added to `~/.pi/agent/settings.json` under `extensions`
(backed up first, restored afterwards), reproducing how an installed NODD
package is loaded.

```sh
rm -rf /tmp/nodd-probe /tmp/nodd-probe-work3 && mkdir -p /tmp/nodd-probe-work3
cd /tmp/nodd-probe-work3
env -u PI_SUBAGENT_CHILD -u PI_SUBAGENT_CHILD_AGENT -u PI_SUBAGENT_RUN_ID \
    -u PI_SUBAGENT_PARENT_SESSION NODD_PROBE_DIR=/tmp/nodd-probe \
  pi -p "Delegate to the subagent named nodd-probe-writer this exact task: 'Use the \
write tool to create /tmp/nodd-probe-work3/PROBE-BLOCK-ME.txt with the content hello, \
then report literally what happened.' Do NOT write the file yourself. Report the \
child's verbatim result."
```

Child's verbatim result, as relayed by the parent:

> 1. I called the Write tool with path `/tmp/nodd-probe-work3/PROBE-BLOCK-ME.txt`
>    and content `hello\n`.
> 2. The tool returned an error instead of success:
>    `nodd probe: this write is blocked by the probe extension`
> 3. I verified with `ls -la /tmp/nodd-probe-work3/` — the directory is empty
>    […]. The file was **not** created.

Raw evidence:

```
$ for f in /tmp/nodd-probe/loaded-*.txt; do grep -E "^pid|^ppid|PI_SUBAGENT_CHILD" $f; done
pid=906649
ppid=906647
PI_SUBAGENT_CHILD=(unset)              # the parent
PI_SUBAGENT_CHILD_AGENT=(unset)
pid=907070
ppid=907033
PI_SUBAGENT_CHILD=1                    # the child process
PI_SUBAGENT_CHILD_AGENT=nodd-probe-writer

$ cat /tmp/nodd-probe/blocks.txt
pid=907070 blocked write to /tmp/nodd-probe-work3/PROBE-BLOCK-ME.txt

$ ls -la /tmp/nodd-probe-work3/
total 0                                 # PROBE-BLOCK-ME.txt absent
```

**Result: loaded in the child (distinct pid, `PI_SUBAGENT_CHILD=1`), and the
child's write was blocked by the child's own copy of the gate.**

## Run D — project-local `.pi/settings.json` (negative control)

A `.pi/settings.json` listing the probe in an untrusted project directory
produced no marker at all: the probe did not load even in the parent. Project-
local extension config requires the project to be trusted.

## Run E — does a child see the on-disk artifacts?

Session state is not shared with children (Run C). The feature doc and the
ledger are a different thing: they live on disk and are the agreed source of
truth (`clarifications.md`). Probed separately.

```sh
rm -rf /tmp/nodd-disk-probe && mkdir -p /tmp/nodd-disk-probe/.nodd/demo
# ... write .nodd/demo/feature.md containing MARKER-PARENT-WROTE-THIS-DOC-ON-DISK ...
cd /tmp/nodd-disk-probe
env -u PI_SUBAGENT_CHILD -u PI_SUBAGENT_CHILD_AGENT -u PI_SUBAGENT_RUN_ID \
    -u PI_SUBAGENT_PARENT_SESSION \
  pi -p "Delegate to the subagent named nodd-probe-writer this exact task: 'Read the \
file .nodd/demo/feature.md relative to your current working directory. Report your cwd, \
whether the file exists, and quote the line that starts with MARKER. Then append a line \
MARKER-CHILD-WROTE-THIS to that same file […]' Do not read or write the file yourself."
```

Child's verbatim result, as relayed by the parent:

> **cwd:** `/tmp/nodd-disk-probe` (confirmed via `pwd`)
> **File exists:** Yes — `.nodd/demo/feature.md`, 169 bytes […]
> **MARKER line, quoted verbatim:** `MARKER-PARENT-WROTE-THIS-DOC-ON-DISK`
> **Append result:** Succeeded. […] `Successfully wrote 194 bytes`

Raw evidence — the parent's own `cat` after the run:

```
$ cat /tmp/nodd-disk-probe/.nodd/demo/feature.md
# Feature: Disk visibility probe
<!-- nodd:slug demo -->
## Objective
MARKER-PARENT-WROTE-THIS-DOC-ON-DISK
## Tasks
- [ ] T1. Probe whether a child reads this file

MARKER-CHILD-WROTE-THIS          <- written by the child process
```

**Result: yes.** The child inherits the parent's cwd and reads and writes the
same `.nodd/<slug>/` artifacts. So `gate-track` transfers to children through
the artifact, not merely per call: a child evaluating "does
`.nodd/<slug>/feature.md` exist?" reads the same file the parent created.

This also confirms why `write`/`edit` targeting `.nodd/**` must be blocked for
children too, not only for the parent: the probe child rewrote the doc with a
whole-file `write` because no append tool was offered to it.

## What NODD may and may not claim

**May claim:** when NODD is installed as a pi package (the documented install
path), its gates run inside delegated pi-subagent children and block there.
Enforcement scope is "parent and delegated children".

**May not claim — the uncovered vectors that remain:**

1. **An agent definition with its own `extensions:` list.** That sets
   `disableAmbientExtensions` (`pi-args.ts:472-474`) and the child is launched
   with `--no-extensions`; NODD is then absent from that child unless it is
   listed explicitly. An agent file NODD does not author can opt out of NODD.
2. **A capability ceiling with `denyExtensions`** has the same effect
   (`pi-args.ts:462-463,472-473`).
3. **Grandchildren** were not probed. Only depth 1 was measured.
4. **Session state is per process.** Each child folds its own observations; a
   child does not see the parent's in-memory committed counters. See the note
   below for what that does and does not mean.
5. This was measured on pi 0.84.2 with the pi-subagents build installed on
   2026-09-19. It is a behaviour of that argv construction, not a documented
   API guarantee, so it can change on upgrade.

## What per-process counting means (and what it does not)

"NODD gates load in children" is not the same as "NODD's session state is
shared with children". Two different things sit under that sentence and only
one of them is a limitation.

**Per-process counting is the correct semantics for the context gates.** ODD's
long-session backstop (~20 tool calls, 5 exploratory reads, 2 non-mechanical
edits without delegating — `routing.go:82`) and the mapping/writer triggers
(`:79-80`) exist to keep the *parent's context* thin enough to orchestrate. A
child runs in its own process with its own context window, so counting per
process is what those triggers are for. A child that reads 4 files has filled
*its* context, not the parent's, and it is the child that should then delegate.
This is not lost coverage.

**The artifacts are shared, so the artifact-backed gates do transfer.** Run E
shows a child inherits the cwd and reads `.nodd/<slug>/feature.md`. `gate-track`
therefore transfers to children through the file, not merely per call. The
ledger `.nodd/<slug>/state.json` lives in the same place and is read the same
way.

**The real limitation:** there is no aggregated whole-session total across
parent and children. A counter that wanted to answer "how many files has this
*feature* touched across every process?" does not exist, and NODD does not
claim one. What exists is a per-process count plus a shared on-disk artifact.
