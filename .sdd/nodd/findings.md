# Explore findings — nodd

> Restored from the zero-explore subagent run log
> (`/tmp/pi-subagents-uid-1000/async-subagent-runs/dccbf345-5b05-4c63-9fdf-82b90754e637/`)
> by the plan phase: the file was absent from `.sdd/nodd/` on disk.

## Code roots

- `/home/gon/projects/nodd` — destination repository. It currently contains only the tracked `PLAN.md`; its `.sdd/` and `.pi/` directories are untracked runtime artifacts.
- `/home/gon/zero/packages/zero-pi` — read-only composition reference for the existing `/zero-models` command and Forge integration.
- `/tmp/gentle-ai` — read-only ODD reference clone, verified at commit `d4187c1d996754475f22fa7368d1c9afb1b8a938`.
- Pi runtime/API documentation is outside the destination code root at `/home/gon/.local/share/mise/installs/node/26.2.0/lib/node_modules/@earendil-works/pi-coding-agent`.
- Installed `pi-subagents` composition dependency is outside the destination code root at `/home/gon/.pi/agent/npm/node_modules/pi-subagents`.

## Outcome

The core premise is **partially verified**:

- **Verified:** pi has a pre-execution, blocking `tool_call` hook, dynamic prompt injection, post-execution tool-result visibility, slash-command registration, session persistence, and a registry-backed model picker pattern. NODD can be built as a pi extension/package without modifying zero-pi.
- **Critical correction:** the typed pi `tool_result` API exposes `isError`, rendered `content`, and limited bash `details`, **but not a numeric bash exit code**. Therefore PLAN.md §1/§5b’s exact claim that extension event capture provides observed “exit code” is not supported by this API as written. A design change is required for numeric exit-code evidence.
- **Important enforcement boundary:** `tool_call` can block built-in `write`/`edit` and any named custom tool before execution, but a generic `bash` call is a shell string. The hook does not supply a filesystem-write intent model. “No first write without feature.md” is mechanically robust for `write`/`edit`; enforcing arbitrary shell redirection, scripts, package managers, or indirect mutations requires an intentionally conservative command policy, a shell interception/override, or a reduced guarantee.

## A. ODD as it exists today

### A1. The guidance renderer is a string builder, not runtime enforcement

**Source:** `/tmp/gentle-ai/internal/components/agentguidance/routing.go`

- The file is exactly **121 lines** (`routing.go:1-121`).
- `RenderRouting(agent)` resolves the capability manifest at `routing.go:28-32`, copies `manifest.ImplementationRouting` at `:34`, checks the SDD selection policy at `:35-37`, then creates `strings.Builder` at `:39`.
- The body is built by literal `output.WriteString(...)` calls:
  - ODD introduction and seven-step protocol: `routing.go:40-52`.
  - Route prose with manifest values inserted by `fmt.Fprintf`: `:55-66`.
  - Delegation trigger prose: `:73-84`; only mapping/writer values are formatted with `Fprintf` at `:79-80`.
  - Detailed operational prose: `:86-105`.
  - Receipt-driven-development prose: `:106-118`.
  - It returns `output.String()` at `:120`.

**What is prose vs. mechanism**

- **Prose:** all actual ODD obligations, including authorization, tracking, task completion, evidence, TDD, commit and close rules, are literal prompt text. Examples: write prohibition `routing.go:43-45`, feature-document requirement `:49`, observed-proof wording `:50`, and delegation “mandatory” wording `:77-84`.
- **Mechanism inside this renderer:** only:
  1. resolve a manifest,
  2. reject an unknown selection-policy value,
  3. interpolate a few integer thresholds into text,
  4. return a string.
- The renderer explicitly says it “states no runtime observation, issues no lifecycle authority, and activates no remote mechanism” (`routing.go:25-27`). This supports the thesis that ODD itself does not enforce its instructions.

**Injection path**

- `InjectRoutingWithOptions` calls `RenderRouting(agent)` before resolving a delivery target (`/tmp/gentle-ai/internal/components/agentguidance/inject.go:81-89`).
- It further adds remote-authorization text at `inject.go:93-98`, then selects one of three delivery strategies at `:99-107`.
- Markdown/system-prompt delivery injects the string via `filemerge.InjectMarkdownSection` then persists atomically with `filemerge.WriteFileAtomic`:
  - prompt-section route: `inject.go:229-232`;
  - Jinja module route: `:262-264`.
- Orchestrator-prompt delivery merges the rendered prompt into settings JSON and atomically writes it at `inject.go:316-332`.
- Thus the concrete enforcement is delivery of a prompt block, not behavioral enforcement after delivery.

### A2. Manifest thresholds are facts rendered into prose, not a comparator

**Actual location:** the requested path is inaccurate. There is no `/tmp/gentle-ai/internal/components/capabilitymanifest/manifest.go`; the real source is:

`/tmp/gentle-ai/internal/agents/capabilitymanifest/manifest.go`

**Values**

- Inline understanding range: **1–3 files**
  - fields: `manifest.go:82-89`;
  - canonical values: `:203-210`, especially `MinUnderstandingFiles: 1` (`:204`) and `MaxUnderstandingFiles: 3` (`:205`).
- Mechanical write maximum: **1 file** at `manifest.go:206`.
- Mapping/delegation trigger: **4 files** at `manifest.go:211-216`, specifically `MappingMinUnderstandingFiles: 4` (`:212`).
- Writer trigger: **2 non-trivial files** at `manifest.go:211-216`, specifically `WriterMinNonTrivialFiles: 2` (`:213`).
- Long-session “about 20 tool calls” is **not a manifest field**. It is a literal prose value in `routing.go:82`: “after about 20 tool calls, 5 exploratory reads, or 2 non-mechanical edits...”.

**Where values are used**

- `ForAgent()` places `CanonicalImplementationRouting()` into the manifest at `manifest.go:115-141`, especially `:126`.
- Non-test production references to the routing fields are the renderer only:
  - direct range passed to `fmt.Fprintf`: `routing.go:55-60`;
  - mapping/writer values passed to `fmt.Fprintf`: `:61-66`;
  - mapping/writer trigger prose passed to `fmt.Fprintf`: `:79-80`.
- The manifest’s own comment states it is “data for renderers and parity checks, not an implementation-route selector or SDD admission authority” (`manifest.go:73-80`).

**Conclusion:** PLAN.md is correct that NODD must change the role of the manifest: gentle’s values currently feed `Fprintf`, not a real gate comparator.

### A3. ODD protocol, textual seven steps

`/tmp/gentle-ai/docs/usage.md:11-21` contains the documentation section **“The ODD protocol”**:

1. `usage.md:15` — **Authorize** — establish whether the request authorizes a change; read-only work stays read-only.
2. `usage.md:16` — **Explore** — explore existing code and requirements first, proportionately to the request.
3. `usage.md:17` — **Resolve uncertainty** — optional named-uncertainty research, one focused question for a real product decision, at most one assumption challenge for a high-consequence unproven premise.
4. `usage.md:18` — **Classify** — substantial means two or more meaningful implementation steps or progress worth recovering; small understood work remains small.
5. `usage.md:19` — **Track before the first write** — substantial work creates the feature document and Engram mirror before first source write.
6. `usage.md:20` — **Implement task by task** — use appropriate topology/TDD/checks, check off only observed proof, and close each task with a work-unit commit.
7. `usage.md:21` — **Close** — report verified outcome, failed/pending checks, and next step.

The doc explicitly says ODD is shared guidance rather than a state engine: `usage.md:91` — “ODD adds shared agent guidance, not a new CLI, state engine, or mandatory planning phase. Instruction tests establish delivery, not autonomous compliance…”

### A4. Real feature-document format

**Example:** `/tmp/gentle-ai/odd/tasks/odd-mandatory-delegation.md`

The document demonstrates the requested structure:

- Feature title: `odd-mandatory-delegation.md:1`.
- Objective: `:3-7`.
- Problem and evidence: `:9-25`.
- Scope: `:27-34`.
- Constraints: `:36-41`.
- Checklist with stable task IDs `T1` through `T5`: `:43-55`.
  - A complete item carries route and observed evidence, e.g. T3 at `:49-50`.
- Outcome: `:57-61`.
- Acceptance criteria: `:63-68`.
- Progress: `:70-72`.

The docs prescribe this one-document structure explicitly: `/tmp/gentle-ai/docs/usage.md:23` says `odd/tasks/<feature-name>.md` holds objective, problem, why, scope, constraints, actionable stable-ID checklist, acceptance criteria, verification evidence, progress, and next step.

**NODD seam:** use `.nodd/<slug>/feature.md` as the durable analogue. Its schema must be extension-owned for evidence/checkoff integrity, not just prompt-authored Markdown.

### A5. Drift-ratchet claims

**Confirmed, with one wording qualification.**

- `orchestrator_drift_ratchet_test.go` states there are twelve hand-maintained near-duplicate runtime orchestrators at `/tmp/gentle-ai/internal/assets/orchestrator_drift_ratchet_test.go:12-17`.
- It states exactly **21 shared subsections**, only **two** byte-identical, and **“Delegation Rules” has eleven variants across eleven runtimes** at `:12-15`.
- The ratchet enumerates the 21 named shared sections at `:22-46`.
- “Delegation Rules” has `maxVariants: 11` at `:26`.
- Byte identity is measured by SHA-256 of each trimmed section body at `:50-82`, specifically `:70-75`.
- The check only fails if variants grow above each pinned maximum at `:85-101`; it does not require convergence.
- `/tmp/gentle-ai/.refusal-ratchet-baseline.txt` is **105,993 bytes** and **1,071 lines**. It is therefore reasonably described as “~106 KB”, but the exact byte count is 105,993.

### A6. `ErrUnloadableGuidance`

- Defined in `/tmp/gentle-ai/internal/components/agentguidance/inject.go:37-40`.
- Its guarantee is delivery fail-closed: do not report successful installation when the agent will not load the guidance.
- Jinja delivery returns this error if the adapter cannot bootstrap a router template: `inject.go:183-187`.
- It returns this error if the template path is absent: `:276-280`.
- It returns this error if the bootstrapped template does not reference `agent-routing.md`: `:282-288`.
- The comment explains the invariant: an unreferenced module is inert; failure is preferable to reporting a successful install that no agent will read (`:272-275`).

**NODD implication:** this is a delivery assurance, not compliance assurance. NODD’s equivalent durable requirement is stronger: gates must be loaded in each runtime where enforcement is claimed, and observed artifacts must be written/reconciled rather than merely injected into prompts.

## B. `/nodd-models` composition pattern

### Existing `/zero-models` registration and persistence

**Main file:** `/home/gon/zero/packages/zero-pi/extensions/zero-models.ts`

- It is a deterministic code handler, not an LLM prompt (`zero-models.ts:1-5`).
- It registers a pi command with:
  ```ts
  pi.registerCommand("zero-models", { description, handler })
  ```
  at `zero-models.ts:929-937`.
- `zeroJsonPath()` builds `~/.pi/zero.json` using `homedir()` at `:140-143`.
- `readZeroJson()` reads/parses it and falls back to `{}` on absent/invalid data at `:150-157`.
- Direct model assignments are parsed and validated before mutation:
  - validation function: `:411-460`;
  - command handler invocation: `:1001-1017`;
  - persisted normalized maps: `:1019-1037`.
- It preserves unrelated JSON fields with spreads before writing, e.g. `:1032-1037` and interactive merge `:1089-1136`.

### Pi registry usage

- The command gets groups from `ctx.modelRegistry` at `zero-models.ts:939-944`.
- `providerGroups()` reads `registry.getAll()` and groups exact `provider`/`id` pairs at `:505-525`.
- The code intentionally writes IDs pi can resolve, rather than a foreign catalog (`:508-513`).
- Direct assignments:
  - accept a provider-qualified model;
  - reject unknown providers/models;
  - reject ambiguous bare model IDs with qualified suggestions;
  - remain permissive only if no registry exists.
  Evidence: `validateAssignment()` at `:411-460`, especially `:423`, `:425-442`, `:445-459`.

### TUI picker and the no-`pi-tui` constraint

- The file explicitly forbids **any** import—value or type—from `@earendil-works/pi-tui` at `/home/gon/zero/packages/zero-pi/extensions/zero-models.ts:22-32`.
- Reason: direct test imports must not fail with `ERR_MODULE_NOT_FOUND`; it declares the minimal local component interface instead (`:34-40`).
- The picker’s dependency-free state machine is separated into `/home/gon/zero/packages/zero-pi/extensions/zero-models-picker.ts`:
  - no filesystem and no pi imports: `zero-models-picker.ts:5-11`;
  - picker state constructor: `:228-241`;
  - providers are sorted from registry groups: `:469-480`;
  - model list uses a selected provider, or fallback models only if registry is absent: `:483-498`;
  - state machine returns save/quit rather than writing files: `:177-181`, `:827-830`.
- The real TUI entry point calls `ctx.ui.custom(...)` at `zero-models.ts:1051-1072`.
- Persistence happens only after a save outcome, at `:1089-1136`; quit makes no changes at `:1077-1087`.

### Profiles

**File:** `/home/gon/zero/packages/zero-pi/extensions/zero-models-profiles.ts`

- Profiles live under `profiles` with `activeProfile` in the same JSON file, documented at `zero-models-profiles.ts:1-11`.
- Valid names and reserved verbs are constrained at `:46-68`.
- Malformed profile data is discarded safely by `readProfiles()` at `:170-177`.
- `applyProfileCommand()` is pure and returns updated data/message; command code decides whether to write, at `:285-299`.
- `new`, `save`, `use`, and `delete` behavior occurs at `:308-385`.
- Active-profile model edits are mirrored back into the active profile via `mirrorToActiveProfile()` at `:255-260`; direct assignment uses this at `zero-models.ts:1035-1037`.

### Existing subagent provisioning pattern

**File:** `/home/gon/zero/packages/zero-pi/extensions/sdd-agents.ts`

- It generates pi-subagent agent files under `~/.pi/agent/agents/zero/`, sourced from phase prompts and `~/.pi/zero.json`: `sdd-agents.ts:1-13`.
- It declares phase-specific tool allowlists at `:39-58`.
- It renders a frontmatter agent definition with name/model/thinking/tools at `:94-130`.
- It reconstructs provider-qualified `provider/model` when provider is separately stored in config at `:133-155`.
- Extension load generates each agent file at `:220-270`, especially `:231-245`.

### What NODD can reuse vs. must rewrite

**Reusable by composition/copy-with-renaming**

1. The no-`pi-tui` local-interface pattern in `zero-models.ts:22-40`.
2. The pure picker state machine in `zero-models-picker.ts`.
3. Registry grouping and direct-assignment validation from `zero-models.ts:411-541`.
4. Profile parser/transformer behavior from `zero-models-profiles.ts`.
5. The generated-agent-file pattern from `sdd-agents.ts:94-130` and `:220-270`.
6. Test style: zero-pi uses Node’s native runner—`/home/gon/zero/packages/zero-pi/package.json` scripts at `package.json:116-119` run `node --test --experimental-strip-types`.

**Must be rewritten for NODD**

1. All phase/slot types and UI labels:
   - configurable: `default`, `orchestrator`, `explore`, `resolve-uncertainty`, `implement`;
   - visible but non-configurable mechanisms: `authorize`, `classify`, `track`, `close`.
2. Config path and schema: use only `~/.pi/nodd.json`, never `zero.json`.
3. Command identity/help/persistence messages: `/nodd-models`.
4. NODD agent generation: `nodd-explore`, `nodd-resolve-uncertainty`, `nodd-implement` (if generated files are the chosen pi-subagents integration).
5. NODD profiles must be stored only in `nodd.json`; Forge profiles stay isolated in `zero.json`, per clarification decision.
6. Do not inherit zero’s unrelated autotune behavior or six SDD-phase assumptions.

## C. What pi’s extension API really permits

### C1. Blocking pre-execution `tool_call`: **verified**

**Severity: none for the basic gate premise; high for shell-write completeness.**

- The canonical documentation explicitly says `tool_call` is fired “before the tool executes” and “Can block”:
  `/home/gon/.local/share/mise/installs/node/26.2.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:751-754`.
- The actual callback signature is:
  ```ts
  pi.on("tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>)
  ```
  in `dist/core/extensions/types.d.ts:897`.
- `ToolCallEvent` includes built-in `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`, and generic custom-tool calls:
  `dist/core/extensions/types.d.ts:649-691`.
- The real return shape is:
  ```ts
  interface ToolCallEventResult {
    block?: boolean;
    reason?: string;
    terminate?: boolean;
  }
  ```
  at `types.d.ts:779-787`.
- Documentation confirms `{ block: true, reason?: string, terminate?: boolean }` at `extensions.md:761-766`.
- Built-in examples prove the intended use:
  - `/examples/extensions/permission-gate.ts:13-33`;
  - `/examples/extensions/protected-paths.ts:13-29`.

**NODD gate feasibility**

- Direct `write`/`edit` gates are feasible and blockable before mutation.
- A `subagent` delegation tool is a generic custom tool; a NODD `tool_call` handler can recognize and gate it by name/arguments, if pi-subagents is loaded.
- A `bash` tool call can be blocked before running, but arbitrary shell commands encode side effects in text. Exact path-level “first write” protection cannot be inferred reliably from the API alone.

### C2. Post-execution observed result: **verified, but numeric exit code is not exposed**

**Severity: blocker for the exact “captured exit code” claim.**

- `tool_result` fires “after tool execution finishes and before `tool_execution_end` plus final tool result message events” at `extensions.md:815-819`.
- Its typed callback is:
  ```ts
  pi.on("tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>)
  ```
  at `types.d.ts:897-898`.
- The result event includes:
  - `toolName`,
  - `toolCallId`,
  - `input`,
  - `content`,
  - `isError`,
  - `usage`,
  - and tool-specific `details`.
  Evidence: `types.d.ts:692-734`.
- `tool_execution_end` additionally exposes `result: any` and `isError` at `types.d.ts:593-600`.
- Pi runtime passes the actual result’s `content`, `details`, `isError`, and `usage` into `tool_result` at `dist/core/agent-session.js:244-255`.

**Critical limit: bash result does not carry `exitCode`**

- `BashToolDetails` has only `truncation` and `fullOutputPath`, not `exitCode`:
  `dist/core/tools/bash.d.ts:13-17`.
- The built-in bash implementation receives `exitCode`, but for a nonzero result it throws after appending textual `"Command exited with code ${exitCode}"`; on success it returns only `content` and `details`:
  `dist/core/tools/bash.js:323-350`.
- Therefore the extension event exposes observed success/failure through `isError`, rendered command output through `content`, and possibly a full-output path, but **not a typed numeric exit code**.

**Required design correction**

Do not model Fase 3 evidence as `{ exitCode }` extracted from normal `tool_result`; that value is absent. Choose one of these explicit alternatives in design:

1. Record observed success/failure as `isError`, preserving the rendered output and tool-call ID; do not claim a numeric exit code.
2. Use a controlled command wrapper/protocol that emits a parseable signed/sentinel exit field in output, with caveats for crash/timeout/cancellation.
3. Override/wrap the bash tool and retain the exact implementation result shape, only if pi’s built-in-tool override contract and resulting UX/session behavior are tested. This is more invasive and should not be assumed equivalent without a spike.

### C3. Dynamic prompt injection: **verified**

- `before_agent_start` is a first-class hook:
  `extensions.md:893` identifies it as part of agent processing.
- Exact event:
  ```ts
  interface BeforeAgentStartEvent {
    prompt: string;
    images?: ImageContent[];
    systemPrompt: string;
    systemPromptOptions: BuildSystemPromptOptions;
  }
  ```
  at `types.d.ts:525-535`.
- It is registered as:
  ```ts
  pi.on("before_agent_start", handler:
    ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>)
  ```
  at `types.d.ts:883`.
- Handler result may return:
  ```ts
  { message?, systemPrompt? }
  ```
  and returned system prompts chain across extensions, at `types.d.ts:806-810`.
- The official prompt-customizer example returns a replacement `systemPrompt` at `/examples/extensions/prompt-customizer.ts:86-96`.
- The docs note `ctx.getSystemPrompt()` reflects chained changes during this hook at `extensions.md:1067-1080`.

**NODD seam:** derive the current phase, gate status, missing evidence, enabled/disabled switches, and artifact path from NODD state; append/replace only the currently applicable prompt text in this hook. Avoid reproducing the 10 KB ODD renderer.

### C4. Slash command and own subagent

**Slash command: verified**

- Exact API: `pi.registerCommand(name, options)` at `extensions.md:1498-1511`.
- Multiple registrations collide with numeric suffixes, so NODD must own the unique `nodd-models` name: `extensions.md:1500-1503`.
- `/zero-models` provides the direct practical pattern at `zero-models.ts:929-1161`.

**Own subagent: supported by pi-subagents, not by core pi alone**

- Core pi extension API has `registerTool`, but no core `registerAgent` method in `ExtensionAPI` (`types.d.ts:867-940`).
- The zero-pi pattern is file-based pi-subagents agent provisioning:
  - pi-subagents discovers agent files from `~/.pi/agent/agents/**/*.md`, per `sdd-agents.ts:3-13`;
  - zero writes each `zero-<phase>.md` file at `sdd-agents.ts:231-245`;
  - pi-subagents then exposes a custom `subagent` tool, registered at installed source `/home/gon/.pi/agent/npm/node_modules/pi-subagents/src/extension/index.ts:670-716`, especially `:672` and `:716`.
- `pi-subagents` is explicitly required by zero-pi installation docs:
  `/home/gon/zero/packages/zero-pi/README.md:33-40`.

**NODD seam:** generate named NODD agents in a separate namespace and require `pi-subagents` when a configured NODD phase must delegate. Do not claim core pi itself has a “declare subagent” API.

### C5. Persistent session state: **verified**

- Core API provides:
  ```ts
  pi.appendEntry(customType, data?)
  ```
  specifically “for state persistence (not sent to LLM)” at `types.d.ts:938-939`.
- Docs recommend reconstructing state from session branch entries on `session_start`:
  `extensions.md:1850-1868`.
- The working `todo` example reconstructs from tool result entries at `/examples/extensions/todo.ts:105-134`.
- `ctx.sessionManager` is read-only and supports `getEntries()`, `getBranch()`, `buildContextEntries()`, and `getLeafId()` at `extensions.md:973-984`.

**NODD seam:** append compact NODD event/checkpoint entries for session branching/reload recovery, but retain `.nodd/<slug>/` as the feature source of truth per settled decision. The disk artifact is necessary for Forge promotion and cross-session durability independent of one pi session.

## Assumptions rejected or requiring redesign

1. **BLOCKER — numeric exit-code evidence from normal `tool_result` is unsupported.**  
   Evidence: `BashToolDetails` lacks exit code (`bash.d.ts:14-17`); built-in bash converts nonzero code to a thrown error/string (`bash.js:347-350`). The state kernel must not claim it captured a numeric exit code unless a new, tested evidence path is added.

2. **HIGH — arbitrary shell writes cannot be fully classified through core `tool_call`.**  
   The API receives a `bash` command string (`types.d.ts:653-656`), not a filesystem side-effect declaration. A user/model can use redirection, `tee`, scripts, package managers, Git hooks, or child processes. Gate guarantees must say exactly which mutation vectors are covered.

3. **HIGH — parallel tool calls create state-ordering hazards.**  
   Sibling tool calls are preflighted sequentially and executed concurrently; `tool_call` is not guaranteed to see sibling tool results from the same assistant message (`extensions.md:757-758`). A gate cannot rely on a test/read/evidence result generated by a sibling call in that same batch. State transitions must be decided before launch or require a later turn.

4. **MEDIUM — extension load scope must be designed for child agents.**  
   Parent pi extension loading does not by itself prove NODD gates execute inside pi-subagent child processes. The chosen generated-agent/subagent runtime must load NODD’s enforcement extension too, or NODD must explicitly limit enforcement claims to the parent runtime. This needs an integration spike.

5. **MEDIUM — shell-derived SHA evidence also requires an explicit evidence strategy.**  
   Git SHA can be observed only through a successful command’s rendered output or a controlled wrapper; it is not a typed tool-result field. It should be parsed only from an exact NODD-owned command/result contract, not inferred from arbitrary agent prose.

## D. Destination repository state and installation

### Current destination state

- Tracked HEAD contains only `PLAN.md`:
  - commit: `caa2dc3 docs: plan inicial de NODD`;
  - tree: `PLAN.md`.
- There is **no** `package.json`, `tsconfig.json`, source directory, test directory, lockfile, or test runner in `/home/gon/projects/nodd`.
- `.sdd/` and `.pi/` are untracked runtime directories.
- `.pi/.gitignore:1-2` ignores all local content except itself; `.pi/zero-resume.md` identifies itself as a local handoff to keep out of commits (`:1-4`).
- Pi installed version is `0.84.2`; Node is `v26.2.0`.

### Recommended stack

Use a standalone **TypeScript ESM pi package**, modeled narrowly after zero-pi:

- TypeScript files executed directly by pi through jiti: pi docs state TypeScript works without compilation at `extensions.md:154-180`.
- Node native tests with:
  ```json
  "test": "node --test --experimental-strip-types"
  ```
  This is zero-pi’s exact script at `/home/gon/zero/packages/zero-pi/package.json:116-119`.
- Do not add a TypeScript compile pipeline unless packaging/tests need it; zero-pi has no `tsconfig.json`.
- Keep pure domain/gate/state functions separated from pi event registration so Node tests can exercise them without runtime dependencies.
- Use `@earendil-works/pi-coding-agent` as a peer dependency, if imported, as pi package docs require for bundled core packages: `docs/packages.md:167-173`.
- Include only runtime dependencies in `dependencies`, not `devDependencies`, because distributed package installs omit dev dependencies by default: `extensions.md:148-151`.

### Installation form

Pi packages can be installed from npm, Git, or an absolute/local path at `docs/packages.md:22-38`.

For development/local use:

```sh
pi install /home/gon/projects/nodd
```

For a published package:

```sh
pi install npm:<nodd-package>
pi install npm:pi-subagents
```

Project-local installation is available with `-l`, writing `.pi/settings.json`, after trust:
`docs/packages.md:41-45`.

A package should declare `pi.extensions` in `package.json`, as shown in `docs/packages.md:116-134`. The extension list should include, at minimum:

- NODD kernel/gates/prompt extension;
- `/nodd-models` extension;
- optional NODD agent-provisioning extension if NODD generates pi-subagents files.

## Concrete next seams

1. **Create minimal package skeleton** under `/home/gon/projects/nodd`: `package.json`, package extension entrypoints, and Node tests. No zero-pi modifications.
2. **Define the NODD manifest/state schema first**, including the seven visible ODD steps, three configurable worker slots, two global model slots, per-gate flags, escape-hatch events, observed result fields, and artifact version.
3. **Implement the enforcement kernel around `tool_call` and `tool_result`:**
   - direct `write`/`edit` blocking;
   - typed/read-only state observation;
   - exact custom tool handling for `subagent`;
   - explicit conservative policy for `bash`.
4. **Resolve numeric evidence before implementing evidence gates.** Prototype one of the three alternatives above and write a runtime test proving the recorded field is truly observed.
5. **Build `/nodd-models` by adapting—not importing—the zero-model patterns** into an isolated `~/.pi/nodd.json` schema and NODD slot set.
6. **Generate NODD subagent definitions** using the `sdd-agents.ts` pattern only after verifying NODD’s gate extension is available in child runtimes.
7. **Implement promotion as a small, artifact-only converter** from `.nodd/<slug>/feature.md` to `.sdd/<slug>/requirements.md`; leave Forge model configuration solely to `/zero-models`.
8. **Test pi integration end-to-end** with an installed local package:
   - blocked `write`/`edit`;
   - gate escape hatch;
   - observed command success/failure;
   - parallel sibling-call behavior;
   - session reload state reconstruction;
   - generated child behavior;
   - `forge --continue` promotion handoff.

## Unknowns

- Whether pi-subagents child runtimes automatically load a project/package NODD extension is not established by the inspected core-pi docs. This must be empirically tested before claiming all delegated NODD work is gated.
- The accepted product semantics for shell writes have not been decided: fail closed for all bash during protected states, use a command allowlist, override bash, or declare direct file tools as the only enforced mutation vector.
- Numeric exit-code evidence needs a chosen and tested source; the normal `tool_result` API does not provide it.
- The exact `.nodd/<slug>/feature.md` schema, escape-hatch command/form, per-gate flag names, and promotion trigger storage are not yet specified.
- The request mandates ODD parity but does not decide whether NODD must mechanically enforce every detailed ODD clause (e.g. commit conventions/line heuristics) or only the explicit gates settled in `clarifications.md`. The plan should retain the closed scope decisions and avoid inventing further enforcement.
