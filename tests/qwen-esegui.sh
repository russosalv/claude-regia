#!/usr/bin/env bash
# Prova di script/qwen-esegui con un `qwen` finto nel PATH (i test della mod non possono lanciare processi): bash tests/qwen-esegui.sh
set -u
S=$(cd "$(dirname "$0")/../script" && pwd)/qwen-esegui; ko=0
prova() { # <corpo qwen> <riprendi> <regex fine> <regex argomenti>
  d=$(mktemp -d); printf '#!/bin/bash\necho "$@" > %s/args\n%s\n' "$d" "$1" > "$d/qwen"; chmod +x "$d/qwen"
  echo ciao > "$d/n.prompt.md"; echo ancora > "$d/n.riprendi.md"
  PATH="$d:$PATH" REGIA_RIPRENDI=$2 bash "$S" n "$d" "$d" "" "" "$d/esegui.log" default
  grep -qE "$3" "$d/esegui.log" && grep -qE -- "$4" "$d/args" || { echo "KO: $1 / $2"; ko=1; }
  rm -rf "$d"
}
prova 'echo ok' '' 'fine n \(exit 0' '--strict-mcp-config'
prova 'echo ok' abc 'fine n \(exit 0' '--strict-mcp-config.*--resume abc'
prova 'echo "Responses richiesta: provider_error: x"' '' 'fine n \(exit 1' 'strict'
prova 'echo "provider_error"; exit 1' '' 'fine n \(exit 1' 'strict'
[ $ko -eq 0 ] && echo "ok"; exit $ko
