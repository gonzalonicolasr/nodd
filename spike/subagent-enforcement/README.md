# Spike: sub-agent enforcement

**Not production code.** Nothing here is listed in `package.json`'s
`pi.extensions`, and nothing under `src/` or `extensions/` imports it.

## The question

When a parent pi session loads NODD, do NODD's `tool_call` gates also run
inside pi-subagent child processes? It matters because `gate-delegate` actively
pushes work into sub-agents: if gates do not load there, NODD would ship a gate
that routes work around its own enforcement.

The answer is recorded in `RESULT.md`. Both answers were acceptable; only an
unrecorded one was not.

## How to reproduce

1. Stage a spike-only agent so the parent has something to delegate to:

   ```sh
   cat > ~/.pi/agent/agents/nodd-probe-writer.md <<'EOF'
   ---
   name: nodd-probe-writer
   description: Spike worker that attempts one blocked write.
   tools: write, read, bash
   systemPromptMode: replace
   inheritProjectContext: false
   inheritSkills: false
   defaultContext: fresh
   ---

   You are a spike worker. Do exactly what the task says, then report literally
   what happened.
   EOF
   ```

2. Run the three cases in `RESULT.md` (A: direct write via `-e`; B: delegated
   write via `-e`; C: delegated write with the probe listed in
   `~/.pi/agent/settings.json` under `extensions`). Back up that settings file
   before editing it and restore it afterwards.

3. Read the observables, not the agent's prose:

   - `$NODD_PROBE_DIR/loaded-<pid>.txt` — one file per process that loaded the
     probe, carrying `PI_SUBAGENT_CHILD`. Two files with one marked `=1` means
     the child loaded it.
   - `$NODD_PROBE_DIR/blocks.txt` — one line per blocked write, with the pid
     that blocked it.
   - whether the target file exists on disk.

4. Remove `~/.pi/agent/agents/nodd-probe-writer.md` and restore
   `~/.pi/agent/settings.json`.

The agent's self-report is *not* the evidence — the marker files and the
filesystem are. That distinction is the whole product.
