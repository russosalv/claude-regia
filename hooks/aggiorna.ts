import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface } from 'claude-code'

import type { RegiaSnapshot } from '../types/index'
import { ricordiAggiornati } from './agenti'

import {
  leggiAgenti,
  leggiLog,
  leggiMemoria,
  leggiPidDellaSessione,
  leggiProcessi,
  leggiRegistro,
  leggiSessioneId,
  scriviMemoria,
} from './fonti'
import type { Memoria } from './fonti'
import { leggiMemoriaAgenti } from './memoria-agenti'
import { leggiCasella } from './posta-io'
import { compitiInAttesa } from './sciame-motore'
import type { MemoriaAgenti } from './memoria-agenti'
import {
  SNAPSHOT_VUOTO,
  costruisciSnapshot,
  nomiAggiornati,
  testoStato,
} from './model'
import type { LetturaLog } from './model'
import { messaggioErrore } from './parsers'
import type { ProcessoCodex } from './parsers'
import type { ConfigRegia } from './registro'

// Dichiarato qui (e non importato) perché `claude plugin validate` legge lo
// stato solo dalle `atom` scritte nel file che le usa. Stesso tag in ogni file;
// cambialo quando cambiano i campi dello snapshot.
const snapshot = atom(
  { plugin: 'regia', key: 'snapshot' } as const,
  SNAPSHOT_VUOTO,
  { shape: 'snapshot-4' },
)

export type ContestoLettura = {
  config: ConfigRegia
  /** Cartella home, `undefined` se `HOME` non e definita. */
  home: string | undefined
  /** Avvisi gia noti (config non valida...), ripetuti a ogni lettura. */
  avvisiFissi: readonly string[]
}

const SENZA_HOME = 'HOME non definita: registro e log codex non leggibili'

/** Rilegge tutte le fonti e scrive lo snapshot. Non lancia: gli errori sono avvisi. */
export async function aggiorna(
  $: EngineInterface,
  contesto: ContestoLettura,
): Promise<void> {
  const { home, config } = contesto
  const [oraMs, agenti, processi, registro, log, posta] = await Promise.all([
    $.clock.now(),
    leggiAgenti($),
    leggiProcessi($),
    home === undefined ? undefined : leggiRegistro($, home),
    Promise.all(
      home === undefined ? [] : config.codexLogs.map(p => leggiLog($, p, home)),
    ),
    home === undefined ? undefined : leggiCasella($, home).catch(e => ({ dati: [], avvisi: [`posta: ${messaggioErrore(e)}`] })),
  ])
  const precedente = await read($, snapshot)
  const sessione = await attribuzione($, processi.dati)
  const inAttesa = sessione.sessioneId === undefined ? [] : await compitiInAttesa($, sessione.sessioneId).catch(() => [])
  const lettureLog = log.flatMap(l => (l.dati === undefined ? [] : [l.dati]))
  const avvisi = [
    ...contesto.avvisiFissi,
    ...(home === undefined ? [SENZA_HOME] : []),
    ...agenti.avvisi,
    ...processi.avvisi,
    ...sessione.avvisi,
    ...(registro?.avvisi ?? []),
    ...log.flatMap(l => l.avvisi),
    ...(posta?.avvisi ?? []),
  ]
  const prossimo = costruisciSnapshot({
    oraMs,
    home: home ?? '',
    agenti: agenti.dati,
    processi: processi.dati,
    log: lettureLog as readonly LetturaLog[],
    registro: registro?.dati?.lavori,
    isRegistroPresente: registro?.dati?.isPresente ?? false,
    tempiPrecedenti: precedente.tempiAgenti,
    isPrimaLettura: precedente.aggiornatoMs === 0,
    sessioneId: sessione.sessioneId,
    attesaSciame: inAttesa.map(({ sciame, compito }) => ({ sciame, nome: compito.nome, esecutore: compito.esecutore, isBloccato: compito.stato === 'bloccato' })),
    ricordiAgenti: sessione.memoria?.agenti,
    infoAgenti: sessione.agenti?.agenti,
    lanci: sessione.agenti?.lanci,
    posta: posta?.dati,
    avvisi,
    pidMiei: sessione.pidMiei,
    nomiSessione: new Set(sessione.nomi),
  })
  const avvisiMemoria = await ricorda($, sessione, agenti.dati ?? [], prossimo)
  const finale = avvisiMemoria.length === 0 ? prossimo : { ...prossimo, avvisi: [...prossimo.avvisi, ...avvisiMemoria] }
  await update($, snapshot, () => finale)
  $.ui.status(testoStato(finale))
}

type Attribuzione = {
  sessioneId?: string
  memoria?: Memoria
  /** Modelli e token dei subagenti, lanci di codex_avvia. */
  agenti?: MemoriaAgenti
  pidMiei?: Set<number>
  nomi: string[]
  avvisi: string[]
}

/**
 * Quali processi codex sono di questa sessione e quali nomi di lavoro le
 * appartengono (anche se ormai finiti: la memoria sta in `$.store`).
 */
async function attribuzione(
  $: EngineInterface,
  processi: readonly ProcessoCodex[] | undefined,
): Promise<Attribuzione> {
  const id = await leggiSessioneId($)
  if (id.dati === undefined) return { nomi: [], avvisi: id.avvisi }
  const memoria = await leggiMemoria($, id.dati)
  const agenti = await leggiMemoriaAgenti($, id.dati)
  const pid = await leggiPidDellaSessione($, (processi ?? []).map(p => p.pid), id.dati)
  // I lavori lanciati da codex_avvia sono di questa sessione anche se finiti prima di essere visti.
  const lanciati = Object.keys(agenti.dati.lanci)
  const nomi = nomiAggiornati([...(memoria.dati?.nomi ?? []), ...lanciati], processi, pid.dati)

  return {
    sessioneId: id.dati,
    memoria: memoria.dati,
    agenti: agenti.dati,
    pidMiei: pid.dati,
    nomi,
    avvisi: [...memoria.avvisi, ...agenti.avvisi, ...pid.avvisi],
  }
}

/** Riscrive la memoria della sessione solo se e cambiata. */
async function ricorda(
  $: EngineInterface,
  sessione: Attribuzione,
  agenti: readonly AgentInfo[],
  prossimo: RegiaSnapshot,
): Promise<string[]> {
  if (sessione.sessioneId === undefined || sessione.memoria === undefined) return []
  const nuova: Memoria = {
    nomi: sessione.nomi,
    agenti: ricordiAggiornati(sessione.memoria.agenti, agenti, prossimo.tempiAgenti, prossimo.aggiornatoMs),
  }
  if (JSON.stringify(nuova) === JSON.stringify(sessione.memoria)) return []

  return scriviMemoria($, sessione.sessioneId, nuova, prossimo.aggiornatoMs)
}

/** Come `aggiorna`, ma anche un guasto imprevisto resta visibile nel pane. */
export async function aggiornaSicuro(
  $: EngineInterface,
  contesto: ContestoLettura,
): Promise<void> {
  try {
    await aggiorna($, contesto)
  } catch (errore) {
    const avviso = `aggiornamento fallito: ${messaggioErrore(errore)}`
    try {
      await update($, snapshot, s => ({ ...s, avvisi: [avviso] }))
    } catch {
      $.ui.toast(`regia: ${avviso}`)
    }
  }
}
