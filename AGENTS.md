# NODD: reglas para agentes

## Cada mejora va al changelog de la web

Toda mejora a NODD que quede commiteada se publica también en
https://nodd.ceroclawd.com/changelog/, en el mismo trabajo, sin esperar a que
alguien lo pida.

1. Anotala en `CHANGELOG.md`, en `[Unreleased]` (inglés, técnico).
2. Agregala en `site/changelog/index.html`, en español y para quien usa NODD:
   qué cambia para esa persona y, si se midió, el número. Lo que todavía no
   está en npm va en el bloque `próxima` (`en el repo`). Al publicar una
   versión, ese bloque pasa a ser la versión con su fecha y `en npm`, y el
   número de versión del header y del footer se actualiza en las dos páginas.
3. Usá sólo clases que ya existan en `site/styles.css` (es Tailwind compilado
   para la landing) o las del `<style>` de la página.
4. Publicá con `site/deploy.sh`: guarda un backup en cerostation, sube por
   rsync a `/srv/www/nodd` y muestra el status HTTP de las dos páginas, que
   tiene que ser 200.

## Antes de commitear

- `npm test` en la raíz y `claude plugin test` en `claude-code/`.
- Si tocaste `src/`, corré `./claude-code/sync-core.sh` antes de `npm test`:
  `test/claude-code-core.test.ts` falla mientras la copia del mod esté vieja.
