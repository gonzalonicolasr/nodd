# NODD — plan

> **N**on-negotiable **O**rganic **D**riven **D**evelopment.
> El workflow de todos los días: lo que ODD propone, pero impuesto con código y
> con escalada real a `/forge`.

Relevado el 2026-09-18 sobre `Gentleman-Programming/gentle-ai` (clon `--depth 1`
de `main`) y `~/zero/packages/zero-pi` 0.1.78.

---

## 1. Tesis

ODD es una buena idea con una implementación de una sola capa: **un string
builder**. `internal/components/agentguidance/routing.go` (121 líneas) concatena
~10 KB de prosa y los inyecta en el system prompt. No hay nada más — ni
observador, ni contador, ni gate. Su propia doc lo dice:

> "ODD adds shared agent guidance, **not a new CLI, state engine, or mandatory
> planning phase**." — `docs/usage.md`

NODD conserva **todo** el contenido de ODD y cambia tres cosas:

| | ODD | NODD |
|---|---|---|
| Cumplimiento | prosa, buena fe del modelo | `tool_call` bloqueante |
| Evidencia | el modelo declara "Evidence: tests pass" | exit code y SHA capturados del tool result |
| Escalada | muro: SDD es otro sistema de artefactos | promoción: los artefactos se convierten |

---

## 2. Por qué ODD falla (evidencia del repo)

**El equipo ya lo diagnosticó.** En `odd/tasks/odd-mandatory-delegation.md`:

> "ODD routing is pure model judgment: nothing requires the route decision to be
> stated, recorded, or checked, **so non-delegation is invisible**."

El fix que aplicaron fue agregar más párrafos al prompt. Prosa para arreglar prosa.

**El ratchet no escala.** `orchestrator_drift_ratchet_test.go` documenta que el
contrato vive en 12 casi-duplicados a mano: de 21 subsecciones compartidas
**sólo 2 son byte-idénticas**, y "Delegation Rules" tiene **11 variantes en 11
runtimes**. Hay un `.refusal-ratchet-baseline.txt` de 106 KB de cicatriz.

**Sus tests no prueban lo que importa.** Pinean el *texto* del prompt. Textual:
"Instruction tests establish delivery, **not autonomous compliance**".

**La ironía que define todo.** Tienen un error dedicado y fail-closed
(`ErrUnloadableGuidance`) para garantizar que el texto *llegue*: "Silently
installing unread guidance is the exact failure this component exists to
prevent." Toda la ingeniería está del lado del correo; ninguna del lado del
cumplimiento.

---

## 3. Paridad: todo lo que ODD tiene, en NODD

Los 7 pasos del protocolo, más lo transversal. Ninguno se pierde.

| # | ODD (prosa) | NODD (mecanismo) |
|---|---|---|
| 1 | Authorize — read-only queda read-only | Request clasificado read-only ⇒ `write`/`edit` **bloqueados** |
| 2 | Explore proporcional al pedido | Igual, pero delegable a `zero-explore` (modelo barato ya afinado) |
| 3 | Resolver incertidumbre: research opcional, 1 pregunta, 1 challenge | **Mejor en forge**: `zero-clarify` ya cubre superficie de producto (reglas, edge cases, no-goals, tradeoffs) |
| 4 | Classify — sustancial = 2+ pasos o progreso recuperable | La *declaración* es obligatoria: sin ruta declarada no hay primer write |
| 5 | **Track before the first write** | Gate duro: sin `.nodd/<slug>/feature.md` el primer write se bloquea |
| 6 | Implement task by task + work-unit commits | Igual, con evidencia capturada (comando, exit code, SHA) |
| 7 | Close — outcome, checks fallados, next step | Igual, y no se puede declarar verde sin evidencia real |

Transversales:

| ODD | NODD |
|---|---|
| Triggers de delegación (4+ mapping, 2+ writer, backstop 20 calls) | Contadores reales desde tool events; bloqueo al cruzar el umbral |
| Heurística ~400 líneas por tarea | Igual, medida de verdad sobre el diff (no estimada por el modelo) |
| Delivery strategy + chained PRs | Se apoya en `/zero-pr` y `/zero-branch`, que ya existen |
| RDD: tiers de riesgo y consentimiento | Reemplazado por `veredicto` de forge en la escalada; en NODD chico, checks comunes |
| Modo TDD (source + runner, RED→GREEN) | RED **observado**: exit code ≠ 0 real antes de habilitar edits de implementación |
| Resume: leer doc + memoria y reconciliar | Estado derivado de artefactos, igual que `/forge --continue` |
| SDD como rama explícita | `/forge` como rama, con **promoción** de artefactos |

Los umbrales salen de un manifest (`1-3` inline, `4+` mapping, `2+` writer) —
robado tal cual de `capabilitymanifest/manifest.go`. **La diferencia es que en
NODD ese struct alimenta un comparador, no un `Fprintf`.**

---

## 4. El diferencial: escalada a forge

### En gentle, ODD→SDD es un muro

ODD guarda `odd/tasks/<feature>.md`. Su SDD usa `openspec/changes/<change>/` con
11 fases y un binario Go pinneado por SHA-256. Cambiar de uno al otro es
**empezar de nuevo en otro sistema de artefactos**. Por eso tienen que prohibirlo
como default:

> "Size, ambiguity, or risk alone never selects SDD."

No es una decisión de diseño. Es que la transición sale carísima.

### En NODD, la escalada es una promoción

`orchestrator.md:65` — el estado de forge **son los artefactos del repo**:

> "Resume uses the `.sdd/<feature-slug>/` artifacts — `requirements.md`,
> `design.md`, and `tasks.md` with its `[ ]`/`[x]` checklist."

Entonces promover es **escribir artefactos con forma de forge**:

```
.nodd/<slug>/feature.md          .sdd/<slug>/requirements.md
  objetivo, problema, scope   →    (requisitos)
  constraints                 →    (constraints)
  tareas [x] ya hechas        →    contexto: "ya resuelto, no rehacer"
                                 (design.md y tasks.md ausentes a propósito)
```

Y después corre `/forge --continue <slug>` sin más. Su propio algoritmo de
resume ve que falta `design.md`, clasifica el run como `no-plan` y **arranca en
`plan`**. El trabajo ya hecho entra como contexto, no se rehace.

**Cero modificaciones a zero-pi.** NODD escribe archivos; forge los lee con el
código que ya tiene. Es la razón por la que esto es posible y en gentle no.

### Cuándo promueve

No por tamaño (ese es el error de ODD al revés). Promueve cuando el gate observa
algo que NODD no puede resolver:

- el veredicto de una tarea falla dos veces seguidas → el plan está mal, no el código
- la tarea toca más archivos de los que el writer declaró → el scope estaba mal entendido
- el usuario lo pide

Las tres son **observables**, no juicios del modelo.

---

## 5. Arquitectura

Extensión de pi, paquete propio. Cuatro piezas:

**a. Manifest** — umbrales en un struct, como gentle. Única fuente de verdad.

**b. Kernel de estado** — escucha `tool_call` y acumula por sesión: archivos
leídos, archivos escritos, delegaciones, corridas de test con su exit code,
commits. Es el paso 6 que ODD no tiene.

**c. Gates** — `tool_call` puede devolver `{ block: true, reason }`. Cada regla
de ODD que hoy es prosa se evalúa acá contra el estado real.

**d. Prompt dinámico** — `before_agent_start` inyecta **sólo el estado actual y
las reglas que aplican ahora**, no 10 KB fijos. ODD paga el muro entero incluso
en "¿qué hace esta función?".

Lo que se roba de gentle sin cambios: manifest de umbrales → renderer → merge por
sección marcada → idempotente → escritura atómica. El circuito de *delivery* de
ellos está bien resuelto.

Lo que se roba de forge: los sub-agentes por fase, `/zero-rounds` (contador
durable), `/zero-pr`, `/zero-branch`, `/zero-validate`. Por composición, sin
tocar el paquete.

---

## 6. Plan de ejecución

**Fase 0 — Baseline medible.**
8-10 requests reales grabados con ODD instalado, contando cuántas veces el modelo
se saltea cada paso. Sin esto, "mejor" es opinión.
*Verificar: tabla de violaciones por paso.*

**Fase 1 — Kernel de estado.**
Extensión que acumula estado desde tool events reales. Read-only, no bloquea nada.
*Verificar: el estado coincide con lo que pasó de verdad en una sesión grabada.*

**Fase 2 — Gates, de a uno.**
(a) track-before-write, (b) lock read-only, (c) trigger de delegación. Cada uno
con **escape hatch explícito** — un gate que se equivoca es peor que ningún gate.
*Verificar: los casos del baseline de Fase 0 ahora se bloquean.*

**Fase 3 — Evidencia observada.**
El feature doc lo escribe la extensión con datos reales. Tildar sin evidencia se
vuelve imposible.
*Verificar: intentar tildar una tarea sin corrida de test → rechazado.*

**Fase 4 — Promoción a forge.**
El conversor `.nodd/<slug>/` → `.sdd/<slug>/requirements.md` y el disparo de
`/forge --continue`.
*Verificar: un run NODD a medias promueve y forge arranca en `plan` sin rehacer
lo hecho.*

**Fase 5 — Prompt dinámico.**
*Verificar: tokens contra ODD sobre el mismo set de requests.*

---

## 7. Riesgos

- **Un gate mal calibrado es peor que ningún gate.** Si bloquea de más, el agente
  pelea y el usuario se traba. Mitigación: escape hatch desde el día uno, y los
  gates entran de a uno, medidos.
- **"Clasificar si es sustancial" no se mecaniza.** Lo que sí se puede es hacer
  obligatoria la *declaración*. Deja de ser invisible — que es exactamente el
  agujero que gentle admite tener.
- **El enforcement es específico del runtime.** pi bloquea con `tool_call`;
  Claude Code usa hooks; Codex/opencode difieren. Multi-runtime es justo lo que
  llevó a gentle a las 11 variantes. **pi primero y bien.**

---

## 8. Decisiones abiertas

1. **Ubicación** — asumo paquete propio (`nodd`), sin tocar `zero-pi`. Se compone
   con forge por artefactos y comandos. ¿Confirmás?
2. **Dependencia de zero-pi** — la promoción necesita `/forge` instalado. ¿NODD
   lo declara como requisito, o degrada a "NODD solo" si no está?
3. **Memoria** — ODD espeja todo a Engram. ¿Atamos a Cortex, o el feature doc en
   disco alcanza como fuente de verdad? (forge ya usa artefactos, y funciona.)
4. **La N** — *Non-negotiable* es mi voto, porque es literal la tesis.

---

## 9. Lo que NO copiamos de gentle

- El binario pinneado por SHA-256 como dependencia dura.
- Las 11 fases de su SDD.
- El ratchet de prosa: cada falla del modelo agregando una cláusula al prompt.
  Es el anti-patrón central. Si un gate hace falta, es código, no un párrafo.
