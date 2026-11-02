// Registro della scaletta e config opzionale: validazione pura.

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
  aggiornato?: string
  /** La sessione che l'ha scritta con `scaletta_scrivi`; senza, vale per tutte. */
  sessione?: string
}

export type ConfigRegia = {
  codexLogs: string[]
  aggiornamentoSecondi: number
  /** Modello e sforzo decisi compito per compito (`/regia modelli on|off`). */
  instradamento: boolean
  /** Tipo di agente → modello fisso; senza voce decide il compito. */
  modelli: Readonly<Record<string, string>>
  /** Modello di `codex_avvia` quando la chiamata non lo dice; senza, decide Codex. */
  codexModello?: string
  /** Quanto la conversazione principale e tenuta a delegare (`/regia orchestra`). */
  orchestra: ModoOrchestra
  /** Regole di sobrieta nei prompt dei delegati (`/regia risparmio on|off`). */
  risparmio: boolean
  /** La mod installa Ponytail quando e nuova o aggiornata (`/regia ponytail on|off`). */
  ponytail: boolean
  /** Compiti di uno sciame che girano insieme, se la chiamata non lo dice. */
  sciameParallelo: number
}

export const AGGIORNAMENTO_PREDEFINITO_SEC = 15
export const AGGIORNAMENTO_MINIMO_SEC = 2
export const AGGIORNAMENTO_MASSIMO_SEC = 3600
/** Il log dei lavori lanciati da `codex_avvia`, sempre tra le fonti. */
export const LOG_CODEX_REGIA = '.claude/regia/codex/esegui.log'
export const SCIAME_PARALLELO_PREDEFINITO = 4
export const MODI_ORCHESTRA = ['stretta', 'guida', 'off'] as const
export type ModoOrchestra = (typeof MODI_ORCHESTRA)[number]

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

function campoOrchestra(grezzo: unknown): Campo<ModoOrchestra> {
  const modo = MODI_ORCHESTRA.find(m => m === grezzo)
  if (modo !== undefined) return { valore: modo, avvisi: [] }

  return { valore: 'stretta', avvisi: grezzo === undefined ? [] : [`config.json: "orchestra" deve essere ${MODI_ORCHESTRA.join(', ')}`] }
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

/** Il log di `codex_avvia` in coda ai log scelti, una volta sola. */
function conLogRegia(logs: readonly string[], home: string): string[] {
  const regia = `${home}/${LOG_CODEX_REGIA}`

  return logs.includes(regia) ? [...logs] : [...logs, regia]
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
    orchestra: 'stretta',
    risparmio: true,
    ponytail: true,
    sciameParallelo: SCIAME_PARALLELO_PREDEFINITO,
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
  const orchestra = campoOrchestra(o.orchestra)
  const risparmio = campoBooleano(o.risparmio, 'risparmio', true)
  const ponytail = campoBooleano(o.ponytail, 'ponytail', true)
  const parallelo = campoParallelo(o.sciameParallelo)
  const config: ConfigRegia = {
    codexLogs: logs.valore === undefined ? predefinita.codexLogs : conLogRegia(logs.valore, home),
    aggiornamentoSecondi: secondi.valore ?? predefinita.aggiornamentoSecondi,
    instradamento: instradamento.valore,
    modelli: modelli.valore,
    orchestra: orchestra.valore,
    risparmio: risparmio.valore,
    ponytail: ponytail.valore,
    sciameParallelo: parallelo.valore,
    ...(codexModello.valore === undefined ? {} : { codexModello: codexModello.valore }),
  }
  const avvisi = [logs, secondi, modelli, instradamento, codexModello, orchestra, risparmio, ponytail, parallelo].flatMap(c => c.avvisi)

  return { config, avvisi }
}

export function configPredefinita(home: string): ConfigRegia {
  return parseConfig({}, home).config
}
