#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$(cd "$here/../src" && pwd)"
dest="$here/hooks/core"
entries=(kernel.ts config-core.ts gates/registry.ts gates/policy.ts path.ts)

mode="${1:-sync}"
if [[ "$mode" != "sync" && "$mode" != "--check" ]]; then
  echo "uso: sync-core.sh [--check]" >&2
  exit 2
fi

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

declare -A seen=()
queue=("${entries[@]}")
failed=0

while ((${#queue[@]} > 0)); do
  rel="${queue[0]}"
  queue=("${queue[@]:1}")
  [[ -n "${seen[$rel]:-}" ]] && continue
  seen[$rel]=1

  file="$src/$rel"
  if [[ ! -f "$file" ]]; then
    echo "sync-core: falta $rel en src/" >&2
    failed=1
    continue
  fi
  if [[ "$rel" == *.test.ts ]]; then
    echo "sync-core: $rel es un test y no se vendoriza" >&2
    failed=1
    continue
  fi

  while IFS= read -r spec; do
    case "$spec" in
      ./* | ../*)
        target="$(realpath -m --relative-to="$src" "$(dirname "$file")/$spec")"
        if [[ "$target" == ../* ]]; then
          echo "sync-core: $rel importa $spec, que queda fuera de src/" >&2
          failed=1
        else
          queue+=("$target")
        fi
        ;;
      *)
        echo "sync-core: $rel importa \"$spec\"; el mod sólo puede importar archivos propios" >&2
        failed=1
        ;;
    esac
  done < <(grep -oE '(^|[^A-Za-z0-9_$])from\s+"[^"]+"' "$file" | sed -E 's/.*from\s+"([^"]+)"/\1/'; grep -oE '^\s*import\s+"[^"]+"' "$file" | sed -E 's/.*"([^"]+)"/\1/')

  mkdir -p "$stage/$(dirname "$rel")"
  cp "$file" "$stage/$rel"
done

if grep -rlE '(from|import)\s+"node:' "$stage" >/dev/null 2>&1; then
  echo "sync-core: hay imports de node en la copia:" >&2
  grep -rnE '(from|import)\s+"node:' "$stage" >&2
  failed=1
fi

((failed == 0)) || exit 1

if [[ "$mode" == "--check" ]]; then
  if [[ ! -d "$dest" ]] || ! diff -r "$stage" "$dest" >/dev/null; then
    echo "sync-core: claude-code/hooks/core no coincide con src/; corré claude-code/sync-core.sh" >&2
    [[ -d "$dest" ]] && diff -rq "$stage" "$dest" >&2 || true
    exit 1
  fi
  echo "sync-core: hooks/core al día (${#seen[@]} archivos)"
  exit 0
fi

rm -rf "$dest"
mkdir -p "$dest"
cp -r "$stage/." "$dest/"
echo "sync-core: ${#seen[@]} archivos copiados a hooks/core"
