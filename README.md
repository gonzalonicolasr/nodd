<p align="center">
  <a href="https://nodd.ceroclawd.com">
    <img src="https://nodd.ceroclawd.com/img/fig1.jpg" alt="Grabado de 1893: el peristilo y la cuadriga de la Exposición Colombina de Chicago — una entrada monumental por la que no se pasa sin permiso" width="100%">
  </a>
</p>

<p align="center">
  <sub><em>fig. 1 — la entrada · 1893 · sin delegar, <strong>no pasás</strong></em></sub>
</p>

<h1 align="center">NODD</h1>

<p align="center">
  <strong>N</strong>on-negotiable <strong>O</strong>rganic <strong>D</strong>riven <strong>D</strong>evelopment<br>
  <em>The ODD protocol as runtime mechanism for pi — not injected prose.</em><br>
  <em>El protocolo ODD como mecanismo, no como prosa inyectada.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@gonrocca/nodd"><img alt="npm" src="https://img.shields.io/npm/v/@gonrocca/nodd?color=0b7285&label=npm"></a>
  <img alt="tests" src="https://img.shields.io/badge/tests-594%20passing-0b7285">
  <img alt="gates" src="https://img.shields.io/badge/gates-6-0b7285">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-666">
</p>

<p align="center">
  <a href="https://nodd.ceroclawd.com"><strong>nodd.ceroclawd.com</strong></a> ·
  <a href="https://github.com/gonzalonicolasr/nodd">GitHub</a> ·
  <a href="https://www.npmjs.com/package/@gonrocca/nodd">npm</a> ·
  <a href="https://github.com/gonzalonicolasr/nodd/issues">Issues</a>
</p>

---

> **ODD tells the model to delegate. NODD does not let it not delegate.**
>
> **ODD le pide al modelo que delegue. NODD no lo deja no delegar.**

**EN** — ODD writes its rules into the prompt and trusts the model to follow
them; its own notes admit the gap: *"non-delegation is invisible"*. NODD makes
it visible. Six gates run on `tool_call` and refuse the write **before** it
happens.

**ES** — ODD escribe sus reglas en el prompt y confía en que el modelo las
cumpla; el propio ODD admite el agujero: *"non-delegation is invisible"*. NODD
lo hace visible. Seis gates corren en `tool_call` y rechazan la escritura
**antes** de que ocurra.

|  | ODD | NODD |
| --- | --- | --- |
| Rules live in / Las reglas viven en | the prompt | `tool_call` |
| Non-compliance is / Incumplir es | invisible | refused + remedy |
| Done when / Hecho cuando | the model says so | NODD **saw** the runner pass |
| 56 ODD clauses / 56 cláusulas | 56 prose | **44 mechanized** + 10 prose |

The 10 stay prose on purpose: *"did I explore enough?"* is not observable, and
forcing it into a number would be the very sin NODD accuses prose of.

Esas 10 quedan como prosa a propósito: *"¿exploré lo suficiente?"* no es
observable, y mecanizarlo sería el mismo pecado que NODD le critica a la prosa.

### Quick start

```bash
pi install npm:@gonrocca/nodd
```

Nothing to configure — every gate is on. / Nada que configurar: todos los gates
arrancan prendidos.

```
nodd_declare  slug: dark-mode  intent: change  route: tracked
              runner: "npm test"
→ .nodd/dark-mode/feature.md created

 write src/theme.ts  → blocked: no route declared     (before the declaration)
 write src/theme.ts  → allowed                         (after it)
 check T1            → blocked: no observed run of `npm test`
```

**Source / Código:** [github.com/gonzalonicolasr/nodd](https://github.com/gonzalonicolasr/nodd) — MIT.

**Jump to / Ir a:** [Install](#install) · [Using it](#using-it) ·
[The gates](#the-gates) · [Commands](#commands) ·
[Parity matrix](#the-mpf-parity-matrix)

**Full reference / Referencia completa:**
[`docs/reference.md`](https://github.com/gonzalonicolasr/nodd/blob/master/docs/reference.md)
— enforcement scope, the bash gate, model slots, flags and the kill switch,
deliberate divergence from ODD, and known limitations.

---

ODD's failure was promising compliance while shipping delivery. This file is
where NODD refuses to repeat it: everything below states what is mechanized,
what is only advice, and what is not carried at all.

<details>
<summary><strong>How this README is kept honest</strong></summary>

<br>

`test/readme-contract.test.ts` holds part of that line mechanically: it fails if
the README names a gate, a module or a command that does not exist, drops a
canonical step, quotes a matrix total that disagrees with the matrix, or lets
the bash, enforcement-scope, resume and kill-switch sections stop stating their
limits. It does **not** parse English: a newly written sentence promising more
than the code does will not turn it red. Prose added next to a fix is therefore
the known way this document can drift ahead of the product, and the defence is
review, not the suite. Round 3 found three such sentences and closed them.

</details>

## Install

```bash
pi install npm:@gonrocca/nodd
```

Global installation is the path enforcement is verified on. A pi-subagent child
process does its own ambient discovery and finds installed packages, so gates
also run inside delegated work — see **Enforcement scope** for what that does
and does not cover. `pi -e npm:@gonrocca/nodd` runs the package for one session
without installing it, and in that mode children do **not** load it: the parent
is gated and delegated work is not.

Install into one project instead of the whole account with `-l`, which writes
`.pi/settings.json`. Remove with `pi remove npm:@gonrocca/nodd`.

Nothing is configured after install: every gate is on, the flags are documented
under **Flags, the kill switch and the escape hatch**, and model slots keep
pi's defaults until `/nodd-models` is run.

## Using it

NODD runs on its own. A normal session looks like this:

**Read-only work stays read-only.** Ask a question and nothing changes. Declare
intent `read-only` and a write is refused by `gate-authorize`.

**Substantial work is declared before the first write.** The agent calls
`nodd_declare` with the slug, the route, the files and — this is the part worth
caring about — the `runner`: the command a checkoff will be measured against.

```
nodd_declare  slug: dark-mode  title: "Dark mode"  summary: "Theme the editor"
              intent: change  route: tracked
              runner: "npm test"  tdd: strict  files: [src/theme.ts]
→ .nodd/dark-mode/feature.md created with 0 tasks
```

Until that file exists, the first write is refused. The refusal says what to do
about it.

**Tasks are checked off with observed runs, not with claims.** `nodd_task` marks
an item done only when `gate-evidence` finds four facts lined up: a success, of
the declared runner, after the task's last write, with a RED before it under
strict TDD. A model writing "all tests pass" changes nothing — the evidence line
in the document is rendered from the observed tool result, never from prose.

**When a gate is wrong, turn it off.** `/nodd-gates disable track` disables it
entirely and stays disabled; `/nodd-allow track` grants exactly one override.
Neither is argued with.

**When the work outgrows NODD, promote it.** `/nodd-promote dark-mode` writes
`.sdd/dark-mode/requirements.md` and `/forge --continue dark-mode` starts at its
plan phase with the finished work as context.

To watch it work on something disposable, run `pi` in an empty git repo and ask
for a two-file change: the declaration is demanded before the first write, and
the first checkoff without a real test run is refused.

## The seven canonical steps

`authorize` → `explore` → `resolve-uncertainty` → `classify` → `track` →
`implement` → `close`.

Four of them — `authorize`, `classify`, `track` and `close` — are **mechanism
steps**: they run no model and cannot be assigned one. `/nodd-models` shows them
as `mecanismo · sin modelo` and refuses an assignment. The other three are the
steps where a model actually does work.

## The gates

| gate | fires on | refuses when |
| --- | --- | --- |
| `gate-authorize` | writes, mutating bash, delegation to a writer | intent was declared `read-only` |
| `gate-classify` | the first write | nothing was declared at all |
| `gate-track` | the first source write on a `tracked`/`forge` route | no feature doc exists yet |
| `gate-delegate` | writes and mutating bash | the mapping, writer or long-session threshold fired and nothing was delegated |
| `gate-evidence` | checking a task off | the declared runner was not observed succeeding after the task's last write |
| `gate-promotion` | writes | the work diverged from what was declared |

Every refusal names what was observed, the action that unblocks it, and a
one-shot `/nodd-allow <gate>` escape hatch. A gate that blocks without naming
the exit is a dead end, so `src/gates/policy.ts` makes the remedy a required
field rather than an encouraged one.

## The M/P/F parity matrix

Every clause of ODD's guidance surface is classified as exactly one of:

- **(M)** mechanized — a gate or module enforces it;
- **(P)** forwarded prose — kept as injected text, with a stated reason why it
  cannot be mechanized;
- **(F)** out of scope — not carried, with a stated reason.

The full row-by-row matrix lives in `.sdd/nodd/requirements.md` under
`REQ: odd-parity-matrix`. Its `(P)` rows are implemented as data in
`src/odd-prose.ts` — one entry per row, tagged with the canonical step it
belongs to — and a test asserts the two stay in correspondence.

**A `(P)` reason may never be "we did not get to it."** A clause with no stated
obstacle is a mechanism someone skipped, and a test rejects that wording.

The two most load-bearing `(P)` clauses:

- **The preparation trigger** (`routing.go:81`). Reading that prepares a write
  should be delegated too — but intent-to-write is not visible in a read event.
  NODD ships no `prepare` gate, and a test asserts no gate id contains `prepar`:
  a mechanism here would have to guess intent, and a gate that guesses is worse
  than prose that admits it.
- **The ~400-line advisory** (`routing.go:95`), with its full anti-gaming
  sentence. A line count measures typing, not correctness. Mechanizing it would
  make the number an objective to optimize against — which is exactly what the
  clause forbids. A test asserts no gate consults a line count.

### Not carried from ODD

| clause | why not |
| --- | --- |
| Engram/Cortex memory mirror | out of scope by decision; NODD's durable truth is `.nodd/<slug>/` on disk |
| `gentle-ai review assess` tiers, consent ceremony, preflight STATUS | depends on the `gentle-ai` binary, which is deliberately not copied. A test asserts no code path invokes it. NODD's analogue is forge's `veredicto` phase |
| push / PR creation / merge | these remain the user's decisions. No gate and no tool in NODD pushes, opens a PR or merges, and a test asserts no code path runs them |

## Commands

| command | does |
| --- | --- |
| `/nodd-gates [status\|on\|off] [<gate>]` | inspect and set gate flags |
| `/nodd-allow <gate>` | grant a one-shot override |
| `/nodd-models [<slot>=<provider>/<model>\|profile …]` | assign models per slot; no argument opens the picker |
| `/nodd-promote <slug>` | hand a feature to `/forge` |

`/nodd-promote` writes exactly one file, `.sdd/<slug>/requirements.md`, and
deliberately emits no `design.md` and no `tasks.md` so forge's resume lands on
`no-plan` and restarts at its plan phase. It refuses to overwrite an existing
`requirements.md`, and it is the only module in the package permitted to write
under `.sdd/` — a test scans every other source file to keep it that way.

Forge is an optional dependency. When it is absent, the artifact is still
written and the exact command to run by hand is reported.
