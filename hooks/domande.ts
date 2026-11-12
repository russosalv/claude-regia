// Le domande della principale alla persona (`domanda_scrivi`): ognuna con il
// suo contesto, cosi la persona decide dal pane (o dal telefono) senza
// rileggere la conversazione. Vivono in `~/.claude/regia/domande.json`.

import type { EngineInterface } from 'claude-code'

import type { RegiaDomanda } from '../types/index'
import { leggiHome } from './fonti'
import { notifica } from './profilo'
import { messaggioErrore } from './parsers'

export type VoceDomanda = {
  id: string
  titolo: string
  contesto: string
  opzioni: string[]
  raccomandazione?: string
  stato: 'aperta' | 'risolta'
  risposta?: string
  sessione: string
  creataMs: number
  aggiornataMs: number
}

/** Le risolte che si tengono nel file, le piu recenti. */
const MASSIMO_RISOLTE = 50

export const DESCRIZIONE_DOMANDA = 'Registra una domanda per la persona (o la chiude). La persona la vede nel pane con il contesto, risponde da li o in chat, e se non e al PC le arriva una notifica. Usala per ogni decisione che spetta a lei. stato: aperta per farla, risolta quando ha risposto in chat (con la risposta).'

export const SCHEMA_DOMANDA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Nome breve e stabile della domanda.' },
    titolo: { type: 'string', description: 'La domanda in una riga, comprensibile da sola.' },
    contesto: { type: 'string', description: 'Tutto cio che serve per decidere senza rileggere la conversazione: a che punto sei, che cosa si decide e perche, le conseguenze di ogni opzione.' },
    opzioni: { type: 'array', items: { type: 'string' }, description: 'Le risposte possibili, al massimo 4.' },
    raccomandazione: { type: 'string', description: 'Che cosa faresti tu, e perche.' },
    stato: { type: 'string', enum: ['aperta', 'risolta'] },
    risposta: { type: 'string', description: 'Con stato risolta: che cosa ha deciso la persona.' },
  },
  required: ['id', 'stato'],
  additionalProperties: false,
} as const

type Argomenti = { id: string; titolo?: string; contesto?: string; opzioni?: string[]; raccomandazione?: string; stato: 'aperta' | 'risolta'; risposta?: string }

const isTesto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function leggiVoce(grezza: unknown): VoceDomanda | undefined {
  if (typeof grezza !== 'object' || grezza === null) return undefined
  const o = grezza as Record<string, unknown>
  const isValida = isTesto(o.id) && isTesto(o.titolo) && typeof o.contesto === 'string' &&
    (o.stato === 'aperta' || o.stato === 'risolta') && isTesto(o.sessione) &&
    typeof o.creataMs === 'number' && Array.isArray(o.opzioni)

  return isValida ? { ...(o as VoceDomanda), opzioni: (o.opzioni as unknown[]).filter(isTesto) } : undefined
}

export function validaDomande(radice: unknown): VoceDomanda[] {
  const lista = (radice as { domande?: unknown } | null)?.domande

  return Array.isArray(lista) ? lista.map(leggiVoce).filter((v): v is VoceDomanda => v !== undefined) : []
}

/** Le domande dopo una scrittura del tool, o il motivo per cui non si puo. Pura. */
export function conDomanda(lista: readonly VoceDomanda[], a: Argomenti, sessione: string, oraMs: number): VoceDomanda[] | string {
  if (!isTesto(a.id)) return 'manca l\'id'
  const prima = lista.find(d => d.id === a.id && d.sessione === sessione)
  const titolo = a.titolo?.trim() || prima?.titolo
  const contesto = a.contesto?.trim() || prima?.contesto
  if (titolo === undefined || contesto === undefined) return `la domanda "${a.id}" e nuova: servono titolo e contesto`
  const voce: VoceDomanda = {
    id: a.id,
    titolo,
    contesto,
    opzioni: (a.opzioni ?? prima?.opzioni ?? []).filter(isTesto).slice(0, 4),
    ...(a.raccomandazione ?? prima?.raccomandazione ? { raccomandazione: a.raccomandazione ?? prima?.raccomandazione } : {}),
    stato: a.stato,
    ...(a.risposta === undefined ? {} : { risposta: a.risposta }),
    sessione,
    creataMs: prima?.creataMs ?? oraMs,
    aggiornataMs: oraMs,
  }
  const altre = lista.filter(d => d !== prima)
  const risolte = [...altre, voce].filter(d => d.stato === 'risolta').sort((x, y) => y.aggiornataMs - x.aggiornataMs)
  const tenute = new Set(risolte.slice(0, MASSIMO_RISOLTE))

  return [...altre, voce].filter(d => d.stato === 'aperta' || tenute.has(d))
}

/** Le aperte di una sessione, come le mostra il pane. */
export function domandeAperte(lista: readonly VoceDomanda[], sessione: string | undefined): RegiaDomanda[] {
  return lista
    .filter(d => d.stato === 'aperta' && d.sessione === sessione)
    .sort((x, y) => x.creataMs - y.creataMs)
    .map(d => ({ id: d.id, titolo: d.titolo, contesto: d.contesto, opzioni: d.opzioni, creataMs: d.creataMs, ...(d.raccomandazione === undefined ? {} : { raccomandazione: d.raccomandazione }) }))
}

const percorso = (home: string) => `${home}/.claude/regia/domande.json`

export async function leggiDomande($: EngineInterface, home: string): Promise<{ dati: VoceDomanda[]; avvisi: string[] }> {
  try {
    const file = percorso(home)
    if (!(await $.fs.exists(file))) return { dati: [], avvisi: [] }

    return { dati: validaDomande(JSON.parse(await $.fs.read(file))), avvisi: [] }
  } catch (errore) {
    return { dati: [], avvisi: [`domande.json: ${messaggioErrore(errore)}`] }
  }
}

let coda: Promise<unknown> = Promise.resolve()

/** Una scrittura alla volta: il tool e il pane possono scrivere insieme. */
function scrivi($: EngineInterface, a: Argomenti): Promise<VoceDomanda | string> {
  const lavoro = coda.then(async () => {
    const home = await leggiHome($)
    if (home === undefined) return 'HOME non definita'
    const letta = await leggiDomande($, home)
    if (letta.avvisi.length > 0) return letta.avvisi[0] ?? 'domande.json illeggibile'
    const sessione = await $.session.id()
    const nuove = conDomanda(letta.dati, a, sessione, await $.clock.now())
    if (typeof nuove === 'string') return nuove
    await $.fs.write(percorso(home), `${JSON.stringify({ domande: nuove }, null, 2)}\n`)

    return nuove.find(d => d.id === a.id && d.sessione === sessione) ?? 'scrittura persa'
  })
  coda = lavoro.catch(() => undefined)

  return lavoro
}

/** Il corpo del tool `domanda_scrivi`. */
export async function domandaScrivi($: EngineInterface, grezzi: unknown): Promise<{ result: string } | { deny: string }> {
  try {
    const a = grezzi as Argomenti
    const esito = await scrivi($, a)
    if (typeof esito === 'string') return { deny: `domanda_scrivi: ${esito}` }
    if (esito.stato === 'risolta') return { result: `Domanda "${a.id}" chiusa.` }
    await notifica($, `Domanda per te: ${esito.titolo}`, `domanda-${esito.id}`)

    return { result: `Domanda "${a.id}" registrata: la persona la vede nel pane. Fagliela anche in chat, con il contesto in breve; quando risponde in chat chiudila con stato risolta. Intanto porta avanti cio che non dipende da essa.` }
  } catch (errore) {
    return { deny: `domanda_scrivi: ${messaggioErrore(errore)}` }
  }
}

/** La risposta della persona dal pane: chiude la domanda e la porta alla principale. */
export async function rispondiDomanda($: EngineInterface, d: RegiaDomanda, testo: string): Promise<void> {
  const risposta = testo.trim()
  if (risposta === '') return
  const esito = await scrivi($, { id: d.id, stato: 'risolta', risposta })
  if (typeof esito === 'string') throw new Error(esito)
  await $.prompt.submit({ text: `[regia · risposta della persona alla domanda "${d.titolo}" (${d.id})]\n${risposta}\nLa domanda e gia chiusa nel pane: prosegui.` })
}

/** Il compito dell'agente che aiuta la persona a capire una domanda. */
export function promptApprofondisci(d: RegiaDomanda): string {
  return [
    'La persona deve rispondere a una domanda della sessione principale e vuole capirla meglio prima di decidere.',
    `Domanda: ${d.titolo}`,
    `Contesto: ${d.contesto}`,
    ...(d.opzioni.length > 0 ? [`Opzioni: ${d.opzioni.map((o, i) => `${i + 1}) ${o}`).join('; ')}`] : []),
    ...(d.raccomandazione === undefined ? [] : [`Raccomandazione della principale: ${d.raccomandazione}`]),
    '',
    'Spiegale in modo semplice che cosa si sta decidendo e che cosa comporta ogni opzione. Se serve guarda il codice o la documentazione, in sola lettura: non modificare nulla. Non decidere tu e non scrivere alla principale. Poi resta a disposizione: la persona ti scrivera qui per approfondire.',
  ].join('\n')
}

/** Lancia l'agente che approfondisce una domanda e ne da l'id, per aprirne la conversazione. */
export async function approfondisci($: EngineInterface, d: RegiaDomanda): Promise<string> {
  const esito = await $.agent.spawn({
    prompt: promptApprofondisci(d),
    description: `approfondisci: ${d.titolo}`.slice(0, 60),
    subagentType: 'general-purpose',
    name: `domanda-${d.id}`,
  })
  if (esito.deny !== undefined) throw new Error(esito.deny)
  const id = esito.agentId ?? (await $.agent.list()).filter(a => a.name === `domanda-${d.id}`).at(-1)?.id
  if (id === undefined) throw new Error('il motore non ha dato un agente')

  return id
}
