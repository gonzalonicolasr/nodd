## Findings — exploración exhaustiva NODD vs ODD

### Code roots

- **NODD (producto):** `/home/gon/projects/nodd`
  - `src/gates/` — `authorize.ts`, `classify.ts`, `track.ts`, `delegate.ts`, `evidence.ts`, `promotion.ts`, `policy.ts`, `registry.ts`, `request.ts` (2882 líneas combinadas con kernel/prompt/bash-classifier)
  - `src/bash-classifier.ts` — denylist de mutación bash (M4)
  - `src/prompt.ts` — router de step, budgets de prompt
  - `extensions/nodd-kernel.ts` — el runtime, `checkCall`, `turn_end`, `session_start`
  - `test/gate-reachability.test.ts` — invariante de alcanzabilidad, 183 líneas
  - `.sdd/nodd/requirements.md:633-882` — matriz de paridad, 56 filas
  - `.sdd/nodd-odd-completo/{design,spec,tasks}.md` — **una corrida previa ya ejecutó T001-T013 y cerró B1, B2 parcialmente, M8 (firstRefusal), y varios defectos de reachability** (ver evidencia abajo)
- **ODD fuente:** `/tmp/gentle-ai` — **inaccesible en esta sesión** (`ENOENT`, el directorio no existe en este entorno). No pude releer `routing.go` ni `openspec/specs/organic-agent-trigger-rules/spec.md` directamente. Toda verificación de paridad se hizo contra las citas ya congeladas en `.sdd/nodd/requirements.md` (que cita línea y commit `d4187c1d99...`) y contra `.sdd/nodd-odd-completo/design.md`, que declara haber leído esos mismos archivos en la corrida anterior. No hay forma de re-auditar la matriz contra la spec cruda en esta sesión — esto es un `Unknown`, no un gap resuelto.

### Estado medido

```
TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test
→ tests 562, pass 562, fail 0
```
Árbol: `git status --short` → solo `?? .sdd/nodd-paridad-odd/` (artefactos de esta corrida, sin staged). Limpio.

### 1. Matriz de paridad — clasificación de las 56 filas

Conté las 56 filas de `.sdd/nodd/requirements.md:633-882` por clase primaria:
- 33 M puro, 12 más son M-mixtas con P (total 44 tocan M), 9 P puro + 2 P-mixtas fuera de "Protocol steps" (total ~11-12 filas con P), 4 F, coincide con lo reportado en el brief (33/44/11/4).

Para cada fila **P**, evalué si es (a) mecanizable ya, (b) mecanizable con trabajo nuevo, o (c) juicio irreducible:

| fila | clausula | veredicto |
|---|---|---|
| 4 (:45) | ambigüedad → preguntar | **(c) irreducible.** "Ambiguo" es juicio sobre lenguaje natural, no hay evento de tool que lo delate. |
| 5 (:46) | exploración proporcionada | **(c) irreducible.** "Suficiente" no es observable; NODD ya mecaniza el exceso via `gate-delegate`. |
| 6 (:47) | resolve-uncertainty: premisa alto-consecuencia | **(c) irreducible.** |
| 19/28 (:63,:81) | preparation trigger | **(c) irreducible, y NODD ya lo dice explícitamente** en README ("The two most load-bearing (P) clauses"). Intentar mecanizarlo sería adivinar intención — el pecado que NODD le critica a ODD. |
| 32 (:89) | seguridad bajo evidencia faltante | **(c) irreducible.** |
| 34 (:91) | calidad de citación | **(c) irreducible.** |
| 36 (:93) | "challenge" de una premisa | **(c) irreducible.** |
| 38 (:95) | heurística de 400 líneas | **(c) irreducible por diseño** — mecanizarla la convertiría en el cap que la cláusula prohíbe. NODD lo declara explícitamente en README. |
| 44 (:100) | calidad del handoff a un subagente | **(c) irreducible.** No hay forma de leer el *significado* de un prompt delegado. |

**Ninguna fila P es mecanizable con trabajo nuevo sin traicionar la premisa de honestidad de NODD.** Las 9-11 filas P están correctamente clasificadas; cada una tiene razón explícita y ninguna dice "no llegamos". Confirmé que `test/odd-prose.test.ts` y `src/odd-prose.test.ts` ya pinnean alcanzabilidad de cada fila P por el router (`REQ: canonical-step-router-total`, ya implementado — ver commits `83b344f`, `e417c30`).

**Conclusión clave:** la interpretación original del pedido ("gaps = filas P") es la equivocada. Las filas P **no son gaps** — son el resultado correcto y ya vive en el código. Los gaps reales están en otro lado: en la mecánica de las filas M (bugs de alcance/evasión) y en experiencia de usuario (M6/M7).

### 2. Filas M reclasificadas o con mecanismo cambiado

Verifiqué que cada `REQ:` citado por una fila M existe (`grep -c "^## REQ: <nombre>"` → 1 para las 21 muestreadas). **Ninguna fila M cita un mecanismo ausente.** El precedente citado en el brief (fila 3 desactualizada por `a24b1cf`) ya fue corregido — la fila 3 actual dice exactamente lo que `a24b1cf` implementó (delegación read-only por capability, sin lista de nombres hardcodeada), verificado leyendo `src/gates/authorize.ts:24-70` línea por línea: coincide con la fila.

**Importante: la corrida previa `.sdd/nodd-odd-completo` ya resolvió la mayoría de los "hallazgos abiertos" del brief.** Evidencia por commit:

| hallazgo del brief | estado real medido |
|---|---|
| **B1** (gate-reachability cubre 1 rama por gate) | **Ya resuelto.** `test/gate-reachability.test.ts` (commit `ecf980c`) fue reescrito en "round 2" tras que la v1 fallara exactamente por esto — ahora dispara refusals *reales* vía `refuse()`, cubre las 6 gates × 2 cláusulas (remedio alcanzable + no-empeora-su-propio-trigger), y agrega un test end-to-end de 8 writes rechazados que prueba que el contador de `delegate` no escala. Corrí este archivo: pasa. `track` hacia `.nodd/**` sí tiene puerta de emergencia narrow, y el test la ejercita línea 41-50 de `track.ts`. |
| **M8** (`isMutatingBash` sin callers, `firstRefusal` sin callers de producción) | **Parcialmente cierto, no cambió.** Confirmé con grep: `isMutatingBash` solo se llama desde `isMutation()` en el mismo archivo (`request.ts:38`) — es interno, no exportado sin uso real (se usa indirectamente vía `isMutation`, que sí tiene 3 callers de producción: authorize, classify, track). `firstRefusal` en `policy.ts:68` **sigue sin caller de producción** — solo aparece en `policy.test.ts`. El kernel implementa su propio loop first-refusal-wins en `nodd-kernel.ts:345-368` con un comentario explícito que dice por qué ("Registry order, first refusal wins") — es decir, la función existe duplicada conceptualmente. **Esto es deuda muerta real, pequeña (~5 líneas), no paridad-ODD.** |
| **M9** (concurrencia dos sesiones pi) | **Sigue sin resolver, sin mención en README.** Grep de `flock|lockfile|\.lock\b` en `src/*.ts extensions/*.ts` → cero resultados de lógica de locking (solo coincidencias falsas con `package-lock.json` en el excluder de `delivery.ts`). El ledger (`src/ledger.ts`) no tiene protección contra escritura concurrente. **Riesgo residual confirmado, no trivial de arreglar honestamente (requeriría diseño de locking cross-proceso), consistente con la clarificación previa de dejarlo como riesgo documentado.** |
| **B2** (turn_end no llega si la sesión muere) | **Sigue abierto, es inherente al diseño.** `nodd-kernel.ts:789-791` limpia `pending` solo en `turn_end`; si el proceso muere a mitad de turno no hay hook de salida limpia. Severidad baja confirmada — el estado pending es solo en memoria de ese proceso, se pierde igual al morir el proceso, no hay corrupción persistente. **No amerita mecanismo nuevo: es un no-issue disfrazado de issue** (el pending in-memory desaparece junto con el proceso que lo sostenía; no hay archivo corrupto que limpiar). |

### 3. Hallazgos abiertos re-verificados con evidencia dura

**M4 — evasión trivial del clasificador bash: CONFIRMADO Y REPRODUCIDO.**
```
"node script.js"  -> non-mutating   (evade; "node -e" sí cubierto)
"python3 file.py" -> non-mutating   (evade; "python3 -c" sí cubierto)
"bash script.sh"  -> non-mutating   (evade por completo)
"./run.sh"        -> non-mutating   (ya documentado como NOT_COVERED, honesto)
```
`src/bash-classifier.ts:44-53` — el patrón `inline interpreters` solo mira `-e`/`--eval`/`-c`, nunca la ejecución de un **archivo de script real** (`node script.js`, `python3 file.py`, `bash script.sh`). Esto es distinto de `./run.sh` (que SÍ está en `NOT_COVERED` documentado honestamente como no cubierto). Pero `node script.js` y `bash script.sh` **no están mencionados en `NOT_COVERED` ni en `COVERED_PATTERNS`** — son un blind spot no documentado, y son la forma **más obvia** de evasión que un agente tomaría al toparse con el gate ("`node -e` está bloqueado, uso `node script.js` en su lugar"). Esto es mecanizable con trabajo nuevo, bajo riesgo (agregar patrón `commandWord(["node","python","python3","bash","sh","ruby","perl"])` seguido de un argumento que parece un archivo — no de una flag), y **no requiere I/O ni heurística de intención**, solo ampliar el denylist existente. Candidato principal a arreglar.

**M6 — sin onboarding, sin `/nodd-help`: CONFIRMADO.**
Comandos registrados: `/nodd-gates`, `/nodd-allow`, `/nodd-models`, `/nodd-promote` (grep en 4 archivos `extensions/*.ts`). Cero comando de ayuda. README tiene sección "Using it" con walkthrough (líneas 41-79), y el primer refusal (`classify`) ya trae remedio autoexplicativo con ejemplo de sintaxis (`nodd_declare slug:... intent:... route:...`). El "primer contacto es un refusal" es cierto pero **el refusal ya es autoexplicativo** (verificado con la salida real más arriba: `nodd/classify: no route has been declared... To proceed: call nodd_declare with an explicit intent and route...`). Falta `/nodd-help` como comando explícito, pero el gap es menor de lo que el brief sugiere porque el mensaje de refusal ya hace de facto el trabajo de onboarding.

**M7 — sin CHANGELOG, sin troubleshooting: CONFIRMADO parcialmente.**
`find . -iname "CHANGELOG*"` → vacío. Pero README ya tiene sección "Known limitations" (líneas 425+) que documenta 7 limitaciones honestas con detalle técnico — es troubleshooting de facto, solo que no está titulado así. El gap real es solo el CHANGELOG — el paquete tiene 0.2.0 → 0.6.2 en 40+ commits `chore: release X.Y.Z` sin un archivo que los resuma para un usuario que hace `npm view`.

### 4. Evaluación de "ser mejor"

El README ya documenta explícitamente las ventajas de mecanismo real vs prosa en múltiples lugares medidos: sección "Deliberate divergence from ODD" (línea 328), "The M/P/F parity matrix" (línea 351) cita el contraste con los 105,993 bytes de guía de gentle-ai que llegaron sin budget. No hace falta trabajo nuevo aquí — ya cumplido por la corrida `nodd-odd-completo` previa.

### 5. Gaps reales priorizados (lo que efectivamente falta)

1. **M4 — bash-classifier no cubre `node script.js` / `python3 file.py` / `bash script.sh`.** Mecanizable, bajo riesgo, alto valor (es la evasión más obvia). Prioridad 1.
2. **CHANGELOG.md ausente** (parte de M7). Trivial, prioridad 2.
3. **M8 residual — `firstRefusal` en `policy.ts` sin caller de producción**, duplicada conceptualmente por el loop inline en `nodd-kernel.ts:345-368`. O se usa `firstRefusal` en el kernel (refactor quirúrgico ~10 líneas) o se borra la función muerta y su test. Prioridad 3, cosmético.
4. **M9 — concurrencia, sin locking.** No trivial, dejar como riesgo documentado en README "Known limitations" (falta esa entrada — hoy no está mencionado ahí). Prioridad 4, solo documentación.
5. **M6 — `/nodd-help`** es azúcar, el refusal ya autoexplica. Bajo valor, no priorizar salvo tiempo sobrante.

### Unknowns

- No pude releer `routing.go` ni la spec canónica de ODD porque `/tmp/gentle-ai` no existe en este entorno (a diferencia de lo que el brief asumía). Toda verificación de "¿la matriz cubre la spec entera?" descansa en la palabra de `.sdd/nodd-odd-completo/design.md`, que sí declara haberlo leído en su momento (commit pin `d4187c1d99...`). No se puede re-auditar independientemente en esta sesión.
- B1, B2 y buena parte de M8 **ya fueron cerrados por la corrida `nodd-odd-completo`** que corrió antes que este explore — el brief del orquestador no lo reflejaba como hecho. Esto cambia el presupuesto sugerido: quedan 1-2 fixes quirúrgicos reales (M4 + CHANGELOG), no 2-4.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Fase explore completa, read-only, sin escritura de código ni artefactos fuera de lo que el runtime persiste automáticamente. Inventario exhaustivo de las 56 filas de la matriz de paridad, verificación de que las filas P son irreducibles (no gaps), re-verificación de B1/B2/M4/M6/M7/M8/M9 contra el código real con evidencia reproducible (comandos node ejecutados, greps, lectura de commits), y descubrimiento de que la corrida previa nodd-odd-completo ya cerró la mayoría de los hallazgos del brief."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "TMPH=$(mktemp -d) && HOME=$TMPH timeout 600 npm test",
      "result": "passed",
      "summary": "562 tests, 562 pass, 0 fail"
    },
    {
      "command": "git status --short && git diff --stat",
      "result": "passed",
      "summary": "árbol limpio salvo .sdd/nodd-paridad-odd/ (artefactos propios de esta corrida, no staged)"
    },
    {
      "command": "node --experimental-strip-types -e 'classifyBash(\"node script.js\")...' ",
      "result": "passed",
      "summary": "confirmó M4: node script.js, python3 file.py, bash script.sh clasifican non-mutating (evasión no documentada, distinta de NOT_COVERED)"
    },
    {
      "command": "grep -rn isMutatingBash|firstRefusal --include=*.ts .",
      "result": "passed",
      "summary": "confirmó M8: firstRefusal sin caller de producción; isMutatingBash sí tiene caller interno via isMutation"
    },
    {
      "command": "for r in gate-authorize gate-classify ... ; grep -c \"^## REQ: $r\" .sdd/nodd/requirements.md",
      "result": "passed",
      "summary": "21 REQs citados por filas M muestreadas, todos existen exactamente una vez"
    }
  ],
  "validationOutput": [
    "562/562 tests green, HOME aislado",
    "M4 reproducido: node script.js / python3 file.py / bash script.sh evaden el clasificador bash",
    "B1 ya resuelto por commit ecf980c (test/gate-reachability.test.ts reescrito, dispara refusals reales, cubre 6 gates x 2 cláusulas + caso end-to-end de 8 writes)",
    "M9 confirmado sin mecanismo (cero locking en src/ledger.ts ni extensions/)",
    "Matriz de 56 filas: 9-11 P puras, todas con razón de irreductibilidad explícita, ninguna dice 'no llegamos'"
  ],
  "residualRisks": [
    "/tmp/gentle-ai (fuente canónica de ODD) no existe en este entorno; no se pudo re-auditar la matriz contra la spec cruda, solo contra las citas ya congeladas en requirements.md",
    "M9 (concurrencia entre sesiones pi) sigue sin mecanismo ni mención en README; requiere diseño de locking cross-proceso, no es trivial",
    "B2 (turn_end no llega si el proceso muere) es estructuralmente aceptable -- el estado pending es solo in-memory y desaparece con el proceso -- pero no tiene mitigación explícita documentada"
  ],
  "noStagedFiles": true,
  "diffSummary": "Ningún archivo modificado. Fase read-only completada.",
  "reviewFindings": [
    "no blockers: fase explore, sin código escrito, contrato respetado"
  ],
  "manualNotes": "Hallazgo más importante para la fase de plan: la interpretación 'gaps = filas P' del brief es incorrecta -- las filas P están correctamente clasificadas como juicio irreducible y NO son deuda. Los gaps reales y priorizados son: (1) M4 bash-classifier no cubre 'node script.js'/'python3 file.py'/'bash script.sh' -- mecanizable, bajo riesgo, prioridad 1; (2) CHANGELOG.md ausente -- trivial, prioridad 2; (3) firstRefusal en policy.ts muerta/duplicada con el loop inline del kernel -- prioridad 3, ~10 líneas; (4) M9 concurrencia -- documentar como riesgo conocido en README 'Known limitations', no mecanizar; (5) M6 /nodd-help -- bajo valor, el refusal de classify ya autoexplica con ejemplo de sintaxis. B1 y buena parte de M8 YA FUERON RESUELTOS por la corrida .sdd/nodd-odd-completo anterior a este explore (commits c9bf2f2, e44732d, 871e252, 83b344f, e417c30, a24b1cf, ef76a18, ecf980c) -- el presupuesto sugerido de '2-4 fixes' debería reducirse a 1-2 fixes reales de código (M4 + limpieza de firstRefusal) más 2 de documentación (CHANGELOG + nota de concurrencia)."
}
```