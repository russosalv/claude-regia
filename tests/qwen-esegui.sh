#!/usr/bin/env bash
# Prova `script/qwen-esegui` con CLI finte: scelta qwen/qoder, metadato della
# famiglia, ripresa sicura e classificazione degli errori.
set -u
S=$(cd "$(dirname "$0")/../script" && pwd)/qwen-esegui
ko=0

fallisci() { echo "KO: $1"; ko=1; }

scrivi_cli() { # <dir> <qwen|qoder> <compatibile 0|1> <corpo>
  local d=$1 nome=$2 compatibile=$3 corpo=$4 help='--model --resume'
  [ "$compatibile" = 1 ] && help='--permission-mode --strict-mcp-config --session-id --name --cwd --print --resume --model --reasoning-effort'
  mkdir -p "$d/bin"
  printf '#!/usr/bin/env bash\nHELP=%q\nCORPO=%q\n' "$help" "$corpo" > "$d/bin/$nome"
  printf '%s\n' \
    'if [ "${1:-}" = "--help" ]; then printf "%s\n" "$HELP"; exit 0; fi' \
    'if [ "${1:-}" = "--version" ]; then echo "${0##*/} 1.0.0"; exit 0; fi' \
    'printf "%s\n" "$*" > "$REGIA_TEST_DIR/${0##*/}.args"' \
    'eval "$CORPO"' >> "$d/bin/$nome"
  chmod +x "$d/bin/$nome"
}

prepara() {
  local d=$1
  mkdir -p "$d/home" "$d/lavoro"
  echo ciao > "$d/lavoro/n.prompt.md"
  echo ancora > "$d/lavoro/n.riprendi.md"
}

esegui() { # <dir> <resume>
  local d=$1 riprendi=$2
  PATH="$d/bin:$PATH" HOME="$d/home" REGIA_TEST_DIR="$d" REGIA_RIPRENDI="$riprendi" \
    bash "$S" n "$d" "$d/lavoro" "" "" "$d/esegui.log" default
}

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 1 'echo ok'
esegui "$d" '' || fallisci 'qwen compatibile non parte'
[ "$(cat "$d/lavoro/n.cli" 2>/dev/null)" = qwen ] || fallisci 'non registra qwen'
grep -q -- '--strict-mcp-config' "$d/qwen.args" || fallisci 'argomenti qwen'
[ ! -e "$d/lavoro/n.pid" ] || fallisci 'pid qwen non pulito'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qoder 1 'echo ok'
esegui "$d" '' || fallisci 'qoder compatibile non parte'
[ "$(cat "$d/lavoro/n.cli" 2>/dev/null)" = qoder ] || fallisci 'non registra qoder'
grep -q -- '--strict-mcp-config' "$d/qoder.args" || fallisci 'argomenti qoder'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 0 'echo qwen-sbagliato'; scrivi_cli "$d" qoder 1 'echo ok'
esegui "$d" '' || fallisci 'non ripiega su qoder'
[ "$(cat "$d/lavoro/n.cli" 2>/dev/null)" = qoder ] || fallisci 'famiglia del ripiego'
[ -f "$d/qoder.args" ] && [ ! -f "$d/qwen.args" ] || fallisci 'ha eseguito la CLI incompatibile'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 1 'echo qwen-sbagliato'; scrivi_cli "$d" qoder 1 'echo ok'
echo qoder > "$d/lavoro/n.cli"
esegui "$d" abc || fallisci 'ripresa qoder registrata'
grep -q -- '--resume abc' "$d/qoder.args" || fallisci 'argomenti ripresa qoder'
[ ! -f "$d/qwen.args" ] || fallisci 'ripresa passata alla famiglia sbagliata'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 0 'echo no'; scrivi_cli "$d" qoder 1 'echo ok'
echo qwen > "$d/lavoro/n.cli"
esegui "$d" abc && fallisci 'ripresa con famiglia incompatibile accettata'
grep -q 'fine n (exit 127' "$d/esegui.log" || fallisci 'manca fine 127 della ripresa'
[ ! -e "$d/lavoro/n.pid" ] || fallisci 'pid rimasto dopo famiglia incompatibile'
[ ! -f "$d/qoder.args" ] || fallisci 'ha cambiato famiglia in ripresa'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 1 'echo qwen-sbagliato'; scrivi_cli "$d" qoder 1 'echo ok'
mkdir -p "$d/home/.qoder/projects/p"; : > "$d/home/.qoder/projects/p/abc.jsonl"
esegui "$d" abc || fallisci 'inferenza qoder storica'
[ "$(cat "$d/lavoro/n.cli" 2>/dev/null)" = qoder ] || fallisci 'non registra inferenza qoder'
[ -f "$d/qoder.args" ] && [ ! -f "$d/qwen.args" ] || fallisci 'inferenza storica sbagliata'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 1 'echo no'; scrivi_cli "$d" qoder 1 'echo no'
mkdir -p "$d/home/.qwen/projects/p" "$d/home/.qoder/projects/p"
: > "$d/home/.qwen/projects/p/abc.jsonl"; : > "$d/home/.qoder/projects/p/abc.jsonl"
esegui "$d" abc && fallisci 'ripresa storica ambigua accettata'
grep -q 'fine n (exit 127' "$d/esegui.log" || fallisci 'manca fine 127 ambigua'
[ ! -e "$d/lavoro/n.pid" ] || fallisci 'pid rimasto dopo ambiguita'
[ ! -f "$d/qwen.args" ] && [ ! -f "$d/qoder.args" ] || fallisci 'CLI lanciata con ambiguita'
rm -rf "$d"

d=$(mktemp -d); prepara "$d"; scrivi_cli "$d" qwen 1 'echo "Responses richiesta: provider_error: x"'
esegui "$d" '' || true
grep -q 'fine n (exit 1' "$d/esegui.log" || fallisci 'provider_error non classificato'
rm -rf "$d"

[ "$ko" -eq 0 ] && echo ok
exit "$ko"
