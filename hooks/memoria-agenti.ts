// Cio che la mod ricorda dei suoi lanci, per sessione, in `$.store` sotto
// `regia.agenti.<id>`: per ogni subagente Claude il modello, il motivo e chi
// l'ha deciso, e i token dei suoi turni; per ogni lavoro Codex lanciato da
// `codex_avvia` pid, sforzo e motivo. Le scritture passano da una coda,
// cosi lo spawn e la fine di un turno non si pestano i piedi.

import type { EngineInterface, ModelUsage } from 'claude-code'

import type { Provenienza } from './instradamento'
import { messaggioErrore } from './parsers'

export const CHIAVE_AGENTI = 'regia.agenti.'
const MASSIMO_VOCI = 200

export type Token = { input: number; output: number; cacheLettura: number; cacheScrittura: number }

export type InfoAgente = {
  tipo?: string
  modello?: string
  sforzo?: string
  motivo?: string
  provenienza?: Provenienza
  token?: Token
}

export type LancioCodex = {
  pid?: number
  modello?: string
  sforzo: string
  motivo: string
  cartella: string
  inizioMs: number
}

export type MemoriaAgenti = {
  agenti: Readonly<Record<string, InfoAgente>>
  lanci: Readonly<Record<string, LancioCodex>>
}

export const MEMORIA_AGENTI_VUOTA: MemoriaAgenti = { agenti: {}, lanci: {} }

function isOggetto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Legge lo store senza fidarsi: voci malformate scartate. */
export function memoriaDaStore(grezzo: unknown): MemoriaAgenti {
  if (!isOggetto(grezzo)) return MEMORIA_AGENTI_VUOTA
  const agenti = isOggetto(grezzo.agenti) ? grezzo.agenti : {}
  const lanci = isOggetto(grezzo.lanci) ? grezzo.lanci : {}

  return {
    agenti: Object.fromEntries(Object.entries(agenti).filter(([, v]) => isOggetto(v))) as Record<string, InfoAgente>,
    lanci: Object.fromEntries(
      Object.entries(lanci).filter(([, v]) => isOggetto(v) && typeof v.sforzo === 'string'),
    ) as Record<string, LancioCodex>,
  }
}

/** Tiene le ultime `MASSIMO_VOCI` voci (l'ordine d'inserimento e quello di arrivo). */
function ultime<T>(voci: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(voci).slice(-MASSIMO_VOCI))
}

export function conInfo(m: MemoriaAgenti, id: string, info: InfoAgente): MemoriaAgenti {
  return { ...m, agenti: ultime({ ...m.agenti, [id]: { ...m.agenti[id], ...info } }) }
}

export function sommaToken(prima: Token | undefined, usage: ModelUsage): Token {
  return {
    input: (prima?.input ?? 0) + usage.input_tokens,
    output: (prima?.output ?? 0) + usage.output_tokens,
    cacheLettura: (prima?.cacheLettura ?? 0) + usage.cache_read_input_tokens,
    cacheScrittura: (prima?.cacheScrittura ?? 0) + usage.cache_creation_input_tokens,
  }
}

export function conToken(m: MemoriaAgenti, id: string, usage: ModelUsage): MemoriaAgenti {
  const prima = m.agenti[id]

  return conInfo(m, id, { token: sommaToken(prima?.token, usage) })
}

export function conLancio(m: MemoriaAgenti, nome: string, lancio: LancioCodex): MemoriaAgenti {
  return { ...m, lanci: ultime({ ...m.lanci, [nome]: lancio }) }
}

/** Token che contano per la colonna del pane: tutti, cache comprese. */
export function tokenTotali(t: Token | undefined): number | undefined {
  return t === undefined ? undefined : t.input + t.output + t.cacheLettura + t.cacheScrittura
}

let coda: Promise<unknown> = Promise.resolve()

/** Una modifica alla volta: legge, applica, riscrive. Non lancia: torna un avviso. */
export function modificaMemoria(
  $: EngineInterface,
  sessioneId: string,
  cambia: (m: MemoriaAgenti) => MemoriaAgenti,
): Promise<string | undefined> {
  const lavoro = coda.then(async () => {
    try {
      const chiave = `${CHIAVE_AGENTI}${sessioneId}`
      const nuova = cambia(memoriaDaStore(await $.store.get(chiave)))
      await $.store.set(chiave, { ...nuova, aggiornatoMs: await $.clock.now() })

      return undefined
    } catch (errore) {
      return `memoria degli agenti: ${messaggioErrore(errore)}`
    }
  })
  coda = lavoro

  return lavoro
}

export async function leggiMemoriaAgenti($: EngineInterface, sessioneId: string): Promise<{ dati: MemoriaAgenti; avvisi: string[] }> {
  try {
    return { dati: memoriaDaStore(await $.store.get(`${CHIAVE_AGENTI}${sessioneId}`)), avvisi: [] }
  } catch (errore) {
    return { dati: MEMORIA_AGENTI_VUOTA, avvisi: [`memoria degli agenti: ${messaggioErrore(errore)}`] }
  }
}
