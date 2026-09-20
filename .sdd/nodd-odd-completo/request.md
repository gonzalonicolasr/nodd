por eso usemos esa base de odd todo lo que tiene odd mas mejores cosas que se nos ocurran pero eso estaba bueno analiza bien todo hacelo con /forge

Contexto de la conversación previa (el asistente lo agrega como material de trabajo, no reemplaza el pedido):

El proyecto es /home/gon/projects/nodd (@gonrocca/nodd, v0.5.1 publicada). NODD ya porta parte de ODD (Gentleman-Programming/gentle-ai, checkout read-only en /tmp/gentle-ai) convirtiendo prosa del system prompt en gates que bloquean en tool_call.

Lo que se acaba de descubrir investigando la fuente de ODD:
- ODD tiene TRES rutas de implementación, no dos: direct_inline (1-3 archivos), delegated_direct (>=4 archivos para entender, >=2 no triviales para escribir), y optional SDD. NODD hoy tiene inline/tracked/forge, que se parecen pero no fueron verificadas contra la spec.
- La spec canónica es /tmp/gentle-ai/openspec/specs/organic-agent-trigger-rules/spec.md
- Hay ~20 specs más en /tmp/gentle-ai/openspec/specs/ (rdd-*, persona-behavior-contract, engram-protocol-injection, gga, etc.) que NUNCA se revisaron para ver qué más vale la pena portar.
- El "motor" de ODD, /tmp/gentle-ai/internal/components/agentguidance/routing.go, es 52 llamadas a output.WriteString: renderiza prosa al system prompt. No bloquea nada. Los triggers que ODD llama "mandatory, not advisory" no tienen mecanismo detrás.
- ODD declara los triggers de delegación como obligatorios: "executing past a fired trigger inline is a routing defect even if the work succeeds".
- ODD separa explícitamente delegación de SDD: "delegation does not create an SDD lifecycle", "risk alone MUST NOT force SDD", SDD sólo entra por pedido explícito o propuesta aceptada.

Defecto conocido y abierto en NODD, encontrado en esta sesión: el picker de /nodd-models deja asignar 5 slots (default, orchestrator, explore, resolve-uncertainty, implement) pero sólo existen 3 agentes en disco (nodd-explore, nodd-resolve-uncertainty, nodd-implement). default y orchestrator no tienen agente detrás: se asignan y no hacen nada. El picker promete más de lo que el mecanismo entrega, que es exactamente lo que NODD le critica a ODD.

Restricciones vigentes del proyecto: TypeScript ESM sin build step, tests con `node --test --experimental-strip-types` y HOME aislado (TMPH=$(mktemp -d) && HOME=$TMPH npm test), 497 tests verdes hoy. PROHIBIDO importar @earendil-works/pi-tui (ni como import type). Adaptar, no importar desde zero-pi. Cada gate nace con escape hatch y flag individual de apagado. Presupuesto duro del corpus de prosa forwardeada: bloque A 1500 chars, bloque B 2500 chars; hoy inyecta 433 chars. Nunca prometer garantías que el mecanismo no da: verificar cada afirmación del README contra el código. Metodología obligatoria: test RED primero, fix, y verificación por mutación (neutralizar el mecanismo y ver morir tests). Verificar contra el paquete instalado, no sólo leyendo código: los tres bugs críticos aparecieron ahí. Commits Conventional, sin atribución a IA, git commit -- <rutas> con pathspec, nunca --amend.