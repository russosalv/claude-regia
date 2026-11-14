#!/usr/bin/env bash
# Prova di script/copilot-esegui con un `copilot` finto nel PATH (i test della mod non possono lanciare processi): bash tests/copilot-esegui.sh
set -u
S=$(cd "$(dirname "$0")/../script" && pwd)/copilot-esegui; ko=0
prova() { # <corpo copilot, vuoto = la CLI manca> <riprendi> <modello> <sforzo> <permesso> <regex fine> <regex argomenti> <regex che non ci deve essere> <stdin atteso>
  d=$(mktemp -d); mkdir "$d/bin"
  # Un PATH solo nostro (e una HOME senza nvm): il caso senza CLI non deve trovare un copilot vero.
  for c in bash cat date git ls mkdir nice rm sort timeout tr uuidgen; do p=$(command -v "$c") && ln -s "$p" "$d/bin/$c"; done
  [ -n "$1" ] && { printf '#!/bin/bash\necho "$@" > %s/args\ncat > %s/stdin\n%s\n' "$d" "$d" "$1" > "$d/bin/copilot"; chmod +x "$d/bin/copilot"; }
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
# Scrive: tutti gli strumenti e i percorsi, sessione nuova con un UUID scelto qui, prompt da stdin.
prova 'echo ok' '' '' '' auto 'fine n \(exit 0' '^--allow-all-tools --allow-all-paths --no-ask-user -s --log-dir .*/log --session-id [0-9a-f-]{36} -C /' 'deny-tool|--resume|--model|--effort' ciao
# Legge soltanto: nessun permesso in piu e le scritture negate; cosi anche un permesso sconosciuto.
prova 'echo ok' '' '' '' default 'fine n \(exit 0' '^--deny-tool=write --no-ask-user -s ' 'allow-all' ciao
prova 'echo ok' '' '' '' boh 'fine n \(exit 0' '^--deny-tool=write ' 'allow-all' ciao
# Modello e sforzo solo se dati.
prova 'echo ok' '' claude-sonnet-4.6 high auto 'fine n \(exit 0' '^--model claude-sonnet-4.6 --effort high --allow-all-tools ' '' ciao
# Ripresa: --resume=<id> con il messaggio nuovo, senza --session-id e senza -C; il permesso resta quello dato.
prova 'echo ok' abc '' '' default 'fine n \(exit 0' '^--deny-tool=write --no-ask-user -s --log-dir .*/log --resume=abc$' 'session-id| -C ' ancora
# Guasti: risposta vuota con exit 0, exit diverso da 0, CLI che manca.
prova 'true' '' '' '' auto 'fine n \(exit 1' 'allow-all-tools' '' ciao
prova 'echo "errore"; exit 3' '' '' '' auto 'fine n \(exit 3' 'allow-all-tools' '' ciao
prova '' '' '' '' auto 'fine n \(exit 127' '' '' ''
[ $ko -eq 0 ] && echo "ok"; exit $ko
