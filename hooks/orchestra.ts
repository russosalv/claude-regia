// Come lavora la conversazione principale, secondo la modalita della sessione
// (`/regia long|medium|quick`) e la squadra (`/regia team`). La regola viaggia
// con la mod (e non con la memoria di un progetto o di un PC): una sezione del
// prompt di sistema e, in long con `orchestra stretta`, il rifiuto delle
// modifiche ai file del progetto. Vale solo nelle sessioni con una superficie:
// `claude -p` e gli SDK fanno da se.

import type { EngineInterface } from 'claude-code'

import { leggiConfig, leggiHome } from './fonti'
import { leggiProfilo } from './profilo'
import type { Profilo } from './profilo'
import { SQUADRA_PREDEFINITA } from './registro'
import type { ConfigRegia, Squadra } from './registro'

export const ID_SEZIONE = 'regia:orchestra'

const SE_SUBAGENTE = 'Se sei un subagente, ignora questa sezione ed esegui il tuo compito.'

/** Vale in ogni modalita: la persona non legge tutto e spesso risponde dal telefono. */
const REGOLA_DOMANDE = [
  '## Domande alla persona',
  'La persona non legge tutto cio che scrivi e spesso risponde dal telefono: ogni domanda deve stare in piedi da sola.',
  '- Mai "per la domanda 1 cosa facciamo?" o "procedo?": ripeti ogni volta, in due o tre righe, a che punto sei, che cosa si decide, le opzioni con le conseguenze e la tua raccomandazione.',
]

const REGOLA_DOMANDE_TOOL = '- Ogni decisione che spetta alla persona registrala anche con `mcp__regia__domanda_scrivi` (contesto completo, opzioni, raccomandazione): la vede nel pane e, se non e al PC, le arriva una notifica. Quando risponde in chat chiudila con stato `risolta`. Mentre aspetti, porta avanti cio che non dipende dalla risposta.'

// NONoise (https://github.com/russosalv/NONoise) ha le stesse tre modalita, scritte
// nel progetto in `.nonoise/sdlc-flow.md`. La regola resta statica: e il modello
// a guardare se il file c'e, cosi la sezione non cambia da un progetto all'altro.
const SE_NONOISE: Readonly<Record<Profilo, string>> = {
  long: '- Se il progetto ha `.nonoise/sdlc-flow.md` (NONoise), le fasi del lavoro sono quelle che il file assegna a `long`: mettile in scaletta in quell\'ordine, con `fase`, e usa la skill che ogni fase indica. La validazione FPF (`arch-decision`) proponila solo se la decisione e costosa da invertire e ha piu opzioni valide, o se la persona la chiede; altrimenti la scelta si registra nel PRD come decisione lightweight.',
  medio: '- Se il progetto ha `.nonoise/sdlc-flow.md` (NONoise), vale la sua modalita `medium`: spec breve, piano, sviluppo, verifica. Niente fasi di requisiti o architettura, e niente validazione FPF salvo una decisione costosa da invertire con piu opzioni valide.',
  quick: 'Se il progetto ha `.nonoise/sdlc-flow.md` (NONoise), vale la sua modalita `quick`: nessuna fase, nessun documento, nessuna validazione FPF.',
}

const LAVORI_INDIPENDENTI = '- Lavori indipendenti: piu chiamate ad Agent nello stesso messaggio, senza aspettare l\'una per l\'altra.'
const SCIAME_DA_TRE = '- Tre o piu compiti, o compiti con dipendenze: `mcp__regia__sciame_avvia` (schema con ToolSearch). Gestisce coda, parallelismo, ripresa di chi fallisce e dipendenze; ti scrive lui alla fine, non controllarlo.'

/** In long, chi fa il lavoro delegato: dipende dalla squadra (`/regia team`). La quota non compare: il testo resta lo stesso se cambia. */
const SQUADRA_LONG: Readonly<Record<Squadra, readonly string[]>> = {
  claude: [
    LAVORI_INDIPENDENTI,
    SCIAME_DA_TRE,
    '- La squadra di sviluppo e Claude: i subagenti (Agent) e i compiti dello sciame. Gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) si usano solo quando la persona li nomina, con `esecutore` nello sciame o con `mcp__regia__codex_avvia`, `mcp__regia__qoder_avvia` (i modelli Qwen: preferito a `mcp__regia__qwen_avvia`, che resta per Qwen Code), `mcp__regia__qwen_avvia`, `mcp__regia__copilot_avvia`.',
  ],
  mista: [
    LAVORI_INDIPENDENTI,
    `${SCIAME_DA_TRE} Non indicare \`esecutore\`: la mod tiene lo sviluppo principale su Claude e da agli esecutori esterni accesi i compiti che gli si addicono (lavoro meccanico o in blocco, documentazione, test, revisioni indipendenti, seconde implementazioni), entro la quota. Indicalo solo se la persona lo chiede.`,
    '- La squadra di sviluppo e Claude, come subagenti (Agent) e come compiti dello sciame; gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) sono rinforzi, non un sostituto.',
  ],
  esterni: [
    '- Lavori indipendenti legati a questa sessione (i suoi tool e server MCP, una skill, un tipo di agente, cio che si e detto qui): piu chiamate ad Agent nello stesso messaggio, senza aspettare l\'una per l\'altra.',
    '- Due o piu compiti indipendenti e autosufficienti, o compiti con dipendenze: `mcp__regia__sciame_avvia` (schema con ToolSearch). Gestisce coda, parallelismo, ripresa di chi fallisce e dipendenze; ti scrive lui alla fine, non controllarlo. Non indicare `esecutore`: per ogni compito lo sceglie la mod fra Claude e gli esecutori esterni accesi, come fa per modello e sforzo.',
    '- Gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) fanno parte della squadra: usali senza aspettare che la persona lo chieda. Anche un solo compito lungo e autosufficiente lancialo come sciame di un compito, cosi riceve il suo esecutore. `mcp__regia__codex_avvia`, `mcp__regia__qoder_avvia` (i modelli Qwen: preferito a `mcp__regia__qwen_avvia`, che resta per Qwen Code), `mcp__regia__qwen_avvia` e `mcp__regia__copilot_avvia` servono quando la persona nomina l\'esecutore.',
  ],
}

/** In medio la principale lavora lei: con squadra `claude` dello sciame e degli esterni non si dice nulla. */
const SQUADRA_MEDIO: Readonly<Record<Squadra, readonly string[]>> = {
  claude: [],
  mista: ['- I pezzi indipendenti vanno a chiamate ad Agent; se li metti in uno sciame (`mcp__regia__sciame_avvia`, schema con ToolSearch) non indicare `esecutore`: la mod da quelli adatti agli esecutori esterni accesi (Codex, Qoder, Qwen Code, Copilot), entro la quota, e tiene gli altri su Claude.'],
  esterni: ['- I pezzi indipendenti e autosufficienti possono andare anche in uno sciame (`mcp__regia__sciame_avvia`, schema con ToolSearch) senza indicare `esecutore`: la mod li distribuisce fra Claude e gli esecutori esterni accesi (Codex, Qoder, Qwen Code, Copilot).'],
}

const testoLong = (squadra: Squadra): string => [
  '# Regia: modalita LONG, sei l\'orchestratore',
  `Questo vale sopra l'indicazione generica del tool Agent di fare da te i lavori piccoli. ${SE_SUBAGENTE}`,
  '',
  'Fai le veci della persona su un lavoro lungo: scomponi, deleghi, controlli gli esiti, tieni il piano in moto e ti assicuri che i subagenti lavorino e non si blocchino.',
  '- Le cose rapide falle tu: una risposta, una lettura mirata, una modifica di poche righe. Delega cio che e lungo, ampio o parallelizzabile: studi di architettura, sviluppi, ricerche ampie (agente Explore), suite di test e build.',
  '- Compito autosufficiente: obiettivo, file, vincoli, cosa non toccare. Chi scrive in parallelo usa `isolation: "worktree"`.',
  '- Non indicare `model` ne `effort` nella chiamata ad Agent: li sceglie la mod guardando il compito. Indicali solo se la persona lo chiede o se riprovi un lavoro fallito (allora un gradino sopra).',
  ...SQUADRA_LONG[squadra],
  '- Il piano: prima di partire scrivi ogni voce con `mcp__regia__scaletta_scrivi`, con `descrizione` (la macro-attivita spiegata alla persona: che cosa, perche, che cosa ne esce) e `fase`. La persona la legge nel pane come tasklist. Tienila aggiornata (`in_corso`, `fatto`, `bloccato` con il motivo). Porta avanti il piano fino in fondo senza chiedere il permesso a ogni voce: finche restano voci aperte e nessuno lavora, la regia ti risveglia.',
  '- Controlla gli agenti: uno che non da segni di vita o gira a vuoto fermalo (TaskStop) e rilancia il compito, piu chiaro o un gradino sopra.',
  SE_NONOISE.long,
  '',
  ...REGOLA_DOMANDE,
  REGOLA_DOMANDE_TOOL,
].join('\n')

const testoMedio = (squadra: Squadra): string => [
  '# Regia: modalita MEDIA',
  SE_SUBAGENTE,
  '',
  'Lavori tu sul compito. Delega solo cio che conviene: pezzi indipendenti da fare in parallelo (piu chiamate ad Agent nello stesso messaggio, `isolation: "worktree"` per chi scrive) e ricerche ampie (agente Explore). Non indicare `model` ne `effort` nella chiamata ad Agent: li sceglie la mod.',
  ...SQUADRA_MEDIO[squadra],
  '- Se il lavoro ha piu passi, scrivili con `mcp__regia__scaletta_scrivi` (con `descrizione`): la persona li vede nel pane come tasklist.',
  '- Se il lavoro si rivela lungo (molti sviluppi, ore di lavoro), proponi alla persona `/regia long`.',
  SE_NONOISE.medio,
  '',
  ...REGOLA_DOMANDE,
  REGOLA_DOMANDE_TOOL,
].join('\n')

// Quick lavora da sola: la squadra non cambia nulla.
const TESTO_QUICK = [
  '# Regia: modalita QUICK',
  SE_SUBAGENTE,
  '',
  'Lavora da sola, senza subagenti ne Codex, salvo che la persona li chieda: risposte e modifiche rapide e dirette. Se il compito si rivela grande, dillo e proponi `/regia medium` o `/regia long`.',
  SE_NONOISE.quick,
  '',
  ...REGOLA_DOMANDE,
].join('\n')

const perSquadra = (testo: (squadra: Squadra) => string): Readonly<Record<Squadra, string>> =>
  ({ claude: testo('claude'), mista: testo('mista'), esterni: testo('esterni') })

/** Statici per modalita e per squadra, composti una volta sola: cosi restano in cache da un giro all'altro. */
export const TESTI_ORCHESTRA: Readonly<Record<Profilo, Readonly<Record<Squadra, string>>>> = {
  long: perSquadra(testoLong),
  medio: perSquadra(testoMedio),
  quick: perSquadra(() => TESTO_QUICK),
}

const STRUMENTI_DI_SCRITTURA = new Set(['Edit', 'Write', 'NotebookEdit'])

/** Il file che una chiamata vuole modificare, se e uno strumento di scrittura. */
export function fileDaScrivere(e: { tool: string; file_path?: unknown; notebook_path?: unknown }): string | undefined {
  if (!STRUMENTI_DI_SCRITTURA.has(e.tool)) return undefined
  const percorso = e.file_path ?? e.notebook_path

  return typeof percorso === 'string' ? percorso : undefined
}

/** Vero per un file del progetto; le impostazioni in `.claude/` restano libere. */
export function isDelProgetto(file: string, radice: string): boolean {
  return file.startsWith(`${radice.replace(/\/+$/, '')}/`) && !file.slice(radice.length).startsWith('/.claude/')
}

export const RIFIUTO_SCRITTURA =
  'regia: sei l\'orchestratore, le modifiche ai file del progetto le fa un delegato: lancia un Agent con questo compito (senza model ne effort, li sceglie la mod). Se la persona vuole che lo faccia tu, chiedile di passare a /regia orchestra guide.'

/** Cio che della config decide la regola: il modo dell'orchestra e la squadra. */
async function regolaCorrente($: EngineInterface): Promise<Pick<ConfigRegia, 'orchestra' | 'squadra'>> {
  const home = await leggiHome($)

  return home === undefined ? { orchestra: 'guida', squadra: SQUADRA_PREDEFINITA } : (await leggiConfig($, home)).dati
}

/** Il prompt di sistema con la sezione in coda; senza Agent, o senza superficie, com'e. */
export async function sezioniConOrchestra<S extends { id: string }>(
  $: EngineInterface,
  e: { tools: readonly string[]; surfaces: readonly unknown[]; traits: readonly string[] },
  sezioni: readonly S[],
  nuova: (testo: string) => S,
): Promise<readonly S[]> {
  const isEscluso = !e.tools.includes('Agent') || e.surfaces.length === 0 || e.traits.includes('teammate') || e.traits.includes('print')
  if (isEscluso) return sezioni
  const { orchestra, squadra } = await regolaCorrente($)
  if (orchestra === 'off') return sezioni

  return [...sezioni, nuova(TESTI_ORCHESTRA[(await leggiProfilo($)).profilo][squadra])]
}

/** Il motivo per fermare una scrittura della principale, o `undefined` se puo passare. */
export async function motivoRifiuto(
  $: EngineInterface,
  e: { tool: string; agentId?: string; file_path?: unknown; notebook_path?: unknown },
): Promise<string | undefined> {
  const file = e.agentId === undefined ? fileDaScrivere(e) : undefined
  // `stretta` vale solo in long: in medio e quick la principale lavora lei.
  if (file === undefined || (await regolaCorrente($)).orchestra !== 'stretta' || (await leggiProfilo($)).profilo !== 'long') return undefined
  if ((await $.session.surfaces()).length === 0) return undefined
  const repo = await $.session.repo().catch(() => undefined)
  const radice = repo?.root ?? (await $.session.cwd().catch(() => undefined))
  if (radice === undefined || !isDelProgetto(file, radice)) return undefined
  const strumenti = await $.tool.list()

  return strumenti.some(t => t.name === 'Agent') ? RIFIUTO_SCRITTURA : undefined
}

// Il risparmio vero sta qui: un delegato che scrive meno e riferisce in breve
// costa meno a lui e alla principale, che legge il suo rapporto a ogni giro.
export const REGOLA_RAPPORTO = 'Rapporto finale breve: che cosa hai fatto, file toccati, ramo e commit, test ed esito, rischi. Niente copie di file o di log.'

export const REGOLA_SOBRIETA = 'Scrivi il minimo che risolve il compito: riusa cio che c\'e, libreria standard prima di una dipendenza, niente astrazioni o opzioni non chieste, non rifattorizzare cio che non ti e stato chiesto. Non tagliare mai validazione ai confini, sicurezza, gestione dei dati, ne i test della logica rischiosa.'

/** Ponytail, se attivo, porta gia la sua regola ai subagenti: non la si ripete. */
export async function isPonytailAttivo($: EngineInterface): Promise<boolean> {
  try {
    const attivi = await $.settings.read({ key: 'enabledPlugins' }) as Record<string, unknown> | undefined

    return Object.entries(attivi ?? {}).some(([nome, valore]) => nome.startsWith('ponytail@') && valore === true)
  } catch {
    return false
  }
}

/** Il prompt di un delegato Claude con le regole di risparmio in coda. */
export async function conRisparmio($: EngineInterface, prompt: string): Promise<string> {
  const home = await leggiHome($)
  if (home !== undefined && !(await leggiConfig($, home)).dati.risparmio) return prompt
  const regole = (await isPonytailAttivo($)) ? [REGOLA_RAPPORTO] : [REGOLA_SOBRIETA, REGOLA_RAPPORTO]

  return `${prompt.trimEnd()}\n\n${regole.join('\n')}`
}
