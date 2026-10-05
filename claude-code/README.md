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
| `/nodd on` / `/nodd off` | El interruptor general: vale para todas las sesiones, también las que ya están abiertas. Apagado no frena nada |
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

## Una declaración por pedido, como en ODD

ODD le pide al modelo que clasifique **cada pedido** antes de escribir. NODD lo
hace igual, pero con código:

- **Al arrancar la conversación** el modelo recibe el protocolo (autorizar,
  explorar, clasificar, registrar, implementar, cerrar) como un bloque de
  contexto `nodd`. No hace falta que lo frenen para enterarse.
- **Cada pedido tuyo borra la declaración anterior** y le agrega al modelo un
  recordatorio que vos no ves. Su primera escritura de ese pedido pide un
  `nodd_declare` nuevo, aunque siga con el mismo slug.
- **No es un pedido nuevo**: la notificación de un agente en background, un
  mensaje de otra sesión, un `/loop`, ni lo que escribís mientras el modelo
  todavía está trabajando. Esos siguen bajo la declaración que había.

Cuesta una llamada a `nodd_declare` por pedido que escribe, y seguir con la
feature del pedido anterior es barato: alcanza con `nodd_declare` y el slug, el
resto se toma de la declaración anterior. Los pedidos que sólo leen no pagan
nada.

**El scratchpad de la sesión no pasa por los gates.** Write y Edit dentro de
`/tmp/claude-<uid>/<proyecto>/<id de esta sesión>/` no piden declaración, ni
siquiera con `intent: read-only`: ahí no se cambia nada del usuario. Un Bash que
escribe ahí sí pasa por los gates, porque NODD no puede saber con certeza a
dónde escribe un comando.

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
- **Los agentes de forge pasan siempre.** Las llamadas de un agente de fase
  `forge:<fase>`, o de algo que ese agente lanzó, no pasan por los gates. Un run
  de forge en curso no apaga NODD en el resto: la sesión principal sigue
  frenada.
- **Los rechazos nombran `/nodd allow <gate>`**, el comando de Claude Code. El
  kernel compartido escribe `/nodd-allow`, que es el de pi, y el mod lo traduce.
- **El interruptor es uno solo.** Cada sesión lo relee antes de cada tool y de
  cada pedido, así que un `/nodd on|off` llega a las sesiones que ya estaban
  abiertas sin reiniciarlas.
- **Agentes de sólo lectura.** Para `authorize` se lee el `tools:` del agente en
  `.claude/agents/` del proyecto y en `~/.claude/agents/`. Sin `Write`, `Edit`,
  `MultiEdit` ni `NotebookEdit` cuenta como de sólo lectura; sin `tools:` hereda
  todo y cuenta como escritor. `Explore`, `Plan` y `claude-code-guide` son de
  sólo lectura.
- **Dónde va `.nodd/`.** Al declarar, el documento va a la raíz del repo git
  donde se está trabajando en ese momento, no a la carpeta donde arrancó la
  sesión. Fuera de un repo, a la carpeta actual.
- **Estado para NERV.** Cada sesión escribe el suyo en
  `~/.local/state/nodd/sessions/<id de sesión>.json`, y NERV lee el de su
  propia sesión. Los archivos no se borran solos (el mod no puede borrar); son
  de ~1 KB cada uno.

## Desarrollo

    ./sync-core.sh            # vuelve a copiar el kernel desde ../src
    ./sync-core.sh --check    # falla si la copia no coincide con src/
    claude plugin validate . --strict
    claude plugin test .

`sync-core.sh` también falla si algo del kernel importa `node:*` o un archivo
de fuera de `src/`: un mod sólo puede importar sus propios archivos.
