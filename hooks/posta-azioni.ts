// Posta fra agenti: i tool `posta_invia` e `posta_leggi`, l'invio dal pane,
// lo specchio di SendMessage e il recapito periodico dei messaggi che Codex
// lascia nella casella per i Claude di questa sessione.

import type { EngineInterface } from 'claude-code'

import { leggiHome } from './fonti'
import { messaggioErrore } from './parsers'
import { UTENTE, PRINCIPALE, daConsegnare, risolviIndirizzo, ultimiMessaggi } from './posta'
import type { Messaggio } from './posta'
import { aggiungiMessaggio, consegna, leggiCasella, mittenteDi, rubrica, segnaStato } from './posta-io'

export const DESCRIZIONE_INVIA = [
  'Manda un messaggio nella posta della regia. Indirizzi: "principale" (la sessione che coordina),',
  '"utente" (la persona), il nome o l\'id di un subagente Claude in corso, il nome di un lavoro Codex in corso.',
  'A un Claude arriva subito nella conversazione; un Codex lo legge da se fra un passo e l\'altro. Il mittente sei tu.',
].join(' ')

export const DESCRIZIONE_LEGGI = 'Legge la posta della regia indirizzata a te (la principale o questo subagente): gli ultimi messaggi, i nuovi segnati letti.'

export const SCHEMA_INVIA = {
  type: 'object',
  properties: {
    a: { type: 'string', description: 'Destinatario: principale, utente, nome o id di un subagente, nome di un lavoro Codex.' },
    testo: { type: 'string', description: 'Il messaggio, breve.' },
  },
  required: ['a', 'testo'],
  additionalProperties: false,
} as const

export const SCHEMA_LEGGI = { type: 'object', properties: {}, additionalProperties: false } as const

type Risultato = { result: string } | { deny: string }

/** Invia da `da`: registra in casella e, se il destinatario e un Claude, consegna subito. */
export async function invia($: EngineInterface, da: string, a: string, testo: string, via: string): Promise<Risultato> {
  if (testo.trim() === '') return { deny: 'posta: il testo e vuoto' }
  const sessione = await $.session.id()
  const elenco = await rubrica($, sessione)
  const { destinatario, errore } = risolviIndirizzo(a, elenco.agenti, elenco.codex)
  if (destinatario === undefined) return { deny: `posta: ${errore ?? 'destinatario non valido'}` }
  if (destinatario.tipo === 'principale' && da === PRINCIPALE) return { deny: 'posta: sei gia la principale, non puoi scriverti' }
  const indirizzo = destinatario.tipo === 'subagente' ? destinatario.nome : destinatario.tipo === 'codex' ? destinatario.nome : destinatario.tipo
  const m = await aggiungiMessaggio($, { da, a: indirizzo, testo, sessione, via })
  if (destinatario.tipo === 'codex') {
    return { result: `In casella per il lavoro Codex "${indirizzo}" (id ${m.id}): lo leggera con posta leggi fra un passo e l'altro.` }
  }
  const problema = await consegna($, m, destinatario)
  await segnaStato($, m.id, problema === undefined ? 'consegnato' : 'errore', problema)
  if (problema !== undefined) return { deny: `posta: messaggio registrato (id ${m.id}) ma non consegnato a ${indirizzo}: ${problema}` }

  return { result: `Consegnato a ${indirizzo} (id ${m.id}).` }
}

/** Il tool `posta_invia`: il mittente e il loop che chiama. */
export async function toolInvia($: EngineInterface, e: { agentId?: string; a?: unknown; testo?: unknown }): Promise<Risultato> {
  try {
    if (typeof e.a !== 'string' || typeof e.testo !== 'string') return { deny: 'posta_invia: servono "a" e "testo" come testo' }

    return await invia($, await mittenteDi($, e.agentId), e.a, e.testo, 'posta')
  } catch (errore) {
    return { deny: `posta_invia: ${messaggioErrore(errore)}` }
  }
}

function formatta(m: Messaggio): string {
  const d = new Date(m.ora)
  const ora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  return `[${ora}] ${m.da} → ${m.a} (${m.stato}, id ${m.id}):\n${m.testo}`
}

/** Il tool `posta_leggi`: gli ultimi messaggi per chi chiama; i nuovi diventano letti. */
export async function toolLeggi($: EngineInterface, e: { agentId?: string }): Promise<Risultato> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return { deny: 'posta_leggi: HOME non definita' }
    const sessione = await $.session.id()
    const io = await mittenteDi($, e.agentId)
    const indirizzi = new Set([io, ...(e.agentId === undefined ? [] : [e.agentId])])
    const casella = await leggiCasella($, home)
    const miei = ultimiMessaggi(casella.dati.filter(m => indirizzi.has(m.a)), 10, sessione)
    await Promise.all(miei.filter(m => m.stato !== 'letto').map(m => segnaStato($, m.id, 'letto')))
    if (miei.length === 0) return { result: `Nessun messaggio per ${io}.` }

    return { result: miei.map(formatta).join('\n\n') }
  } catch (errore) {
    return { deny: `posta_leggi: ${messaggioErrore(errore)}` }
  }
}

/** Specchio di SendMessage: registrato in casella come gia consegnato (o fallito). */
export async function specchiaSendMessage(
  $: EngineInterface,
  e: { agentId?: string; to?: unknown; message?: unknown },
  isRiuscito: boolean,
): Promise<void> {
  try {
    if (typeof e.message !== 'string') return
    const da = await mittenteDi($, e.agentId)
    const a = typeof e.to === 'string' ? e.to : JSON.stringify(e.to)
    const sessione = await $.session.id()
    await aggiungiMessaggio($, { da, a, testo: e.message, sessione, via: 'SendMessage', stato: isRiuscito ? 'consegnato' : 'errore' })
  } catch (errore) {
    $.ui.toast(`regia: specchio di SendMessage non riuscito (${messaggioErrore(errore)})`)
  }
}

/** Dal pane: la persona scrive a un agente in corso. */
export async function inviaDaUtente($: EngineInterface, a: string, testo: string): Promise<void> {
  try {
    const esito = await invia($, UTENTE, a, testo, 'pane')
    $.ui.toast('deny' in esito ? esito.deny : `✉ ${esito.result}`, { timeoutMs: 6_000 })
  } catch (errore) {
    $.ui.toast(`regia: posta non inviata (${messaggioErrore(errore)})`)
  }
}

const consegnati = new Set<string>()
let isInRecapito = false
/** Lo stesso guasto si dice una volta sola, non a ogni giro. */
let ultimoGuasto: string | undefined

/**
 * Consegna i messaggi nuovi che toccano a questa sessione (scritti da Codex
 * con `posta invia`): ai Claude in conversazione, alla persona con un avviso.
 * Quelli per un Codex restano in casella. Torna quanti ne ha toccati.
 */
export async function recapita($: EngineInterface): Promise<number> {
  if (isInRecapito) return 0
  isInRecapito = true
  try {
    const home = await leggiHome($)
    if (home === undefined) return 0
    const sessione = await $.session.id()
    const nuovi = daConsegnare((await leggiCasella($, home)).dati, sessione).filter(m => !consegnati.has(m.id))
    if (nuovi.length === 0) return 0
    const elenco = await rubrica($, sessione)
    let toccati = 0
    for (const m of nuovi) {
      const { destinatario, errore } = risolviIndirizzo(m.a, elenco.agenti, elenco.codex)
      if (destinatario?.tipo === 'codex' || elenco.codex.finiti.includes(m.a)) continue
      consegnati.add(m.id)
      toccati += 1
      const problema = destinatario === undefined ? errore : await consegna($, m, destinatario)
      await segnaStato($, m.id, problema === undefined ? 'consegnato' : 'errore', problema)
    }
    ultimoGuasto = undefined

    return toccati
  } catch (errore) {
    const guasto = `regia: recapito della posta non riuscito (${messaggioErrore(errore)})`
    if (guasto !== ultimoGuasto) $.ui.toast(guasto)
    ultimoGuasto = guasto

    return 0
  } finally {
    isInRecapito = false
  }
}
