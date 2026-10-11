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
| `evidence` | activo: `nodd_task check` sólo tilda si NODD vio el runner declarado salir bien después de la última escritura. Un Bash con exit distinto de 0, interrumpido, pasado a segundo plano o con su status escondido (`\| tail`, `\|\| true`, `;`) no cuenta |
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
siquiera con `intent: read-only`: ahí no se cambia nada del usuario. Un Bash
también, cuando NODD puede probar que todo lo que escribe cae ahí: un `mkdir`,
`touch`, `rm`, `tee` o `cp` con destino en el scratchpad, o una redirección a un
archivo de ahí, incluso a través de una variable asignada en el mismo comando
(`S=…/scratchpad; mkdir $S/x`). Un `mv`, un intérprete, `sed -i`, una ruta
relativa o un `..` siguen pasando por los gates.

## Lo irreversible no lo corre el modelo

Con NODD prendido, un Bash irreversible se frena **siempre**, también dentro de
un agente de forge (que no pasa por los otros gates): `git reset --hard`,
`git clean -f`, `git checkout -- .`, `git restore .`, `rm -rf` fuera del
proyecto, del home de la sesión y de `/tmp`, `terraform destroy`,
`kubectl delete`, y `DROP`/`TRUNCATE` contra una base que no es local. Cuando
hay una forma segura, el rechazo la nombra primero: `git reset --keep`,
`git stash`, `git clean -n`. El
rechazo le dice al modelo que te pida correrlo con `! <comando>`, o vos lo
habilitás una vez con `/nodd allow destructive`.

Medido sobre una semana de comandos reales: frena 45 de 17.162, todos
destructivos de verdad. Una base local (`-h 127.0.0.1`, `localhost`) se puede
borrar sin aviso, porque es el caso de las bases de test descartables.

## Cierre observado

Al terminar cada turno en el que se escribió algo, NODD agrega una línea debajo
de la respuesta con lo que **vio**, no con lo que el modelo dice:

    ◆ NODD · auth · 3 archivos · ✓ `npm test` verde después de la última escritura

o, cuando algo no cierra:

    ◆ NODD · auth · 2 archivos · `npm test` sin correr después de la última escritura
      ⚠ la respuesta afirma «listo», pero NODD no vio `npm test` completo y verde después de la última escritura
      ⚠ src/a.test.ts: se agregó .skip(
      ⚠ 1 archivo fuera de lo declarado: src/extra.ts

Distingue un verde de la suite declarada, un verde parcial (`npm test -- un.test.ts`),
una corrida roja y una corrida que escondió su exit status. Cuando el status
quedó escondido (`| tail`, `; echo "exit=$?"`), lo lee del resumen del runner o
del `$?` impreso y lo muestra como "verde según el resumen". Un `cd … &&` delante
del runner no cuenta: `cd ~/x && npm test` es el runner `cd /home/gon/x && npm test`.

Sólo marca la afirmación que tiene contexto de tests ("pasan los tests", "suite
verde", "all tests pass", "veredicto: pasa"); un "listo" genérico se marca sólo
si hay runner declarado. Sin runner, cualquier corrida de tests verde observada
(incluido `gh pr checks`) la respalda. Escribir docs, la memoria de Claude o el
scratchpad después del verde no lo invalida, y un pedido que sólo tocó docs no
tiene nada que verificar. Para el cierre, un Bash invalida el verde sólo si
escribe un archivo de código que NODD puede nombrar: una redirección, `cp`, `mv`,
`tee`, `rm`, `sed -i`, un `open(…, 'w')` de Python, `git apply`/`merge`/`restore`/
`checkout --`, o un formateador con `--fix`/`--write`. Resuelve el `cd` y las
variables del mismo comando. Un `git commit`, un `git checkout <rama>`, una
escritura a `/tmp` o un script que corre no lo invalidan acá. El gate `evidence`
sigue siendo estricto: para tildar una tarea, cualquier Bash que escribe después
del verde lo invalida. Avisa además cuando
un test se editó entre una corrida roja y la verde, cuando se le agregaron
`.skip`/`.only`/`xit`/`t.Skip`/`@pytest.mark.skip` o se le sacaron assertions,
y cuando se escribió fuera de los `files` declarados. Los avisos le llegan al
modelo con tu pedido siguiente. Junta lo que escribieron y corrieron la sesión
principal y sus subagentes desde que empezó el pedido, incluidos los agentes de
forge: no pasan por los gates, pero lo que hacen se observa, así que un
`VEREDICTO: pasa` sin una corrida verde observada queda marcado.

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
