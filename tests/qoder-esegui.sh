#!/usr/bin/env bash
# Prova di script/qoder-esegui con un `qodercli` finto nel PATH (i test della mod non possono lanciare processi): bash tests/qoder-esegui.sh
set -u
S=$(cd "$(dirname "$0")/../script" && pwd)/qoder-esegui; ko=0
prova() { # <corpo qodercli, vuoto = la CLI manca> <riprendi> <modello> <sforzo> <permesso> <regex fine> <regex argomenti> <regex che non ci deve essere> <stdin atteso>
  d=$(mktemp -d); mkdir "$d/bin"
  # Un PATH solo nostro (e una HOME vuota): il caso senza CLI non deve trovare un qodercli vero.
  for c in bash cat date git ls mkdir nice rm sort timeout tr uuidgen; do p=$(command -v "$c") && ln -s "$p" "$d/bin/$c"; done
  [ -n "$1" ] && { printf '#!/bin/bash\necho "$@" > %s/args\ncat > %s/stdin\n%s\n' "$d" "$d" "$1" > "$d/bin/qodercli"; chmod +x "$d/bin/qodercli"; }
  echo ciao > "$d/n.prompt.md"; echo ancora > "$d/n.riprendi.md"
  HOME="$d" PATH="$d/bin" REGIA_RIPRENDI=$2 bash "$S" n "$d" "$d" "$3" "$4" "$d/esegui.log" "$5"
  ok=1
  grep -qE "$6" "$d/esegui.log" || ok=0
  [ -z "$7" ] || grep -qE -- "$7" "$d/args" || ok=0
  [ -z "$8" ] || ! grep -qE -- "$8" "$d/args" || ok=0
  [ -z "$9" ] || [ "$(cat "$d/stdin")" = "$9" ] || ok=0
  [ -e "$d/n.pid" ] && ok=0
  [ $ok -eq 1 ] || { echo "KO: $1 / $2 / $5: $(cat "$d/args" 2>/dev/null) :: $(cat "$d/esegui.log")"; ko=1; }
  rm -rf "$d"
}
# Scrive: permesso auto, sessione nuova con un UUID scelto qui, nome e cartella per `ps`, prompt da stdin.
prova 'echo ok' '' '' '' auto 'fine n \(exit 0' '^--permission-mode auto --session-id [0-9a-f-]{36} -n n -w /.* -p$' '--resume|-m |--reasoning-effort' ciao
# Legge soltanto: permesso default; cosi anche un permesso sconosciuto.
prova 'echo ok' '' '' '' default 'fine n \(exit 0' '^--permission-mode default ' 'auto' ciao
prova 'echo ok' '' '' '' boh 'fine n \(exit 0' '^--permission-mode default ' 'auto' ciao
# Modello e sforzo solo se dati.
prova 'echo ok' '' Qwen4-Max high auto 'fine n \(exit 0' '^-m Qwen4-Max --reasoning-effort high --permission-mode auto ' '' ciao
# Ripresa: --resume <id> con il messaggio nuovo, senza --session-id; il permesso resta quello dato.
prova 'echo ok' abc '' '' default 'fine n \(exit 0' '^--permission-mode default --resume abc -n n ' 'session-id' ancora
# Guasti: risposta vuota con exit 0, exit diverso da 0, CLI che manca.
prova 'true' '' '' '' auto 'fine n \(exit 1' 'permission-mode auto' '' ciao
prova 'echo "errore"; exit 3' '' '' '' auto 'fine n \(exit 3' 'permission-mode auto' '' ciao
prova '' '' '' '' auto 'fine n \(exit 127' '' '' ''
# qodercli in ~/.local/bin, fuori dal PATH: lo script lo trova da solo.
d=$(mktemp -d); mkdir -p "$d/bin" "$d/.local/bin"
for c in bash cat date git ls mkdir nice rm sort timeout tr uuidgen; do p=$(command -v "$c") && ln -s "$p" "$d/bin/$c"; done
printf '#!/bin/bash\ncat > /dev/null\necho ok\n' > "$d/.local/bin/qodercli"; chmod +x "$d/.local/bin/qodercli"
echo ciao > "$d/n.prompt.md"
HOME="$d" PATH="$d/bin" bash "$S" n "$d" "$d" "" "" "$d/esegui.log" auto
grep -qE 'fine n \(exit 0' "$d/esegui.log" || { echo "KO: qodercli in ~/.local/bin non trovato: $(cat "$d/esegui.log")"; ko=1; }
rm -rf "$d"
[ $ko -eq 0 ] && echo "ok"; exit $ko
