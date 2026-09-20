## Status
continue

## Assumptions

- El alcance anterior queda anulado. Este run cubre **NODD completo**: las seis fases de `PLAN.md` §6 (kernel de estado, todos los gates con escape hatch, evidencia observada, promoción a `/forge` y prompt dinámico) y la paridad con el protocolo ODD de `PLAN.md` §3.
- El set canónico de fases de NODD es el protocolo ODD de siete pasos, en este orden y con estos nombres: `authorize`, `explore`, `resolve-uncertainty`, `classify`, `track`, `implement`, `close`.
- `/nodd-models` muestra los siete pasos para hacer visible el protocolo completo, pero sólo configura slots donde NODD delega a un sub-agente y corre un modelo real:
  - configurables: `explore`, `resolve-uncertainty`, `implement`;
  - slots globales: `default` y `orchestrator`;
  - mecanismos no configurables, visibles y marcados como `mecanismo · sin modelo`: `authorize`, `classify`, `track`, `close`.
- Los pasos de mecanismo no reciben slots decorativos: autorización, clasificación, tracking y cierre son gates, contadores y código determinista, no fases que ejecuten un modelo.
- El comando propio se llama `/nodd-models`, convive con `/zero-models` sin colisión y no configura las fases de forge. Cuando NODD promociona a `/forge`, los modelos de forge siguen siendo responsabilidad de `/zero-models`.
- `/nodd-models` será un handler de código determinista, no un prompt para el LLM. Tendrá forma interactiva mediante picker TUI con `ctx.ui.custom`, leyendo el registry de modelos de pi y ofreciendo providers/modelos configurados; también admitirá asignación directa, por ejemplo `/nodd-models implement=provider/model`.
- La configuración de NODD persiste en `~/.pi/nodd.json`, archivo propio separado de `~/.pi/zero.json`; no se pisa ni se reutiliza la configuración de forge.
- La pieza de selección de modelos seguirá el patrón read-only de zero-pi: mapas por fase/slot, picker basado en el registry real de pi, validación de assignments y soporte de perfiles si el diseño de implementación los conserva como parte de la paridad funcional. No se hardcodeará un catálogo como fuente principal.
- NODD se implementará como paquete/extensión propio `nodd`, sin modificar `zero-pi`; la integración con forge será por artefactos y comandos compatibles.
- Forge es una dependencia opcional para la promoción: si está disponible, NODD genera los artefactos compatibles y continúa; si no está disponible, NODD conserva su estado local y reporta que la promoción no puede ejecutarse, sin bloquear el uso básico.
- Los artefactos NODD en disco (`.nodd/<slug>/`) son la fuente de verdad durable. Cortex, Engram y memoria remota quedan fuera del runtime de este run.
- La `N` significa **Non-negotiable**: gates y evidencia observada son obligaciones del sistema, no sugerencias de prompt.
- Todo gate entra con escape hatch explícito y con un flag individual para apagarlo. El flag permite desactivar cada gate de forma independiente, sin retirar los demás gates ni convertir el enforcement en una preferencia implícita.
- El kernel deriva el estado de eventos reales de herramientas; no confía en declaraciones del modelo. Capturará, según corresponda, lecturas, escrituras, delegaciones, comandos con exit code, evidencia, commits y transiciones de fase.
- La evidencia observada requiere resultados reales de herramientas (incluido exit code y, cuando corresponda, SHA); no se podrá marcar una tarea como completada sólo por afirmación del agente.
- La promoción a `/forge` convierte el estado/artefactos `.nodd/<slug>/` en artefactos `.sdd/<slug>/` compatibles y permite continuar con `/forge --continue`; el trabajo ya realizado entra como contexto y no se rehace.
- El prompt dinámico se genera a partir del estado actual y de las reglas aplicables, en lugar de inyectar siempre el bloque completo de prosa ODD.
- El enforcement de esta primera implementación se orienta al runtime pi y a sus `tool_call`; la paridad semántica con ODD no implica enforcement idéntico en otros runtimes.
- `/tmp/gentle-ai` es referencia read-only volátil y no dependencia de build ni de runtime. Sus reglas de ODD se incorporan al diseño/documentación de NODD, no se leen dinámicamente durante la ejecución.

## Non-blocking decisions

- "Completo" no incluye implementación de un baseline automático. La Fase 0 de `PLAN.md` — 8–10 requests reales grabados con ODD instalado y medición manual de violaciones — se trata como no-goal de código y como actividad manual de medición/validación del producto. Su resultado puede calibrar gates posteriormente, pero no bloquea la entrega del paquete.
- El orden de incorporación de gates dentro del build puede seguir siendo incremental, pero el alcance contractual incluye los gates de autorización/read-only, tracking antes del primer write, delegación, evidencia, TDD/evidencia RED cuando aplique, promoción y cierre. Cada gate debe nacer con escape hatch y flag individual, aunque se habilite y mida de a uno.
- Se acepta la tensión entre el alcance completo y el riesgo de `PLAN.md` §7 de introducir gates "de a uno, medidos". El mitigante acordado es: escape hatch desde el día uno, flag de apagado por gate, medición de comportamiento y posibilidad de desactivar sólo el gate mal calibrado sin desarmar NODD completo.
- Los siete nombres ODD son el contrato visible de NODD aunque sólo tres pasos tengan modelos configurables. Esto evita inventar fases paralelas y mantiene trazabilidad con ODD.
- `default` y `orchestrator` son slots globales del comando, además de los tres slots delegados por fase. No se crean slots para las cuatro fases de mecanismo.
- Los perfiles, si se implementan en el picker, guardarán assignments de NODD dentro de `~/.pi/nodd.json`; nunca se compartirán con los perfiles de `zero.json`.
- NODD no duplica el selector de modelos de forge: la configuración de `clarify`, `plan`, `analyze`, `build`, `veredicto` y demás fases propias de forge permanece en `/zero-models`.
- No se agregan las once fases del SDD de gentle-ai ni se copia su binario o dependencia pinneada. La paridad solicitada es con el protocolo ODD de siete pasos y con los mecanismos definidos por NODD.
- No se agrega Cortex, Engram, memoria remota, recuperación semántica ni enforcement multi-runtime en este run.
- No se convierten juicios de tamaño, ambigüedad o riesgo en una selección automática de forge. La promoción ocurre por observables definidos por NODD, por solicitud del usuario o por el veredicto de gates según el diseño de `PLAN.md`.

## Blocking questions
