// Registro della scaletta e config opzionale: validazione pura.

import { ESECUTORI_CLI } from './codex'
import type { EsecutoreCli } from './codex'
import { espandiTilde } from './parsers'

export type StatoRegistro = 'scaletta' | 'in_corso' | 'fatto' | 'bloccato'

export type VoceRegistro = {
  id: string
  titolo: string
  stato: StatoRegistro
  esecutore?: string
  modello?: string
  worktree?: string
  ramo?: string
  note?: string
  /** La macro-attivita spiegata alla persona: che cosa si fa e perche. */
  descrizione?: string
  /** Gruppo del piano (fase, area), per la tasklist del pane. */
  fase?: string
  aggiornato?: string
  /** La sessione che l'ha scritta con `scaletta_scrivi`; senza, vale per tutte. */
  sessione?: string
}

export type ConfigRegia = {
  codexLogs: string[]
  aggiornamentoSecondi: number
  /** Modello e sforzo decisi compito per compito (`/regia models on|off`). */
  instradamento: boolean
  /** Tipo di agente → modello fisso; senza voce decide il compito. */
  modelli: Readonly<Record<string, string>>
  /** Modello di `codex_avvia` quando la chiamata non lo dice; senza, decide Codex. */
  codexModello?: string
  /** Modello di `copilot_avvia` quando la chiamata non lo dice; senza, decide Copilot. */
  copilotModello?: string
  /** Quanto la conversazione principale e tenuta a delegare (`/regia orchestra`). */
  orchestra: ModoOrchestra
  /** Regole di sobrieta nei prompt dei delegati (`/regia savings on|off`). */
  risparmio: boolean
  /** La mod installa Ponytail quando e nuova o aggiornata (`/regia ponytail on|off`). */
  ponytail: boolean
  /** La mod installa i plugin di Codex e di Qwen per Claude Code, se la CLI c'e (`/regia codex|qwen on|off`). */
  pluginCodex: boolean
  pluginQwen: boolean
  /** Compiti di uno sciame che girano insieme, se la chiamata non lo dice. */
  sciameParallelo: number
  /** La sorveglianza: agenti fermi e sveglia della principale col piano aperto (`/regia wake on|off`). */
  sveglia: boolean
  /** Minuti senza segni di vita dopo cui un agente in corso e considerato fermo. */
  stalloMinuti: number
  /** Minuti oltre i quali un compito dello sciame fermo in attesa di un suo comando in background e dato per fermo. */
  attesaMinuti: number
  /** Le attese del controllo di paracadute della sveglia, in minuti; l'ultima resta fissa. */
  controlloMinuti: number[]
  /** Il modello della principale in modalita quick (`/regia quick`). */
  quickModello: string
  /** Gli esecutori esterni che la mod puo usare (`/regia executors`); lista vuota: lavora solo Claude. */
  esecutori: EsecutoreCli[]
  /** Chi sviluppa: solo Claude, Claude con gli esterni di rinforzo, o gli esterni per tutto cio che e autosufficiente (`/regia team`). */
  squadra: Squadra
  /** In `mista`, la parte piu grande dei compiti assegnati dalla mod in uno sciame che puo andare agli esterni, in percento (`/regia team <numero>`). */
  squadraQuota: number
  /** La mod compatta la principale oltre la soglia e da le sue istruzioni a ogni compattazione (`/regia compact on|off`). */
  compatta: boolean
  /** Riempimento del contesto, in percento, oltre cui la mod compatta a fine turno (`/regia compact <numero>`). */
  compattaSoglia: number
}

export const AGGIORNAMENTO_PREDEFINITO_SEC = 15
export const AGGIORNAMENTO_MINIMO_SEC = 2
export const AGGIORNAMENTO_MASSIMO_SEC = 3600
/** Il log dei lavori lanciati da `codex_avvia`, sempre tra le fonti. */
export const LOG_CODEX_REGIA = '.claude/regia/codex/esegui.log'
/** Il log dei lavori lanciati da `qwen_avvia`, sempre tra le fonti. */
export const LOG_QWEN_REGIA = '.claude/regia/qwen/esegui.log'
/** Il log dei lavori lanciati da `copilot_avvia`, sempre tra le fonti. */
export const LOG_COPILOT_REGIA = '.claude/regia/copilot/esegui.log'
export const SCIAME_PARALLELO_PREDEFINITO = 4
export const MODI_ORCHESTRA = ['stretta', 'guida', 'off'] as const
export type ModoOrchestra = (typeof MODI_ORCHESTRA)[number]
export const SQUADRE = ['claude', 'mista', 'esterni'] as const
export type Squadra = (typeof SQUADRE)[number]
export const SQUADRA_PREDEFINITA: Squadra = 'mista'
export const QUOTA_SQUADRA_PREDEFINITA = 50

const STATI_REGISTRO: readonly string[] = [
  'scaletta',
  'in_corso',
  'fatto',
  'bloccato',
]
const CAMPI_TESTO_REGISTRO = [
  'esecutore',
  'modello',
  'worktree',
  'ramo',
  'note',
  'descrizione',
  'fase',
  'aggiornato',
  'sessione',
] as const

function isTestoOpzionale(valore: unknown): boolean {
  return valore === undefined || typeof valore === 'string'
}

function leggiVoceRegistro(grezza: unknown): VoceRegistro | undefined {
  if (typeof grezza !== 'object' || grezza === null) return undefined
  const o = grezza as Record<string, unknown>
  const { id, titolo, stato } = o
  const isValida =
    typeof id === 'string' && id.trim() !== '' &&
    typeof titolo === 'string' && titolo.trim() !== '' &&
    typeof stato === 'string' && STATI_REGISTRO.includes(stato) &&
    CAMPI_TESTO_REGISTRO.every(campo => isTestoOpzionale(o[campo]))
  if (!isValida) return undefined

  return {
    id, titolo, stato: stato as StatoRegistro,
    esecutore: o.esecutore as string | undefined,
    modello: o.modello as string | undefined,
    worktree: o.worktree as string | undefined,
    ramo: o.ramo as string | undefined,
    note: o.note as string | undefined,
    descrizione: o.descrizione as string | undefined,
    fase: o.fase as string | undefined,
    aggiornato: o.aggiornato as string | undefined,
    sessione: o.sessione as string | undefined,
  }
}

/** Le voci valide del registro; quelle non valide si saltano e si contano. */
export function validaRegistro(radice: unknown): {
  lavori: VoceRegistro[]
  scartate: number
  errore?: string
} {
  const lavori = (radice as { lavori?: unknown } | null)?.lavori
  if (typeof radice !== 'object' || radice === null || !Array.isArray(lavori)) {
    return { lavori: [], scartate: 0, errore: 'atteso { "lavori": [ ... ] }' }
  }
  const lette = lavori.map(leggiVoceRegistro)
  const valide = lette.filter((v): v is VoceRegistro => v !== undefined)

  return { lavori: valide, scartate: lette.length - valide.length }
}

type Campo<T> = { valore: T; avvisi: string[] }

function campoLogs(grezzo: unknown, home: string): Campo<string[] | undefined> {
  if (grezzo === undefined) return { valore: undefined, avvisi: [] }
  const lista = Array.isArray(grezzo) ? grezzo : []
  const validi = lista.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  const avvisi = !Array.isArray(grezzo) || validi.length !== lista.length
    ? ['config.json: "codexLogs" deve essere una lista di percorsi']
    : []

  return { valore: validi.map(p => espandiTilde(p.trim(), home)), avvisi }
}

function campoSecondi(n: unknown): Campo<number | undefined> {
  if (n === undefined) return { valore: undefined, avvisi: [] }
  const isValido = typeof n === 'number' && Number.isFinite(n) &&
    n >= AGGIORNAMENTO_MINIMO_SEC && n <= AGGIORNAMENTO_MASSIMO_SEC

  return isValido
    ? { valore: n, avvisi: [] }
    : { valore: undefined, avvisi: [`config.json: "aggiornamentoSecondi" deve essere un numero tra ${AGGIORNAMENTO_MINIMO_SEC} e ${AGGIORNAMENTO_MASSIMO_SEC}`] }
}

function campoModelli(grezzo: unknown): Campo<Record<string, string>> {
  if (grezzo === undefined) return { valore: {}, avvisi: [] }
  if (typeof grezzo !== 'object' || grezzo === null || Array.isArray(grezzo)) {
    return { valore: {}, avvisi: ['config.json: "modelli" deve essere un oggetto { tipo: modello }'] }
  }
  const voci = Object.entries(grezzo as Record<string, unknown>)
  const valide = voci.filter((v): v is [string, string] => typeof v[1] === 'string' && v[1].trim() !== '')
  const avvisi = valide.length === voci.length ? [] : ['config.json: in "modelli" ogni valore deve essere il nome di un modello']

  return { valore: Object.fromEntries(valide.map(([k, v]) => [k, v.trim()])), avvisi }
}

function campoBooleano(grezzo: unknown, nome: string, predefinito: boolean): Campo<boolean> {
  if (grezzo === undefined) return { valore: predefinito, avvisi: [] }
  if (typeof grezzo === 'boolean') return { valore: grezzo, avvisi: [] }

  return { valore: predefinito, avvisi: [`config.json: "${nome}" deve essere true o false`] }
}

export const STALLO_PREDEFINITO_MIN = 30
export const ATTESA_PREDEFINITA_MIN = 45
export const CONTROLLO_PREDEFINITO_MIN: readonly number[] = [15, 30, 60]
export const QUICK_MODELLO_PREDEFINITO = 'sonnet'
export const SOGLIA_COMPATTA_PREDEFINITA = 60
export const SOGLIA_COMPATTA_MINIMA = 30
export const SOGLIA_COMPATTA_MASSIMA = 90

/** Vero per una soglia di compattazione valida: un intero fra la minima e la massima. */
export const isSogliaCompatta = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= SOGLIA_COMPATTA_MINIMA && n <= SOGLIA_COMPATTA_MASSIMA

function campoSogliaCompatta(grezzo: unknown): Campo<number> {
  if (grezzo === undefined) return { valore: SOGLIA_COMPATTA_PREDEFINITA, avvisi: [] }
  if (isSogliaCompatta(grezzo)) return { valore: grezzo, avvisi: [] }

  return { valore: SOGLIA_COMPATTA_PREDEFINITA, avvisi: [`config.json: "compattaSoglia" deve essere un intero da ${SOGLIA_COMPATTA_MINIMA} a ${SOGLIA_COMPATTA_MASSIMA}`] }
}

function campoStallo(grezzo: unknown): Campo<number> {
  if (grezzo === undefined) return { valore: STALLO_PREDEFINITO_MIN, avvisi: [] }
  if (typeof grezzo === 'number' && Number.isFinite(grezzo) && grezzo >= 5 && grezzo <= 1440) return { valore: grezzo, avvisi: [] }

  return { valore: STALLO_PREDEFINITO_MIN, avvisi: ['config.json: "stalloMinuti" deve essere un numero da 5 a 1440'] }
}

function campoAttesa(grezzo: unknown): Campo<number> {
  if (grezzo === undefined) return { valore: ATTESA_PREDEFINITA_MIN, avvisi: [] }
  if (typeof grezzo === 'number' && Number.isFinite(grezzo) && grezzo >= 5 && grezzo <= 1440) return { valore: grezzo, avvisi: [] }

  return { valore: ATTESA_PREDEFINITA_MIN, avvisi: ['config.json: "attesaMinuti" deve essere un numero da 5 a 1440'] }
}

function campoControllo(grezzo: unknown): Campo<number[]> {
  if (grezzo === undefined) return { valore: [...CONTROLLO_PREDEFINITO_MIN], avvisi: [] }
  const isValido = Array.isArray(grezzo) && grezzo.length >= 1 && grezzo.length <= 8 &&
    grezzo.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 5 && n <= 1440)
  if (isValido) return { valore: grezzo as number[], avvisi: [] }

  return { valore: [...CONTROLLO_PREDEFINITO_MIN], avvisi: ['config.json: "controlloMinuti" deve essere una lista di 1-8 numeri da 5 a 1440'] }
}
/** Il nome con cui comandi e config chiamano un modo. I nomi italiani restano validi. */
export const NOME_MODO: Readonly<Record<ModoOrchestra, string>> = { stretta: 'strict', guida: 'guide', off: 'off' }

function campoOrchestra(grezzo: unknown): Campo<ModoOrchestra> {
  const modo = MODI_ORCHESTRA.find(m => m === grezzo || NOME_MODO[m] === grezzo)
  if (modo !== undefined) return { valore: modo, avvisi: [] }

  return { valore: 'guida', avvisi: grezzo === undefined ? [] : [`config.json: "orchestra" deve essere ${Object.values(NOME_MODO).join(', ')}`] }
}

/** Il nome con cui comandi e config chiamano una squadra. I nomi italiani restano validi. */
export const NOME_SQUADRA: Readonly<Record<Squadra, string>> = { claude: 'claude', mista: 'mixed', esterni: 'external' }

/** La squadra scritta in un comando o in config, in inglese o in italiano. */
export const leggiSquadra = (grezzo: unknown): Squadra | undefined => SQUADRE.find(s => s === grezzo || NOME_SQUADRA[s] === grezzo)

function campoSquadra(grezzo: unknown): Campo<Squadra> {
  const squadra = leggiSquadra(grezzo)
  if (squadra !== undefined) return { valore: squadra, avvisi: [] }

  return { valore: SQUADRA_PREDEFINITA, avvisi: grezzo === undefined ? [] : [`config.json: "squadra" deve essere ${Object.values(NOME_SQUADRA).join(', ')}`] }
}

/** Vero per una quota degli esterni valida: un intero da 0 a 100. */
export const isQuotaSquadra = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100

function campoQuotaSquadra(grezzo: unknown): Campo<number> {
  if (grezzo === undefined) return { valore: QUOTA_SQUADRA_PREDEFINITA, avvisi: [] }
  if (isQuotaSquadra(grezzo)) return { valore: grezzo, avvisi: [] }

  return { valore: QUOTA_SQUADRA_PREDEFINITA, avvisi: ['config.json: "squadraQuota" deve essere un intero da 0 a 100'] }
}

function campoParallelo(grezzo: unknown): Campo<number> {
  if (grezzo === undefined) return { valore: SCIAME_PARALLELO_PREDEFINITO, avvisi: [] }
  if (typeof grezzo === 'number' && Number.isInteger(grezzo) && grezzo >= 1 && grezzo <= 16) return { valore: grezzo, avvisi: [] }

  return { valore: SCIAME_PARALLELO_PREDEFINITO, avvisi: ['config.json: "sciameParallelo" deve essere un intero da 1 a 16'] }
}

function campoTesto(grezzo: unknown, nome: string, predefinito?: string): Campo<string | undefined> {
  if (grezzo === undefined) return { valore: predefinito, avvisi: [] }
  if (typeof grezzo === 'string' && /^[\w.:-]{1,80}$/.test(grezzo.trim())) return { valore: grezzo.trim(), avvisi: [] }

  return { valore: predefinito, avvisi: [`config.json: "${nome}" non e un nome valido`] }
}

/** Gli esecutori esterni accesi: i nomi sconosciuti si tolgono, e si dice quali. */
function campoEsecutori(grezzo: unknown): Campo<EsecutoreCli[]> {
  if (grezzo === undefined) return { valore: [...ESECUTORI_CLI], avvisi: [] }
  const validi = ESECUTORI_CLI.join(', ')
  if (!Array.isArray(grezzo)) return { valore: [...ESECUTORI_CLI], avvisi: [`config.json: "esecutori" deve essere una lista fra ${validi}`] }
  const nomi = grezzo.map(n => (typeof n === 'string' ? n.trim().toLowerCase() : n))
  const ignoti = nomi.filter(n => !ESECUTORI_CLI.some(e => e === n))
  const avvisi = ignoti.length === 0 ? [] : [`config.json: in "esecutori" tolti i nomi sconosciuti ${ignoti.map(n => JSON.stringify(n)).join(', ')} (validi: ${validi})`]

  return { valore: ESECUTORI_CLI.filter(e => nomi.includes(e)), avvisi }
}

/** I log di `codex_avvia`, `qwen_avvia` e `copilot_avvia` in coda ai log scelti, una volta sola. */
function conLogRegia(logs: readonly string[], home: string): string[] {
  const regia = [LOG_CODEX_REGIA, LOG_QWEN_REGIA, LOG_COPILOT_REGIA].map(l => `${home}/${l}`)

  return [...logs, ...regia.filter(r => !logs.includes(r))]
}

/** Config opzionale: valori non validi tornano al predefinito, con un avviso. */
export function parseConfig(
  radice: unknown,
  home: string,
): { config: ConfigRegia; avvisi: string[] } {
  const predefinita: ConfigRegia = {
    codexLogs: conLogRegia([], home),
    aggiornamentoSecondi: AGGIORNAMENTO_PREDEFINITO_SEC,
    instradamento: true,
    modelli: {},
    orchestra: 'guida',
    risparmio: true,
    ponytail: true,
    pluginCodex: true,
    pluginQwen: true,
    sciameParallelo: SCIAME_PARALLELO_PREDEFINITO,
    sveglia: true,
    stalloMinuti: STALLO_PREDEFINITO_MIN,
    attesaMinuti: ATTESA_PREDEFINITA_MIN,
    controlloMinuti: [...CONTROLLO_PREDEFINITO_MIN],
    quickModello: QUICK_MODELLO_PREDEFINITO,
    esecutori: [...ESECUTORI_CLI],
    squadra: SQUADRA_PREDEFINITA,
    squadraQuota: QUOTA_SQUADRA_PREDEFINITA,
    compatta: true,
    compattaSoglia: SOGLIA_COMPATTA_PREDEFINITA,
  }
  if (typeof radice !== 'object' || radice === null || Array.isArray(radice)) {
    return { config: predefinita, avvisi: ['config.json: atteso un oggetto'] }
  }
  const o = radice as Record<string, unknown>
  const logs = campoLogs(o.codexLogs, home)
  const secondi = campoSecondi(o.aggiornamentoSecondi)
  const modelli = campoModelli(o.modelli)
  const instradamento = campoBooleano(o.instradamento, 'instradamento', true)
  const codexModello = campoTesto(o.codexModello, 'codexModello')
  const copilotModello = campoTesto(o.copilotModello, 'copilotModello')
  const orchestra = campoOrchestra(o.orchestra)
  const risparmio = campoBooleano(o.risparmio, 'risparmio', true)
  const ponytail = campoBooleano(o.ponytail, 'ponytail', true)
  const pluginCodex = campoBooleano(o.pluginCodex, 'pluginCodex', true)
  const pluginQwen = campoBooleano(o.pluginQwen, 'pluginQwen', true)
  const parallelo = campoParallelo(o.sciameParallelo)
  const sveglia = campoBooleano(o.sveglia, 'sveglia', true)
  const stallo = campoStallo(o.stalloMinuti)
  const attesa = campoAttesa(o.attesaMinuti)
  const controllo = campoControllo(o.controlloMinuti)
  const quick = campoTesto(o.quickModello, 'quickModello', QUICK_MODELLO_PREDEFINITO)
  const esecutori = campoEsecutori(o.esecutori)
  const squadra = campoSquadra(o.squadra)
  const quota = campoQuotaSquadra(o.squadraQuota)
  const compatta = campoBooleano(o.compatta, 'compatta', true)
  const soglia = campoSogliaCompatta(o.compattaSoglia)
  const config: ConfigRegia = {
    codexLogs: logs.valore === undefined ? predefinita.codexLogs : conLogRegia(logs.valore, home),
    aggiornamentoSecondi: secondi.valore ?? predefinita.aggiornamentoSecondi,
    instradamento: instradamento.valore,
    modelli: modelli.valore,
    orchestra: orchestra.valore,
    risparmio: risparmio.valore,
    ponytail: ponytail.valore,
    pluginCodex: pluginCodex.valore,
    pluginQwen: pluginQwen.valore,
    sciameParallelo: parallelo.valore,
    sveglia: sveglia.valore,
    stalloMinuti: stallo.valore,
    attesaMinuti: attesa.valore,
    controlloMinuti: controllo.valore,
    quickModello: quick.valore ?? QUICK_MODELLO_PREDEFINITO,
    esecutori: esecutori.valore,
    squadra: squadra.valore,
    squadraQuota: quota.valore,
    compatta: compatta.valore,
    compattaSoglia: soglia.valore,
    ...(codexModello.valore === undefined ? {} : { codexModello: codexModello.valore }),
    ...(copilotModello.valore === undefined ? {} : { copilotModello: copilotModello.valore }),
  }
  const avvisi = [logs, secondi, modelli, instradamento, codexModello, copilotModello, orchestra, risparmio, ponytail, pluginCodex, pluginQwen, parallelo, sveglia, stallo, attesa, controllo, quick, esecutori, squadra, quota, compatta, soglia].flatMap(c => c.avvisi)

  return { config, avvisi }
}

export function configPredefinita(home: string): ConfigRegia {
  return parseConfig({}, home).config
}
