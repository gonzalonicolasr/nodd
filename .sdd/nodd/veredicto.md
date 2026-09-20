# Veredicto — NODD

- Ronda 1 → `corregir` (B1–B4 bloqueantes + M1 mayor).
- Ronda 2 → `corregir` (B1–B4 y M1 cerrados; 1 hallazgo nuevo: H1).
- **Ronda 3 → `corregir`** (H1 cerrado y los dos hallazgos propios del build cerrados;
  1 bloqueante nuevo: **H2**, 1 mayor nuevo: **H3**).

---

# Ronda 3 — veredicto final del cap

**Veredicto: `corregir`.** Esta era la última ronda, así que el run termina **sin verificar**.

El trabajo de la ronda es bueno y el método es el correcto: el build barrió el README
entero por su cuenta, encontró dos bypasses que yo no le había señalado (re-pineo del
runner y `tdd: strict` sin runner), los cerró con mecanismo, y declaró la limitación que
no podía cerrar en vez de esconderla. Verifiqué los tres a mano, con ataques propios y
variantes: **están cerrados de verdad**.

Pero queda un claim falso, y está en el peor lugar posible: **en el párrafo que la ronda 3
escribió justamente para dejar de sobre-prometer** (`README.md:12-16`). La oración enumera
cuatro cosas que `test/readme-contract.test.ts` detecta. Tres son ciertas. La cuarta —
*"drops a canonical step"* — es falsa para **5 de los 7 pasos**. Es exactamente el ratchet
que el propio build nombra dos líneas más abajo: prosa agregada al lado de un fix, que
promete un poco más que el fix.

No es un hallazgo inventado ni un empate forzado por rigor: borré el paso `close` del
README y la suite quedó **396/396 verde**. Lo reproduje siete veces, una por paso.

---

## Hallazgos nuevos de la ronda 3

### H2 — `README.md:12-16` afirma una detección que el test no hace ⇒ **BLOQUEANTE**

`README.md:12-16` vs `test/readme-contract.test.ts:46-48`

> *"it fails if the README names a gate, a module or a command that does not exist,
> **drops a canonical step**, quotes a matrix total that disagrees with the matrix, or
> lets the bash, enforcement-scope, resume and kill-switch sections stop stating their
> limits."*

El test es `assert.ok(README.includes(step))` — `includes`, sin límites de palabra, sobre
**todo el archivo**. Cinco de los siete nombres de paso sobreviven como substring de otra
palabra en otra parte del README, así que borrar el paso no rompe nada.

Borré de forma independiente cada nombre de paso como palabra suelta y corrí
`readme-contract.test.ts`:

| paso borrado | suite | sobrevive como substring de |
| --- | --- | --- |
| `authorize` | **pasa** ✗ | `authorize` en `gate-authorize` (tabla de gates) |
| `explore` | falla ✓ | — |
| `resolve-uncertainty` | falla ✓ | — |
| `classify` | **pasa** ✗ | `gate-classify` |
| `track` | **pasa** ✗ | `tracked`, `gate-track` |
| `implement` | **pasa** ✗ | `implemented` |
| `close` | **pasa** ✗ | `closed`, `disclosed`, `discloses`, `fail-closed` |

Las dos que sí fallan lo hacen por accidente: son los únicos dos nombres que no comparten
substring con ninguna otra palabra del documento. La protección no existe; coincide.

**Reproducción mínima** (la corrí, tree restaurado después):

```
# borrar el paso `close` de la cadena canónica y de la lista de mechanism steps
`authorize` → `explore` → `resolve-uncertainty` → `classify` → `track` → `implement`.
Three of them — `authorize`, `classify` and `track` — are mechanism steps...

standalone occurrences of `close` in the README: 0
full suite: 396 tests, 396 pass, 0 fail      <-- debería ser rojo
```

Y el caso extremo, borrar la **sección `## The seven canonical steps` completa**, sí falla
— pero por `explore`, no por la sección:

```
✖ the seven canonical steps are documented
  AssertionError: step explore is undocumented
```

O sea: el único escudo real es que dos palabras no tienen homónimos. Un README que pierda
`close`, `track`, `implement`, `classify` o `authorize` de la cadena canónica pasa verde.

No hay otro test que cubra esto: `src/manifest.test.ts:49-53` verifica `MECHANISM_STEPS ⊂
CANONICAL_STEPS` en el código, nunca toca el README.

**Arreglo mínimo (elegir uno):**
1. Que el test resuelva los pasos contra la **sección** (`section(/canonical steps/i)`) y
   con límite de palabra (`new RegExp(\`(?<![\\w-])${step}(?![\\w-])\`)`), verificando además
   el orden de la cadena; **o**
2. Bajar la afirmación: sacar *"drops a canonical step"* de la enumeración de `:12-16` y
   dejar la lista en lo que el test efectivamente hace.

La (1) es la que hace verdadera la oración que ya está escrita, y es ~3 líneas.

### H3 — Fila 23 de la matriz de paridad: "never trip it" es falso ⇒ **mayor**

`.sdd/nodd/requirements.md:704`

> *"`gate-delegate` counts only understanding reads and writer files; **test/build/install
> commands never trip it**"*

Lo trippean. Corrí 25 `npm test` observados en una sesión declarada y el write siguiente
fue bloqueado:

```
write after 25 `npm test` runs:
  nodd/delegate: this session has run 26 tool calls (threshold 20) without delegating.
```

El backstop de sesión larga (`src/gates/delegate.ts:76`, `THRESHOLDS.longSessionToolCalls
= 20`) cuenta **todas** las tool calls, incluidas las de test/build/install. La fila dice
que el gate cuenta "only understanding reads and writer files", y el gate tiene tres
triggers, no dos.

El test que respalda la fila (`src/gates/delegate.test.ts:70-78`) usa **4** comandos —
debajo del umbral de 20 — así que pasa sin tocar el trigger que contradice el claim. El
test es verdadero y la fila es más amplia que el test.

No es una mentira del producto: el README **sí** lista los tres triggers en su tabla de
gates ("the mapping, writer or long-session threshold fired"). Es la justificación de la
fila la que está incompleta, y es una fila `(M)`. Arreglo: reescribir la justificación para
decir que los comandos de test/build/install no son writer files ni understanding reads,
**pero cuentan para el backstop de sesión larga**; o partir la fila en `(M)` + divergencia
declarada, como ya hace la fila 21.

---

## Lo que verifiqué cerrado en la ronda 3 (por ejecución, con variantes propias)

### H1 (ronda 2) — divulgación del runner no pineado ⇒ **CERRADO, y discrimina**

`src/gates/evidence.ts:195` ramifica en `request.runner === null`. Corrí los dos lados a
través del handler registrado:

```
sin runner:  - observed: `echo 'I have verified that all tests pass'` → success (runner not pinned)
             - [x] T1: `echo '...'` → success (runner not pinned)        <- también en ## Outcome
con runner:  - observed: `npm test` → success
             caveat present? false
gate off:    - observed: `none` → none (gate disabled)                   <- sigue distinguible
```

La salvedad llega a **las dos** superficies de evidencia del artefacto (línea de tarea y
`## Outcome`), aparece sólo sin runner, y no pisa el caso `gate disabled`. No es
decorativa. El build eligió la opción (a) del veredicto (implementar la divulgación) en
vez de la (b) (hacer `runner` obligatorio), y justificó por qué: una feature sin pinear
está *permitida pero no enforced*, y un campo obligatorio esconde esa distinción en vez de
comunicarla. Estoy de acuerdo con la elección.

### El bypass de re-pineo ⇒ **CERRADO** (5 ataques, incluidas 4 variantes mías)

| ataque | resultado |
| --- | --- |
| re-declarar con el `echo` como runner tras un checkoff rechazado | **refused**, `npm test` se mantiene, segundo check refused |
| re-pineo con whitespace alrededor (`"  echo hi  "`) | **refused** |
| "despinear" con `runner: ""` y después pinear el `echo` | **refused** — `runner: ""` no borra el pin, el doc sigue en `npm test` |
| re-pinear a `echo` pelado (prefijo que el comando del ataque satisface) | **refused** |
| re-pinear en una **sesión nueva** (resume, estado en memoria vacío) | **refused** — el pin vive en el artefacto, no en RAM |

La última es la que importa: el guard lee `doc.verification.runner` desde disco
(`extensions/nodd-kernel.ts:209`), así que no se evade abriendo otro proceso.
Mutación: cortar el refusal a `if (false)` ⇒ 1 fallo.

### `tdd: strict` sin runner ⇒ **CERRADO** (4 ataques)

```
declare {tdd: strict, sin runner}
  -> nodd_declare: tdd: strict requires a runner, because a RED run is a failing run
     of the declared runner. Declare one, or declare tdd: off.
  -> .nodd/notdd/feature.md written? false      <- no queda documento afirmando strict
```

Variantes: agregar `tdd: strict` más tarde heredando un runner ya pineado **sí** se acepta
(correcto: hay runner) y **sí** enforcea — GREEN sin RED queda refused. La refusal no
escribe documento, que es la mitad que importa: el defecto original era un artefacto que
decía `- tdd: strict` sin nada detrás.

### Las 15 mutaciones del barrido del README ⇒ **muestreé 16, las 16 matan tests**

No confié en la tabla; mutué el mecanismo de producción y corrí la suite completa cada vez.

| mutación | fallos |
| --- | --- |
| tabla de bash: el patrón `mv/cp/rm/...` nunca matchea | 5 |
| kill switch: gate `evidence` deshabilitado fabrica `success` en vez de `none (gate disabled)` | 1 |
| escrituras a `.sdd/`: el kernel menciona una ruta bajo `.sdd/` | 1 |
| gentle-ai: un path de código nombra el binario | 1 |
| push/PR: un path de código contiene `git push` | 2 |
| prepare gate: agregar un gate id con `prepar` | 2 |
| presupuesto/line count: `promotion.ts` gana un identificador de conteo de líneas | 1 |
| frontmatter de agentes: emitir una línea `extensions:` | 1 |
| outcome fail-closed: `unknown` parsea como `success` | 2 |
| protección de `.nodd/**`: `gate-track` deja de detectar escrituras a `.nodd/` | 2 |
| freeze del corpus: sacar `Object.freeze` de `ODD_PROSE` | 1 |
| razón `(P)` = "we did not get to it" | 2 |
| block B: `renderBlockB` devuelve vacío | 5 |
| fuente de status: `/nodd-gates status` deja de reportar el deciding source | 4 |
| promote: sobrescribir un `requirements.md` existente | 1 |
| promote: emitir además un `tasks.md` | 1 |

Ninguna garantía falsa en el muestreo. Y del lado del README, siete de las ocho cláusulas
de `:12-16` mueren cuando las rompo (gate inexistente, módulo inexistente, comando no
registrado, total de matriz en desacuerdo, sección `Not covered` borrada, vector
grandchild borrado, resume sin "re-run", kill switch sin "off means off"). La única que no
muere es la de los pasos canónicos: **H2**.

---

## La limitación declarada: ¿es aceptable para `pasa`?

Reproduje el experimento del build. Inyecté en `README.md`, arriba de `## The gates`:

> *"NODD blocks every filesystem mutation in every process, at any delegation depth.
> No bypass exists: every grandchild is enforced, and no prose is trusted anywhere."*

Resultado: **396 tests, 396 pass, 0 fail.** Cuatro mentiras — todas contradichas por el
propio README treinta líneas después — y ningún test las ve.

**Mi lectura: la limitación es aceptable, y declararla fue lo correcto.** Argumento:

1. Es **estructural, no un atajo**. Verificar mecánicamente que una oración en inglés no
   promete más que el código requiere entender la oración. Ningún test de esta clase de
   proyecto puede hacerlo. La alternativa — enumerar en el test cada claim del README —
   sólo mueve el problema: el claim nuevo no está enumerado.
2. Está declarada **con su mecanismo de entrada nombrado**: "prose added next to a fix is
   therefore the known way this document can drift ahead of the product, and the defence is
   review, not the suite". Eso no es una disculpa genérica; es la ruta exacta por la que
   entraron H1 (ronda 2) y H2 (esta ronda). El build identificó su propio modo de falla
   correctamente.
3. Reemplazó un claim **falso** (*"Every claim here is asserted by
   `test/readme-contract.test.ts`"*) por uno **acotado**. Eso es progreso monótono en la
   dirección que el run mide.

Un defecto declarado explícitamente, con su mecanismo de entrada nombrado, es un resultado
válido de ingeniería. Coincido con la lectura previa. **No es esta limitación la que bloquea.**

Lo que bloquea es que la oración que la declara **comparte párrafo con un claim falso**.
`README.md:12-16` dice, en la misma enumeración, tres cosas verdaderas y una que no. Y el
mecanismo de entrada es literalmente el que el párrafo describe: prosa escrita al lado del
fix. La limitación es honesta; la lista que la precede, no del todo. Arreglar H2 no
requiere cerrar la limitación — requiere que la enumeración diga lo que el test hace.

### `## Known limitations`: honesta, reproducible, y a una entrada de completa

Reproduje cada una de las cinco:

| limitación | reproducida |
| --- | --- |
| feature sin pinear: se divulga, no se enforcea | sí — el `echo` tilda la tarea y la línea dice `(runner not pinned)` |
| `isDeclaredRunner` acepta un flag que redirige el cwd | sí — `npm test --prefix /tmp` → `true`; también `npm test -C /other` → `true` |
| `readLedger` reporta defects que ningún caller lee | sí — `{records: [], defects: ["... not valid JSON, treated as empty"]}`; `nodd-kernel.ts:258` desestructura sólo `records` |
| ningún test parsea el inglés del README | sí — ver el experimento de arriba |
| enforcement en grandchildren nunca medido | sí — `spike/subagent-enforcement/RESULT.md:225` |

Ninguna minimiza. La primera es notablemente dura con el producto ("**but the checkoff does
happen**"), que es la redacción correcta. La segunda nombra la precondición sin usarla como
excusa. **No encontré una limitación escondida que debiera estar en la lista** salvo la que
sigue, menor.

---

## Estado de CADA hallazgo de las tres rondas

| # | hallazgo | estado |
| --- | --- | --- |
| **B1** | `gate-promotion` inerte (no registrado) | **cerrado** (r2; re-verificado: borrar la fila del registry ⇒ 3 fallos) |
| **B1b** | `gate-delegate` inerte — 2º caso, hallado por el build | **cerrado** (r2; borrar la fila ⇒ 2 fallos) |
| **B2** | fail-closed al reanudar; ledger inexistente en producción | **cerrado** (r2) |
| **B3** | evidencia no atada a la tarea ni a la escritura | **cerrado** (r2) |
| **B4** | test anti-ratchet tautológico del presupuesto | **cerrado** (r2; `renderBlockB` vacío ⇒ 5 fallos) |
| **M1** | matriz de paridad sin criterio real | **cerrado** (r2) — pero ver **H3**, una fila `(M)` con justificación más amplia que su test |
| **M2** | `tdd-evidence.md` sin filas T001–T021 | **abierto, declarado** (`tdd-evidence.md:6-8`). No bloquea. |
| **H1** | README prometía divulgación del runner no pineado | **cerrado** (r3, verificado; discrimina, no decora) |
| **r3-a** | re-pineo del runner (hallado por el build) | **cerrado** (r3, verificado con 5 ataques) |
| **r3-b** | `tdd: strict` sin runner (hallado por el build) | **cerrado** (r3, verificado con 4 ataques) |
| **H2** | `README.md:12-16` afirma detectar un paso canónico borrado; no lo detecta en 5/7 | **ABIERTO — bloqueante** |
| **H3** | `requirements.md:704` fila 23: "test/build/install never trip it" es falso | **ABIERTO — mayor** |
| **m1** | `isDeclaredRunner` acepta un flag que redirige el cwd | **declarado como limitación** en `README.md:333-337` ✓ |
| **m2** | `renderPrompt` devuelve `overBudget` y nadie lo consume | **abierto, menor**. El aviso viaja dentro del bloque, así que ningún claim se rompe. Valor de retorno sin consumidor. |
| **m3** | `design.md:525` todavía lista *"3. The user asked"* | **abierto, menor**. Artefacto de plan histórico; `requirements.md` y el README ya lo corrigen. Última copia del claim borrado. |
| **m4** | `readLedger` reporta defects que nadie lee | **declarado como limitación** en `README.md:338-341` ✓ |
| **m5** (nuevo, menor) | `tdd` es degradable en silencio, a diferencia del runner | **abierto, menor**. Re-declarar **omitiendo** `tdd` lo baja de `strict` a `off` sin refusal y sin rastro en el documento, y después el checkoff GREEN-sin-RED pasa. No es un claim falso — el README dice "when the declaration set `tdd: strict`", y tras la re-declaración ya no lo setea — pero es una asimetría con la regla pin-once del runner que la ronda 3 acaba de introducir. Considerar el mismo trato, o nombrarlo en `## Known limitations`. |

---

## Estado general del entregable (fuera de H2/H3, sólido)

- **Suite:** 396 tests, 396 pass, 0 fail. Reproducido; tree limpio tras restaurar cada
  mutación (`git status --short` sólo muestra `.sdd/` y `.pi/` sin trackear; nada staged).
- **Carga del paquete:** las 6 entradas de `pi.extensions` existen y las 6 importan con
  `default = function`. `type: module`, `engines.node >= 22.6.0` consistente con
  `--experimental-strip-types`, pi como `peerDependency` (no dependency). `files`
  incluye `src`, `extensions`, `README.md`. Correcto.
- **Código muerto de tres rondas de fixes:** casi nada. `userRequested` no sobrevive fuera
  de dos tests que asertan su ausencia. `src/ledger.ts` tiene caller de producción.
  `renderObserved` sólo lo consumen sus tests — `src/feature-doc.ts:147` renderiza la línea
  por su cuenta con el mismo formato; es duplicación preexistente, no deuda de esta ronda,
  pero conviene que el doc llame al renderer o que el renderer se vaya. `overBudget` sin
  consumidor (m2).
- **Matriz de paridad:** 56 filas, numeración contigua y única, 9/9 tests verdes. Muestreé 8
  filas al azar (seed 20260919: 41, 7, 52, 23, 9, 51, 42, 48); 7 resuelven contra mecanismo
  existente y descrito con fidelidad. La fila 23 es H3. Las particiones `(M)+(P)` de las
  filas 41, 42 y 49 son honestas y nombran qué mitad es cuál.
- **Constitution / Steering:**

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | sin `.sdd/constitution.md`, `.sdd/steering.md` ni `.kiro/steering/*` |
| Scope matches product/tech constraints | pass | r3 tocó `README.md`, 2 guards en `extensions/nodd-kernel.ts`, `src/gates/evidence.ts` y sus tests; sin scope nuevo |
| No forbidden dependency or workflow change | pass | sin deps nuevas, sin `pi-tui`, sin `gentle-ai`, sin pipeline de compilación |

- **Auditoría TDD (Strict TDD gobernó el run):** la tabla de ciclos existe para T022–T045;
  T043/T044/T045 reportan RED observado con el mensaje textual del fallo, cada uno
  verificable contra el test que existe hoy. Corrí los tests listados: verdes. Las
  aserciones de la ronda 3 no son tautológicas — asertan strings concretos del artefacto en
  disco (`/runner not pinned/`, `!doc.includes("not pinned")`, `!existsSync(feature.md)`) y
  las tres mueren bajo mutación del mecanismo. El hueco de T001–T021 sigue declarado (M2).
  Un detalle a favor: `extensions/nodd-tools.test.ts:114` se hizo **más** específico (pinea
  `runner`) en vez de relajar la aserción para aceptar cualquiera de los dos strings.

---

## Lista accionable (ordenada)

1. **H2 (bloqueante)** — Hacer verdadera o retirar *"drops a canonical step"* de
   `README.md:12-16`. Si se implementa: `test/readme-contract.test.ts:46-48` tiene que
   buscar los pasos en la **sección** de pasos canónicos y con límite de palabra, no con
   `README.includes` sobre el archivo entero. Test de regresión: borrar `close` de la
   cadena debe poner la suite en rojo.
2. **H3 (mayor)** — Corregir la justificación de la fila 23 de la matriz: los comandos de
   test/build/install no son writer files ni understanding reads, **pero cuentan para el
   backstop de sesión larga**.
3. **m5, m2, m3 (menores)** — degradación silenciosa de `tdd`; `overBudget` sin consumidor;
   `design.md:525`. Ninguno bloquea.

---

# Cierre — verificación fuera del cap de rondas

**Veredicto de cierre: `pasa`.** Los tres arreglos del orquestador (`a04fca2`,
`a044647`, `c18b58b` + `81d816f`) cierran H2, m5 y H3 **con mecanismo**, no con
prosa. Los ataqué con 48 mutaciones ejecutadas; ninguna encontró un bypass que
importe. Quedan 3 hallazgos nuevos **menores**, todos de la clase "el test es más
débil de lo que podría ser", **ninguno** de la clase "la prosa promete más que el
mecanismo" — que era el defecto que definió este run.

Un fix hecho fuera del pipeline merece más escrutinio: lo apliqué. Los tres
sobreviven.

## 1. H2 (era bloqueante) — **CERRADO**

`test/readme-contract.test.ts:46-57` ahora parsea la cadena de **su** sección y
compara contra `CANONICAL_STEPS` por identidad (`assert.deepEqual`). El homónimo
ya no protege nada porque ya no se busca presencia, se busca igualdad.

**16 mutaciones sobre el README, 16 matan el test** (antes: 5 de 7 borrados
quedaban verdes):

| ataque | fails |
| --- | --- |
| borrar `authorize` / `explore` / `resolve-uncertainty` de la cadena | 1 / 1 / 1 |
| borrar `classify` / `track` / `implement` / `close` de la cadena | 1 / 1 / 1 / 1 |
| reordenar (`classify`↔`track`) | 1 |
| reordenar (mover `close` al frente) | 1 |
| renombrar `close`→`closee` | 1 |
| renombrar `track`→`tracked` (el homónimo que antes lo salvaba) | 1 |
| duplicar `close` al final | 1 |
| insertar un 8º paso (`deploy`) | 1 |
| borrar la sección entera | 1 |
| borrar la cadena y dejar el encabezado | 1 |
| renombrar el encabezado de la sección | 1 |

Los 5 pasos que la ronda 3 encontró vivos por homónimo (`authorize`, `classify`,
`track`, `implement`, `close`) **ahora mueren los cinco**. La protección dejó de
ser una coincidencia léxica.

**Fail-closed verificado:** plantar una cadena *inocente* no canónica
(`` `tracked` → `forge` ``) arriba de la real ⇒ **falla** (1). O sea, si el
parser agarra algo que no es la cadena, se pone rojo en vez de pasar.

**La oración de `README.md:12-16` ahora es verdadera en sus 8 cláusulas.** Rompí
cada una por separado: módulo inexistente (1), comando no registrado (1), bash
diciendo "exhaustive" (2), borrar `### Not covered` (4), resume sin "re-run" (1),
kill switch sin "off means off" (1), total de matriz en desacuerdo (1), y el paso
canónico borrado (1). **8/8 mueren.** En la ronda 3 eran 7/8.

Nota sobre el total de matriz: el README **no cita ningún total hoy**, así que esa
rama está dormida. Verifiqué que despierta bien — inyecté "99 clauses" ⇒ falla;
inyecté "56 clauses" (el real) ⇒ pasa.

### Residual m6 (nuevo, menor): el parser toma el **primer** match de la sección

`const chain = /(`[a-z-]+`(?:\s*→\s*`[a-z-]+`)+)\./.exec(steps)` — si alguien
planta una cadena canónica **correcta** arriba de la cadena real ya corrompida,
el test lee la de arriba y queda verde:

```
## The seven canonical steps

In short: `authorize` → ... → `close`.      <- decoy correcto, plantado
`authorize` → ... → `implement`.            <- la real, sin `close`
=> 398 tests, 398 pass, 0 fail
```

No lo cuento como reapertura de H2: requiere que un autor escriba *a propósito*
una cadena correcta para tapar una incorrecta en la misma sección. El modo de
falla real que H2 describía — que alguien borre un paso y nadie lo note — está
cerrado. Arreglo si se quiere endurecer: `matchAll` y exigir que **todas** las
cadenas de la sección sean la canónica, o anclar al último match.

## 2. m5 (era menor) — **CERRADO, y simétrico con el runner**

`extensions/nodd-kernel.ts:213-218`. **14 variantes ejecutadas contra el kernel
real; las 13 que degradan se rechazan, y en las 13 el documento queda intacto**
(`docTouched=false`), que es la mitad que importa:

| variante | resultado | doc |
| --- | --- | --- |
| re-declarar omitiendo `tdd` | refused | intacto |
| **`tdd: "off"` explícito** | refused | intacto |
| `tdd: ""` | refused | intacto |
| `tdd: "STRICT"` (mayúsculas) | refused | intacto |
| `tdd: "lenient"` (inválido) | refused | intacto |
| `tdd: null` / `undefined` / `true` | refused | intacto |
| `tdd: "strict "` (espacio final) | refused | intacto |
| re-declarar **sin runner**, omitiendo `tdd` | refused | intacto |
| **sesión nueva** (kernel nuevo, estado en RAM vacío) | refused | intacto |
| alias de slug (`./demo`, `demo/`, `demo/../demo`) | refused | intacto |
| `tdd: "strict"` (legítimo) | **aceptado** | intacto |

`tdd: "off"` explícito **sí se rechaza** — la regla es pin-once, no
"no-omitir". No hay degradación por valor inválido: todo lo que no es
exactamente `"strict"` cae en el refusal. El pin vive en el artefacto en disco
(`readDoc`), así que abrir otro proceso no lo evade, igual que el runner.

**Por `/nodd-allow`: no aplica.** `runAllowCommand` sólo concede hatches de
`GATE_IDS` y `declare` no es un gate; el refusal no pasa por `resolveFlag`.
Verificado leyendo `extensions/nodd-allow.ts:27-41`.

**Por edición a mano del doc: sí degrada** — `- tdd: strict` → `- tdd: off`
queda aceptado por el parser. **Pero es exactamente lo mismo que pasa con el
runner** (`- runner: npm test` → `- runner: none declared` también degrada), y el
README ya lo declara: *"Turning off `track` is also the documented way to
hand-edit a feature document"* (`README.md:229`). **No hay dos reglas distintas
para el mismo problema: hay una sola regla aplicada a los dos campos.** La
simetría que el veredicto de ronda 3 pedía está.

Mutación de confirmación: cortar el refusal ⇒ `strict TDD cannot be dropped by
re-declaring without it` muere.

### Residual m7 (nuevo, menor): el mecanismo nuevo no está documentado

`README.md:140` documenta la regla pin-once **del runner** (*"A pinned runner
cannot be re-pinned"*). La regla pin-once **del tdd**, que este commit acaba de
introducir, no aparece en ningún lado del README ni como criterio en
`requirements.md`. Un usuario puede toparse con el refusal
*"is pinned to tdd: strict, and dropping the discipline…"* sin que ningún
documento se lo anuncie.

Esto es **under-promising**, la dirección segura, y por eso es menor: ninguna
oración se volvió falsa. Es lo inverso del defecto de este run. Pero deja el
README desactualizado respecto del producto.

**`## Known limitations` sigue honesta y completa.** Reverifiqué las 5 entradas y
ninguna quedó obsoleta por estos cambios: m5 nunca figuró ahí (el veredicto de
ronda 3 ofrecía "mismo trato **o** nombrarlo en Known limitations"; el
orquestador eligió el trato, así que no hay entrada que retirar). La cuarta
—*"No test parses the English in this file"*— **sigue siendo cierta y sigue
siendo necesaria**: inyecté cuatro oraciones falsas y la suite quedó verde. La
limitación declarada no se cerró y no pretende haberse cerrado.

## 3. H3 (era mayor) — **CERRADO en el texto; el mecanismo nunca estuvo mal**

`requirements.md:704` fila 23. La redacción nueva parte la afirmación en las dos
mitades que el código realmente tiene:

> *"…counts only understanding reads and writer files **for the mapping and
> writer triggers**, so test/build/install commands never reach those. The
> long-session backstop (`routing.go:82`) is a separate clause and counts every
> tool call, these included: 25 runs of the declared runner with no delegation
> does fire it"*

**Es verdad, es completa y no es ambigua.** Contrastada contra
`src/gates/delegate.ts:58-81`: tres triggers, los dos primeros filtran por
archivos (writer/mapping), el tercero compara `committed.toolCalls` sin filtrar
nada. La fila ahora enumera los tres y nombra cuál es el que sí dispara. Coincide
con la tabla de gates del README, que ya listaba los tres.

**El test nuevo sí ejerce el caso que contradecía la afirmación** — no es otro
test que pasa de arriba. Prueba decisiva: la mutación que haría *verdadera la
redacción vieja*.

```
MUT E: excluir npm test/build/install de committed.toolCalls en src/state.ts
       (= implementar literalmente "never trip it")
=> 384 pass, 14 fail   <- entre ellos: "repeated runs of the declared runner
                          do reach the long-session backstop"
```

Y las mutaciones directas:

| mutación | fails | ¿muere el test nuevo? |
| --- | --- | --- |
| backstop a `if (false)` | 2 | **sí** |
| umbral 20 → 26 (25 pasaría a estar por debajo) | 2 | **sí** |
| umbral 20 → 3 | 4 | no (correcto: 25 ≥ 3 sigue disparando) |

El umbral 20→26 es la prueba de que el `25` del test es load-bearing y no un
número decorativo.

### Residual m8 (nuevo, menor): el test nuevo no fija la **razón**

`src/gates/delegate.test.ts:88-98` asierta sólo `decision.allow === false`. Su
hermano de una línea más abajo sí asierta `decision.reason.includes("20")`. Con
una mutación **combinada** —backstop apagado **y** `writerMinNonTrivialFiles`
bajado a 1— el test queda verde por el trigger equivocado:

```
backstop OFF + writer=1  =>  ✔ repeated runs of the declared runner do reach the long-session backstop
```

Bajo mutación simple muere (es lo que exige la matriz), así que no reabre H3.
Arreglo de 1 línea: `assert.ok(decision.reason.includes("tool calls"))`.

### Muestreo pedido: ¿otra fila con el defecto "el test no ejerce el caso que la contradice"?

Filtré las 56 filas por lenguaje absoluto (`never`/`always`/`cannot`/`every`/
`nothing`) en la justificación: **12 filas `(M)` califican**. Revisé las 12
contra su mecanismo y ataqué las 4 con test pineado individual.

- **Fila 23** — era H3, ahora correcta.
- **Filas 12, 13, 46** — los tests pineados ejercen el caso contradictorio de
  verdad (scan de fuentes por `git push`/`gh pr`/`git merge`; `renderOutcome`
  derivado; `isDeclaredRunner` + `lastWriteSeq`). Sin defecto.
- **Filas 20, 22** (*"never fires on ambiguity"*, *"never on a gate's own
  activity"*) — leí `promotion.ts` y `authorize.ts`: son negativas estructurales,
  no hay señal de ambigüedad ni de actividad de gate en el tipo de entrada. No
  hay caso contradictorio que ejercer.
- **Filas 1, 33, 35, 51, 55** — verificadas contra mecanismo existente.
- **Fila 45** — **sí tiene el defecto, en forma menor** (ver m9).

### Residual m9 (nuevo, menor): el test pineado de la fila 45 es un `includes` sobre el archivo entero

`test/parity-matrix.test.ts:216-226` asierta `doc.includes("runner")`,
`doc.includes("tdd")`, `doc.includes("source")` sobre todo `src/feature-doc.ts`
— **la misma forma exacta que tenía H2**. Renombré los tres campos de
`## Verification` a `x`/`y`/`z` dejando las palabras en un comentario:

```
=> 387 pass, 11 fail
   ✔ row 45: TDD mode, source and runner are recorded and reach the gate   <- verde
```

11 tests mueren, así que la sustancia de la fila 45 **está cubierta** por otros
tests; lo débil es el test que la pinea, que es justo el que debería nombrar la
regresión. No es un claim falso y no bloquea. Mismo arreglo que H2: asertar
contra la sección renderizada, no contra el archivo.

Observación relacionada, **sin regresión**: `every registered gate id appears in
the README` (`readme-contract.test.ts:22-26`) también es `includes` sobre el
archivo entero — borrar la tabla de gates completa deja la suite verde (los 6 ids
sobreviven en la cadena canónica y en la prosa). **Verifiqué que esto es
preexistente, no algo que el fix de H2 haya aflojado**: antes del fix el
resultado era idéntico. Y no hay prosa que lo prometa — `README:12-16` promete la
dirección inversa (*"names a gate … that does not exist"*), que **sí** muere
(renombré `gate-promotion`→`gate-promo` ⇒ 1 fallo).

## 4. ¿Rompieron o aflojaron algo?

**No.**

- **Ninguna aserción se debilitó.** Los 4 commits son +65/−4 líneas. Las únicas 4
  borradas son el cuerpo del test viejo de H2, reemplazado por uno
  estrictamente más fuerte (`deepEqual` por identidad vs. `includes` por
  presencia). El test de `delegate.test.ts` que se renombró conserva sus
  aserciones intactas y **gana** un test hermano; el rename (`never trip the
  gate` → `never trip the mapping or writer trigger`) es una corrección de
  nombre, no un relajamiento de alcance.
- **Matriz de mutación de los 6 gates: los 6 siguen matando tests.** Neutralicé
  cada gate (`return allow()` inmediato tras el guard de flag) y corrí la suite
  completa: `authorize` 7, `classify` 10, `track` 5, `delegate` 8, `evidence`
  25, `promotion` 6. Ninguno quedó inerte.
- **Código muerto: nada nuevo.** `userRequested` sigue existiendo sólo en dos
  tests que asertan su ausencia (correcto). `overBudget` sigue sin consumidor de
  producción (**m2**, preexistente). `renderObserved` sigue consumido sólo por
  sus tests (preexistente, ya reportado en ronda 3). Los 4 commits no dejaron
  huérfanos.
- **Suite: 398/398 verde, 0.6s.** Árbol limpio, nada staged: `git status
  --porcelain` sólo muestra `.pi/` y `.sdd/` sin trackear. Restauré cada una de
  las 48 mutaciones y reverifiqué el árbol después de cada tanda.

## 5. README releído entero: ¿queda prosa que promete más que el mecanismo?

Barrí el documento completo buscando la clase de defecto del run. **No encontré
ningún claim falso nuevo.** Los dos lugares donde la prosa es más fuerte
(`:12-16` y los 4 hechos de `## What actually satisfies a checkoff`) los rompí
cláusula por cláusula y todos mueren.

`## Known limitations` **sigue siendo honesta y completa después de estos
cambios** — ninguna de las 5 quedó desactualizada (detalle arriba, en m5). La
única desincronización doc/producto es m7, y va en la dirección segura: el
producto hace **más** de lo que el README cuenta.

## 6. Estado de entrega: instala y carga

- **Instala.** `npm pack` → `nodd-0.1.0.tgz`, 114.7 kB, 70 archivos. Instalado
  desde el tarball en un proyecto limpio (`/tmp/realinst`, directorio real, no
  symlink): `added 1 package, found 0 vulnerabilities`.
- **Carga.** Las 6 entradas de `pi.extensions` importan desde la copia instalada
  **bajo el loader real de pi** (`jiti`, que pi declara como dependencia
  `2.7.0`), las 6 con `default = function`.
- **Nota metodológica, no un defecto:** con `node --experimental-strip-types`
  las 6 fallan (*"Stripping types is currently unsupported for files under
  node_modules"*). Es una limitación de Node, no del paquete: pi no usa ese
  loader, usa jiti, y otros paquetes pi instalados (`pi-subagents`,
  `@gonrocca/zero-pi`, `pi-claude-auth`) despachan `.ts` desde `node_modules`
  igual. Lo dejo asentado porque es la trampa obvia para quien reverifique esto.
- **`package.json` declara bien `pi.extensions`:** array de 6 rutas relativas,
  las 6 existen en el árbol y en el tarball. `type: module`, `engines.node
  >= 22.6.0`, pi como `peerDependency` y **cero** `dependencies`. `files`
  (`src`, `extensions`, `README.md`) se respeta: `PLAN.md` y `spike/` **no**
  viajan. Asertado por `test/package-invariants.test.ts`.
- Detalle cosmético: el tarball incluye 34 `*.test.ts` (~consecuencia de
  `files: ["src","extensions"]`). Preexistente, sin impacto funcional.

## Estado FINAL de cada hallazgo — las 3 rondas + el cierre

| # | hallazgo | estado final |
| --- | --- | --- |
| **B1** | `gate-promotion` inerte (no registrado) | **cerrado** (r2, re-verificado en cierre: gate neutralizado ⇒ 6 fallos) |
| **B1b** | `gate-delegate` inerte | **cerrado** (r2, re-verificado: ⇒ 8 fallos) |
| **B2** | fail-closed al reanudar; ledger inexistente en producción | **cerrado** (r2) |
| **B3** | evidencia no atada a la tarea ni a la escritura | **cerrado** (r2, re-verificado: `gate-evidence` neutralizado ⇒ 25 fallos) |
| **B4** | test anti-ratchet tautológico del presupuesto | **cerrado** (r2) |
| **M1** | matriz de paridad sin criterio real | **cerrado** (r2) |
| **M2** | `tdd-evidence.md` sin filas T001–T021 | **abierto, declarado** (`tdd-evidence.md:6-8`). No bloquea. |
| **H1** | README prometía divulgación del runner no pineado | **cerrado** (r3) |
| **r3-a** | re-pineo del runner | **cerrado** (r3, 5 ataques) |
| **r3-b** | `tdd: strict` sin runner | **cerrado** (r3, 4 ataques) |
| **H2** | `README:12-16` afirmaba detectar un paso borrado; fallaba en 5/7 | **CERRADO** (cierre, `a04fca2`, 16/16 mutaciones matan) |
| **H3** | `requirements.md:704` "test/build/install never trip it" era falso | **CERRADO** (cierre, `c18b58b`+`81d816f`, texto correcto + test que ejerce el caso) |
| **m5** | `tdd` degradable en silencio | **CERRADO** (cierre, `a044647`, 13/13 variantes rechazadas, doc intacto) |
| **m1** | `isDeclaredRunner` acepta un flag que redirige el cwd | **declarado** (`README:336-339`) ✓ |
| **m4** | `readLedger` reporta defects que nadie lee | **declarado** (`README:340-343`) ✓ |
| **m2** | `overBudget` sin consumidor de producción | **abierto, menor** (preexistente) |
| **m3** | `design.md:525` lista *"3. The user asked"* | **abierto, menor** (artefacto histórico) |
| **m6** | el parser de la cadena toma el primer match de la sección | **abierto, menor** (nuevo, cierre) |
| **m7** | la regla pin-once de `tdd` no está en README ni en `requirements.md` | **abierto, menor** (nuevo, cierre) |
| **m8** | el test del backstop no fija la razón, sólo `allow===false` | **abierto, menor** (nuevo, cierre) |
| **m9** | el test pineado de la fila 45 es `includes` sobre el archivo entero | **abierto, menor** (nuevo, cierre) |

**Bloqueantes: 0. Mayores: 0. Menores abiertos: 8** (m1 y m4 declarados; m2, m3,
m6, m7, m8, m9 pendientes).

## Qué se certifica exactamente — y qué no

**Se certifica:**

1. Que borrar, renombrar, reordenar o duplicar **cualquiera** de los 7 pasos
   canónicos de la cadena del README pone la suite en rojo. 16/16.
2. Que las 8 cláusulas de `README.md:12-16` son verdaderas, cada una verificada
   rompiéndola por separado. 8/8.
3. Que `tdd: strict` no se degrada por ninguna vía del tool `nodd_declare`
   —omisión, `"off"` explícito, valor inválido, sesión nueva o alias de slug— y
   que el rechazo **no toca el documento**. 13/13.
4. Que la fila 23 de la matriz describe con fidelidad los tres triggers de
   `gate-delegate`, y que su test nuevo muere bajo la mutación que haría
   verdadera la redacción vieja.
5. Que los 6 gates siguen vivos: neutralizar cada uno mata entre 5 y 25 tests.
6. Que el paquete empaqueta, instala desde el tarball y carga sus 6 extensiones
   bajo el loader real de pi.
7. Que no se debilitó ninguna aserción existente y no quedó código muerto nuevo.

**No se certifica** (sigue igual de abierto que antes, y declarado):

1. **Que la prosa del README no pueda adelantarse al producto.** Reinyecté las
   cuatro oraciones falsas de la ronda 3 y la suite sigue verde. La limitación
   está declarada en `## Known limitations` con su mecanismo de entrada nombrado,
   y **sigue siendo la defensa correcta**: la defensa es review, no la suite.
   m7 es un caso vivo de esa misma deriva, en la dirección inofensiva.
2. **El enforcement en nietos (profundidad ≥ 2).** Nunca medido; declarado.
3. **La cobertura TDD de T001–T021** (M2); declarada.
4. Que un autor adversario no pueda plantar una cadena decoy (m6) ni que los
   tests pineados de las filas 45 y de los gate-ids resistan un rename con las
   palabras conservadas (m9). Son tests débiles, no promesas falsas.

El run cierra con los dos hallazgos que agotaron el cap (**H2** bloqueante,
**H3** mayor) **cerrados con mecanismo verificado**, más un menor (**m5**)
cerrado de yapa con la misma dureza que se le aplicó al runner. Los 4 menores
nuevos son todos de la forma "este test podría ser más estricto", no de la forma
"este documento miente" — que es la única clase que este run trató como
bloqueante.
