# NODD para Claude Code

Es el mod de Claude Code de NODD: los mismos gates que en pi frenan una tool
**antes** de que corra, pero adentro de Claude Code. La lógica no está
reescrita: `hooks/core/` es una copia exacta del kernel puro de `../src`
(`claude-code/sync-core.sh` la genera y el test `test/claude-code-core.test.ts`
del repo falla si se desincroniza).

**Viene apagado.** Instalado, no bloquea nada hasta que corras `/nodd on`.

## Instalarlo

Sin tocar tu configuración, para una sesión:

    claude --plugin-dir ~/projects/nodd/claude-code

Siempre, junto a los otros mods (separados por `:`):

    export CLAUDE_CODE_PLUGIN_DIRS="$CLAUDE_CODE_PLUGIN_DIRS:$HOME/projects/nodd/claude-code"

## Comandos

| Comando | Qué hace |
|---|---|
| `/nodd` o `/nodd status` | Si está prendido, la declaración actual, los gates, overrides pendientes y el último rechazo |
| `/nodd on` / `/nodd off` | El interruptor general. Se guarda entre sesiones. Apagado no frena nada |
| `/nodd gates` | Los seis gates: prendido o apagado, quién lo decide y si ya se aplica en Claude Code |
| `/nodd gate <id\|all> on\|off` | Prende o apaga un gate en `~/.pi/nodd.json`, **el mismo archivo que usa pi**: apagarlo acá lo apaga allá. Las demás claves del archivo (models, thinking, profiles) no se tocan |
| `/nodd allow <gate> [motivo]` | Un override de un solo uso: lo gasta el próximo rechazo de ese gate |

## Qué gates aplica

| Gate | En Claude Code |
|---|---|
| `authorize` | activo: con `intent: read-only` no se escribe ni se delega a un agente que pueda escribir |
| `classify` | activo: no hay primera escritura sin `nodd_declare` |
| `track` | activo: en ruta `tracked`/`forge` hace falta `.nodd/<slug>/feature.md`, y `.nodd/**` lo escribe NODD, no el modelo |
| `delegate` | pendiente en Claude Code |
| `evidence` | pendiente en Claude Code (un `nodd_task check` queda registrado como `none (gate disabled)`) |
| `promotion` | pendiente en Claude Code |

Los pendientes igual observan: el kernel cuenta lecturas, escrituras y
delegaciones, así que prenderlos más adelante no arranca de cero.

Prendido, el modelo tiene dos tools: `nodd_declare` y `nodd_task`
(`mcp__nodd__nodd_declare` y `mcp__nodd__nodd_task`).

## Cosas que conviene saber

- **El override es de Claude Code.** `/nodd allow` no escribe
  `~/.pi/nodd-hatch.json`: queda en el store del mod. Si fuera compartido, un
  override pedido acá lo podría gastar un rechazo de una sesión de pi abierta al
  mismo tiempo.
- **Subagentes.** Cada subagente tiene su propio kernel, así sus llamadas no
  inflan los contadores del principal. Arranca con la declaración que tenía su
  padre en ese momento: si el principal declaró, el subagente puede escribir
  dentro de esa ruta; si no declaró nadie, el subagente también se frena (y el
  rechazo le dice que avise o que declare).
- **forge pasa siempre.** Las llamadas de un agente de fase `forge:<fase>` (o de
  algo que ese agente lanzó), y cualquier llamada mientras
  `~/.local/state/forge/state.json` diga que hay un run corriendo, no pasan por
  los gates.
- **Agentes de sólo lectura.** Para `authorize` se lee el `tools:` del agente en
  `.claude/agents/` del proyecto y en `~/.claude/agents/`. Sin `Write`, `Edit`,
  `MultiEdit` ni `NotebookEdit` cuenta como de sólo lectura; sin `tools:` hereda
  todo y cuenta como escritor. `Explore`, `Plan` y `claude-code-guide` son de
  sólo lectura.
- **Estado para NERV.** Después de cada cambio escribe
  `~/.local/state/nodd/state.json`.

## Desarrollo

    ./sync-core.sh            # vuelve a copiar el kernel desde ../src
    ./sync-core.sh --check    # falla si la copia no coincide con src/
    claude plugin validate . --strict
    claude plugin test .

`sync-core.sh` también falla si algo del kernel importa `node:*` o un archivo
de fuera de `src/`: un mod sólo puede importar sus propios archivos.
