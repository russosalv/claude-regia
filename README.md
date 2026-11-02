# regia

Mod di Claude Code per lavorare da orchestratore: la conversazione principale coordina, gli agenti eseguono. Funziona da sola su qualsiasi PC e progetto, senza altri plugin e senza regole nel `CLAUDE.md`.

- **Delega davvero.** La regola viaggia con la mod: una sezione del prompt di sistema e, in modo `stretta`, il rifiuto delle scritture della principale sui file del progetto.
- **Modello e sforzo per compito.** Nessuna tabella decisa in anticipo: a ogni chiamata ad Agent la mod guarda il compito vero. Chi fallisce riprova un gradino sopra.
- **Sciami.** `sciame_avvia` manda agenti Claude e Codex su una lavagna con dipendenze, parallelismo e posta fra loro.
- **Risparmio.** Regole di sobrieta e rapporti brevi nei prompt dei delegati (o Ponytail, se c'e), tool che non pesano sul prompt.
- **Cruscotto.** Un pane fisso accanto alla chat: **IN CORSO**, **IN SCALETTA**, **FATTI**, con modello, sforzo, durata e token di ognuno.

## Installazione

Dal prompt di una sessione:

```
/plugin install regia --marketplace russosalv/claude-regia
```

Codex CLI serve solo per i lavori Codex; python3 solo per la CLI `posta`. Nessun altro plugin e richiesto (Ponytail lo installa la mod).

## Comandi

| Comando | |
|---|---|
| `/regia` | apre il pane sulla **sessione**, con un riepilogo testuale |
| `/regia tutti` | il pane su **tutta la macchina** |
| `/regia doctor` | che cosa e attivo adesso: modalita, versione, Ponytail, Codex, config |
| `/regia ponytail [on\|off]` | se Ponytail e attivo; `on` lo installa ora, `off` evita che lo installi la mod |
| `/regia sciame` | la lavagna degli sciami della sessione |
| `/regia orchestra [stretta\|guida\|off]` | quanto la principale e tenuta a delegare |
| `/regia modelli [on\|off]` | modello e sforzo decisi per compito |
| `/regia risparmio [on\|off]` | regole di risparmio nei prompt dei delegati |

Senza valore, gli ultimi tre mostrano lo stato; anche `/regia` riassume le modalita in una riga. I cambi valgono subito per tutte le sessioni.

## La principale delega

`/regia orchestra`:

- **`stretta`** (predefinito): la sezione nel prompt, piu il rifiuto di `Edit`, `Write` e `NotebookEdit` della conversazione principale sui file del repository. Il messaggio di rifiuto dice al modello di delegare. Restano liberi i subagenti, i file fuori dal repository e `.claude/` (impostazioni, memoria).
- **`guida`**: solo la sezione nel prompt. Da usare quando vuoi che la principale tocchi un file da sola.
- **`off`**: niente.

Non si applica senza superficie (`claude -p`, SDK: script e servizi fanno da se), senza il tool Agent, ne ai subagenti. I comandi lanciati con Bash non si possono distinguere: lanciare test o fare un commit la principale non deve, ma lo dice solo il prompt.

## Modello e sforzo, compito per compito

A ogni chiamata ad Agent (hook su `tool.call`) haiku legge descrizione e prompt del compito e risponde con modello (`haiku`, `sonnet`, `opus`), sforzo (`low`, `medium`, `high`) e motivo. Costa una chiamata breve e un secondo o due, e non compare nei costi della sessione. Se haiku non risponde: sonnet e un'euristica sulle parole del prompt.

Non vengono toccati: cio che la chiamata indica, il `model:` e l'`effort:` nel file dell'agente (`.claude/agents/<tipo>.md`), i fork. Se e fissato uno solo dei due, la mod sceglie l'altro. Un tipo si fissa in config: `"modelli": { "mio-agente": "opus", "altro": "inherit" }` (`inherit`: il modello non si tocca).

Lo sforzo con cui ogni subagente gira davvero si legge da `turn.step`, come fa Vitals: il pane lo mostra a tacche (`▰▱▱`) anche per Claude. Se un compito fallisce la prima scelta si corregge dal risultato: la principale riprova con modello e sforzo espliciti un gradino sopra, lo sciame lo fa da solo.

Per Codex: `codex_avvia` senza `sforzo` chiede a haiku lo stesso giudizio; il modello, se non e nella chiamata ne in config (`codexModello`), lo decide la config di Codex.

## Sciami

```
sciame_avvia({
  obiettivo: "Migrare l'autenticazione",
  parallelo: 3,
  compiti: [
    { nome: "mappa", prompt: "Trova tutti gli usi della vecchia API..." },
    { nome: "nucleo", prompt: "...", scrive: true, dopo: ["mappa"] },
    { nome: "client", prompt: "...", scrive: true, esecutore: "codex", dopo: ["mappa"] },
    { nome: "revisione", prompt: "...", dopo: ["nucleo", "client"] }
  ]
})
```

- **Parte chi e pronto**, entro `parallelo` (predefinito 4, `sciameParallelo` in config, massimo 16). Fino a 40 compiti per sciame; nomi doppi, dipendenze ignote e cicli si rifiutano prima di lanciare.
- **Chi scrive ha un worktree suo** in `<repo>/.worktrees/<sciame>-<compito>`, ramo `sciame/<sciame>/<compito>`. La cartella si esclude da git con `.git/info/exclude`, il `.gitignore` non si tocca.
- **Ogni agente sa** obiettivo, compagni e il rapporto dei compiti da cui dipende. Si scrivono con `posta_invia` e possono aggiungere lavoro con `sciame_aggiungi`.
- **Chi fallisce riprova una volta**, un gradino sopra e sapendo perche ha fallito. Se fallisce ancora, chi dipende da lui si blocca e gli altri continuano.
- **La principale non spende nulla mentre aspetta**: lo sciame risponde subito e la sveglia con un turno solo alla fine, con il riepilogo. I rapporti interi stanno in `~/.claude/regia/sciami/<id>/<compito>.md`.
- `sciame_stato` e `/regia sciame` mostrano la lavagna; `sciame_ferma` annulla chi aspetta, chi corre finisce il suo. I compiti in attesa si vedono in scaletta nel pane.

Limiti: l'unione dei rami resta a un delegato della principale; se la sessione si chiude i subagenti Claude muoiono con lei (i Codex no); un compito che finisce mentre la mod si ricarica risulta completato senza rapporto.

## Risparmio di token

- **Rapporto finale breve** in coda a ogni delegato: la principale rilegge ogni rapporto a ogni giro, ed e il costo che cresce di piu.
- **Regola di sobrieta** (scrivere il minimo, riusare, niente astrazioni non chieste; mai tagliare validazione, sicurezza o test della logica rischiosa). Se [Ponytail](https://github.com/DietrichGebert/ponytail) e attivo la mod non la ripete: Ponytail porta gia la sua ai subagenti. Non serve installarlo a parte: quando la mod e nuova o aggiornata, la prima sessione interattiva lo installa se manca (`claude plugin marketplace add` e `install`), una volta per versione, e si carica dalla sessione dopo. Poi vive di vita sua: la mod non lo aggiorna e, se lo togli, non lo rimette fino alla versione successiva. `/regia ponytail off` evita che lo installi; uno disabilitato a mano resta com'e; se l'installazione non riesce la mod usa la sua regola e riprova alla sessione dopo.
  I lavori Codex ricevono sempre la regola della mod.
- **Modello e sforzo minimi** che bastano al compito (vedi sopra).
- **Tool differiti**: gli schemi non pesano su ogni richiesta di ogni sessione. Il modello li carica con ToolSearch quando servono.
- **Lo sciame** non tiene occupata la principale mentre aspetta.

## Il pane

- La status line riguarda sempre la sessione, per esempio `● 3 codex · 2 claude · 4 da fare`. Il motore la prefissa con `⚠ regia:`: quel prefisso non si puo togliere.
- **Parlare con un subagente**: `▸ apri` porta la sua conversazione nella vista principale; `[ ← principale ]` o `/regia` tornano indietro. A pane stretto diventa cliccabile il nome del lavoro (`▸`).
- **Log di un Codex**: `▸ log` mostra le ultime 30 righe, `[ ↻ ]` le rilegge.
- **Scrivere**: `✉ scrivi` apre un campo in cima al pane; Invio manda da `utente`. `↻ riprendi` riprende un Codex finito.
- **Colonne adattive**: quando manca spazio cedono, nell'ordine, token, indicatore di attivita, esecutore, tasti, modello e Dove/Esito. Lavoro e Durata restano. Nessuna riga va a capo.
- Le fonti si rileggono ogni 15 secondi (configurabile) e a ogni `/regia`; mentre qualcosa e in corso il pane si ridisegna ogni secondo. Una fonte che fallisce da una riga di avviso, le altre continuano.

## Lanciare Codex: il tool `codex_avvia`

Il modello lo carica con ToolSearch come `mcp__regia__codex_avvia`. Parametri:

| Parametro | | |
|---|---|---|
| `nome` | obbligatorio | slug del lavoro: lettere, cifre, `.`, `_`, `-`, al più 64, niente `..` né `/` |
| `cartella` | obbligatorio | il worktree, assoluto o con `~`; deve esistere ed essere una cartella (si usa il percorso reale) |
| `prompt` | obbligatorio | il compito |
| `regole` | facoltativo | file da accodare al prompt (deve esistere); se manca, `<progetto>/.regia/regole.md` quando c'è (il progetto è il repository principale della sessione) |
| `sforzo` | facoltativo | `low`, `medium` o `high`; se manca lo sceglie la mod |
| `modello` | facoltativo | se manca, `"codexModello"` in config; senza neanche quello decide Codex |

Che cosa fa:

1. controlla gli argomenti e rifiuta (con il motivo, come errore del tool) un nome già in corso: un `codex exec` vivo con quel nome, o lo script che aspetta di riprovare (il suo pid sta in `<nome>.pid`);
2. scrive `~/.claude/regia/codex/<nome>/<nome>.prompt.md` (prompt + regole);
3. copia lo script del plugin `script/codex-esegui` in `~/.claude/regia/bin/` (se manca o è cambiato) e lo lancia con `setsid nohup`, staccato: sopravvive alla sessione. Lo lancia con `CLAUDE_CODE_SESSION_ID` della sessione nell'ambiente, così il lavoro è attribuito alla sessione;
4. risponde subito con pid, percorsi, modello e sforzo con il motivo, e ricorda il lancio per la sessione in `$.store` (`regia.agenti.<id>`): il lavoro è della sessione anche se finisce prima che la mod lo veda vivo.

Lo script esegue `nice -n 10 codex exec --dangerously-bypass-approvals-and-sandbox [-m <modello>] -c model_reasoning_effort=<sforzo> -C <cartella> -o <nome>.esito.md - < <nome>.prompt.md > <nome>.log 2>&1`, fino a 4 tentativi con `sleep 180` se il log dice «at capacity» e l'esito è vuoto, e scrive in `~/.claude/regia/codex/esegui.log`:

```
19:21 inizio prova-regia
19:24 prova-regia, riprovo (1)
19:30 fine prova-regia (exit 0, commit 2)
```

`commit` è `git rev-list --count main..HEAD` nel worktree (`?` se non c'è un ramo `main`). Quel log è sempre tra le fonti, anche con `codexLogs` in config, e finché non esiste non dà avvisi; `▸ log` apre `<nome>/<nome>.log`.

**Sforzo automatico.** Senza `sforzo`, la mod chiede a haiku (`$.model.complete`, una riga di JSON) se il compito è `low` (meccanico o piccolo), `medium` (sviluppo normale) o `high` (architettura, indagini, molti file). Se haiku non risponde vale un'euristica: parole come progetta/indaga/analisi/refactor o un prompt oltre 6000 caratteri → `high`; compiti meccanici o sotto i 400 caratteri → `low`; il resto `medium`. La risposta del tool dice sforzo, motivo e chi l'ha scelto (chiamata, classificazione, euristica).

## Quanto consuma ogni subagente

Per ogni subagente la mod ricorda in `$.store` (`regia.agenti.<sessione>`) modello e sforzo veri, il motivo e chi li ha decisi: **scelto da regia**, **esplicito** o **ereditato**. Il pane li mostra nella colonna Modello e, per chi e in corso, accanto al tipo nella colonna Dove. Anche il riepilogo di `/regia` li elenca.

**Token.** A ogni `turn.complete` di un subagente la mod somma ingresso, uscita, lettura e scrittura della cache in quella stessa memoria. Il pane, se c'è spazio, ha una colonna Token (`12k`, `1.4M`, cache comprese): è la prima a cedere.

## Posta fra agenti

Una casella sola, `~/.claude/regia/posta/posta.jsonl`: una riga JSON per messaggio (`id`, `da`, `a`, `testo`, `ora`, `sessione`, `stato`, `via`) e una per ogni cambio di stato (`nuovo` → `consegnato` → `letto`, oppure `errore` con una nota). Si scrive solo con la CLI `posta` (lucchetto `flock`), così la mod e i Codex non si sovrascrivono.

**Indirizzi.** `principale` (la sessione che possiede l'agente), `utente`, il nome (`Agent({ name })`) o l'id di un subagente Claude in corso, il nome di un lavoro Codex in corso. Un subagente concluso, un Codex finito o un nome che non c'è danno un errore che spiega perché e quali indirizzi valgono ora; il messaggio non entra in casella.

**Da Claude**: i tool `posta_invia(a, testo)` e `posta_leggi()`, nel prompt da subito e disponibili anche ai subagenti. Il mittente si ricava dall'`agentId` della chiamata: `principale` per la conversazione principale, il nome (o l'id) per un subagente.

**Consegna:**

- a un subagente Claude in corso: `$.session.append({ agentId, message: { type: 'user', ... } })`, quindi arriva davvero nel suo loop (dal prossimo giro), con l'invito a rispondere con `posta_invia`;
- alla principale: la stessa riga nella conversazione principale più un avviso (toast). Se la sessione è ferma, il modello la legge al turno successivo: la mod non avvia turni da sola;
- alla persona: un avviso e la riga nella sezione POSTA del pane;
- a un Codex: resta in casella e Codex la legge da sé.

**Da Codex**: la CLI `posta` (python3 `-I`, solo libreria standard) sta nel plugin (`script/posta`) e `session.start` la copia o aggiorna in `~/.claude/regia/bin/posta`.

```
~/.claude/regia/bin/posta leggi <mio-nome>                         # stampa i nuovi per me e li segna letti
~/.claude/regia/bin/posta invia principale "testo" --da <mio-nome>
~/.claude/regia/bin/posta elenco                                   # gli ultimi 20, per chi guarda
```

`codex_avvia` accoda al prompt un paragrafo «Posta della regia» che spiega a Codex come leggere la posta fra un passo e l'altro e come scrivere alla principale. La sessione del messaggio viene da `CLAUDE_CODE_SESSION_ID`, che lo script di lancio esporta. Ogni 5 secondi la mod guarda la casella e consegna ai Claude della propria sessione i messaggi nuovi scritti da Codex (o li segna `errore` se il destinatario non c'è più).

**SendMessage.** I messaggi fra agenti Claude mandati con SendMessage finiscono in casella come specchio (`via: SendMessage`, già consegnati o in errore): la mod osserva i `tool.call` di SendMessage dopo `next`.

**Nel pane:**

- sezione **POSTA** con gli ultimi 5 messaggi: stato (`●` nuovo, `✓` consegnato, `✓` attenuato letto, `✗` errore), ora, `da → a`, testo troncato;
- ogni agente in corso ha `✉ scrivi`, che apre in cima al pane un campo di testo (`Input`): Invio manda da `utente`, `✕ annulla` lo chiude. Sulla superficie mobile, che non ha campi di testo, il riquadro lo dice;
- `▸ apri` resta per i subagenti Claude.

## Riprendere un Codex finito: `codex_riprendi`

`codex exec resume <id sessione> [PROMPT]` esiste (codex-cli 0.163), quindi c'è il tool `codex_riprendi(nome, messaggio)` e, nei Fatti, il tasto `↻ riprendi` su ogni lavoro Codex con un log. L'id della sessione Codex si legge da `<nome>.sessione` (che lo script scrive a fine giro) o dall'intestazione del log (`session id: …`), dove ci sono anche cartella, modello e sforzo. Il lancio è quello di `codex_avvia` (staccato, `esegui.log`, tentativi su «at capacity») con `REGIA_RIPRENDI` nell'ambiente: lo script entra nella cartella del lavoro (`resume` non ha `-C`) e manda il messaggio da `<nome>.riprendi.md`. Il log e l'esito del giro prima vanno in coda a `<nome>.storico.log`. Funziona anche per i lavori dei log in `codexLogs`: il log si cerca accanto a quelli configurati. Un lavoro ancora in corso si rifiuta: a lui si scrive con `posta_invia`.

## Scaletta

Il tool `scaletta_scrivi(id, titolo, stato, note)` scrive in `~/.claude/regia/registro.json`, che il pane legge: `stato` e `scaletta`, `in_corso`, `fatto`, `bloccato`, oppure `rimossa` per togliere la voce. Ogni voce ricorda la sessione che l'ha scritta; quelle aggiunte a mano nel file, senza sessione, valgono per tutte.

## Vista "questa sessione": come si decide che cos'è mio

- **Subagenti Claude**: `$.agent.list()` è già della sola sessione.
- **Codex lanciati con `codex_avvia`**: sono della sessione dal momento del lancio (memoria `regia.agenti.<id>`).
- **Codex**: i processi `codex exec` ereditano le variabili d'ambiente della Bash di Claude, tra cui `CLAUDE_CODE_SESSION_ID`. La mod le legge da `/proc/<pid>/environ` (un solo `grep -az` per tutti i pid) e le confronta con `$.session.id()`. Funziona anche se il processo è stato riadottato da init dopo `nohup`/`setsid`, cosa che una risalita dei processi padre non regge.
- **Fatti**: `esegui.log` è condiviso e non dice chi ha lanciato cosa. Ogni volta che la mod vede vivo un codex della sessione ne ricorda il nome in `$.store` (`regia.sessione.<id>`); quando finisce, esito e commit vengono dalla riga `fine` del log. Le memorie ferme da oltre 30 giorni vengono tolte.
- **Scaletta**: le voci di questa sessione e quelle senza sessione; la vista «tutti» mostra ogni voce.

Dove può sbagliare:

- un Codex che nasce e muore tra due letture (meno di 15 secondi) non viene mai visto vivo e non finisce nello storico della sessione, ma resta nella vista "tutti";
- un processo lanciato fuori dalla Bash di Claude (un terminale a parte) o il cui ambiente non è leggibile non è attribuibile: compare solo in "tutti";
- dopo `--resume` o `/clear` l'id di sessione cambia: i processi lanciati prima restano della sessione di allora;
- se due sessioni lanciano un lavoro con lo stesso nome, lo storico di quel nome compare in entrambe.

Per ogni riga: nome del lavoro, esecutore (`claude` o `codex`), modello (con l'effort per Codex), durata, cartella o tipo di agente, esito breve (exit code, numero di commit). Il file `.esito.md` non è più mostrato.

## Fonti

1. **Subagenti Claude** della sessione, da `$.agent.list()`. In corso solo `running`, `pending` e `waiting` (e `idle` per un teammate, che aspetta messaggi); `completed` e un subagente `idle` vanno nei Fatti come completati, `failed` e `killed` come falliti e fermati.
2. **Codex in esecuzione**: `ps -ww -eo pid,etime,args`, righe `codex exec`. Si estraggono `-m` (modello), `-c model_reasoning_effort=...`, `-C` (cartella) e `-o` (il nome del lavoro è il basename senza `.esito.md`). I processi duplicati dal launcher npm (stesso `-o`) contano una volta.
3. **Storico Codex**: `~/.claude/regia/codex/esegui.log`, scritto da `codex_avvia`, piu i log in `codexLogs` se ne hai altri, con righe come:
   ```
   14:14 inizio lavoro-alfa
   13:10 fine lavoro-beta (exit 0, commit 5)
   ```
   Un `inizio` senza `fine` e con processo vivo è in corso; senza processo vivo è `interrotto`. Un exit code diverso da 0 è `fallito`.
4. **Registro della scaletta**: `~/.claude/regia/registro.json` (lo crea `scaletta_scrivi`; se manca la scaletta resta "(vuota)"):
   ```json
   {
     "lavori": [
       {
         "id": "lavoro-alfa",
         "titolo": "Il lavoro da fare",
         "stato": "scaletta",
         "esecutore": "codex",
         "worktree": "~/progetto/.worktrees/lavoro-alfa",
         "ramo": "feat/lavoro-alfa",
         "note": "dopo il lavoro beta",
         "aggiornato": "2026-10-29T12:00:00Z"
       }
     ]
   }
   ```
   `id`, `titolo` e `stato` sono obbligatori; `stato` è `scaletta`, `in_corso`, `fatto` o `bloccato` (i bloccati stanno in scaletta, segnati). Le voci non valide si saltano e il pane mostra quante.
5. **Config opzionale** `~/.claude/regia/config.json`:
   ```json
   {
     "codexLogs": ["~/percorso/esegui.log"],
     "aggiornamentoSecondi": 15,
     "instradamento": true,
     "modelli": { "mio-agente": "opus" },
     "orchestra": "stretta",
     "risparmio": true,
     "sciameParallelo": 4,
     "codexModello": "nome-del-modello"
   }
   ```
   `~` viene espanso. `codexLogs` e `aggiornamentoSecondi` si leggono all'avvio della mod (dopo una modifica serve ricaricarla); le altre a ogni uso.

Se una fonte fallisce il pane mostra una riga di avviso in giallo e le altre continuano.

## Limiti noti

- `AgentInfo` non espone il modello né l'ora di inizio dei subagenti: il modello si conosce solo per gli agenti partiti con la mod già caricata (dallo spawn), gli altri hanno `—`; la durata parte da quando la mod li ha visti. Se un subagente c'era già alla prima lettura (mod appena caricata, sessione ripresa) la durata è scritta `≥3m`, un minimo; se era già concluso è `—`.
- Il motore toglie da `$.agent.list()` i subagenti conclusi dopo un po': la mod li ricorda in `$.store` (chiave della sessione, accanto ai nomi Codex: nome, tipo, esito, ora in cui li ha visti finire, al più 50) e li tiene nei Fatti, senza più il tasto `▸ apri`. Un subagente che nasce e finisce tra due letture non viene mai visto.
- I log degli script hanno solo l'ora (`HH:MM`), senza data: le durate dei lavori conclusi sono al minuto e l'ordine dei "Fatti" segue il log, non un calendario. Con più log, i fatti dei subagenti Claude vengono per primi, poi quelli Codex, poi quelli del registro.
- Nel log i nomi dei lavori possono contenere spazi e le righe con l'ora ma senza `inizio`/`fine` ("18:29 TUTTO FINITO") sono annotazioni: si ignorano senza avviso. Una riga senza ora conta come non riconosciuta.
- La scelta non vede `model:` ed `effort:` delle definizioni nei plugin né in sottocartelle di `.claude/agents/`: per un tipo così, se la definizione ha un modello suo, mettilo in config con `"inherit"`.
- Gli agenti di un workflow (`Workflow`) non passano dal tool Agent: modello e sforzo li decide lo script.
- I token contano solo i turni dei subagenti finiti con la mod caricata.
- Un Codex che finisce in pochi secondi passa direttamente nei Fatti (non viene mai visto vivo), ma resta della sessione grazie alla memoria del lancio.
- Posta: la principale, se è ferma, legge un messaggio solo al turno successivo; un messaggio a un subagente arriva al suo prossimo giro di loop (non interrompe un comando lungo). La casella cresce senza potatura: la mod ne legge le ultime 4000 righe.
- Un messaggio di un Codex lanciato fuori dalla Bash di Claude non ha sessione: nessuno lo consegna, si vede solo nella vista «tutti».
- A pane stretto la colonna dei tasti cede e resta cliccabile solo il nome del lavoro (il tasto principale): `✉ scrivi` e `↻ riprendi` richiedono un pane abbastanza largo.
- Un wrapper che non sia `codex exec` direttamente (per esempio `bash -c "codex exec ..."`) non viene riconosciuto.

## Sviluppo

I parser e la lavagna sono puri (`hooks/parsers.ts`, `hooks/registro.ts`, `hooks/instradamento.ts`, `hooks/sciame.ts`) e testati a parte; il motore dello sciame sta in `hooks/sciame-motore.ts`, la delega in `hooks/orchestra.ts`. Il disegno sta in `hooks/tavola.tsx` (tabella, regole, riquadri, pillole), `hooks/layout.ts` (celle e colonne, puro) e `hooks/vista.tsx` (composizione). `tests/resa.ts` trasforma l'albero disegnato in righe di testo, così i test controllano che a 40, 60, 80 e 120 colonne nessuna riga superi la larghezza. Controlli:

```sh
claude plugin validate .
claude plugin test .
```

## Riconoscimenti

Tecniche di layout riprese da [cc-vitals](https://github.com/naicud/cc-vitals) di naicud (licenza MIT): misura delle celle (`cellWidth`), colonne che cedono per priorità (`fitColumns`), tabella con `│` e regola `─┼─`, regola di sezione, tacche dello sforzo e spinner. Il codice ripreso e adattato sta in `hooks/tavola.tsx`.

## Licenza

MIT, vedi [LICENSE](LICENSE).
