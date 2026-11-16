// La compattazione, la parte che parla col motore. Tre cose:
// - ogni compattazione della conversazione principale (`/compact`, quella automatica del motore,
//   una mod) riceve le istruzioni della regia, con i fatti letti in quel momento dai suoi archivi;
// - a fine turno, col contesto alla soglia o oltre, la mod compatta lei. Il motore compatta solo
//   fra un turno e l'altro e non dentro un hook: la chiamata parte da un timer, dopo l'hook;
// - dopo una compattazione fatta dalla mod, in long col piano aperto, la principale riprende da sola.
// La chiamata della mod non passa dal suo stesso hook (provato sul motore 2.1.325): le istruzioni
// le porta gia con se, e l'hook che le trovasse non le aggiunge due volte.

import type { EngineInterface } from 'claude-code'

import type { RegiaSnapshot } from '../types/index'
import { scriviChiave } from './comando-opzioni'
import { USO_COMPATTA, avvisoCompattato, conCompattazione, decidiCompatta, decidiRipresa, haIstruzioniRegia, statoCompattaDaStore, testoCompatta, testoIstruzioni, testoRipresa, unisciIstruzioni } from './compatta'
import type { ArgomentiCompatta, FattiRegia, StatoCompatta, UltimaCompatta } from './compatta'
import { domandeAperte, leggiDomande } from './domande'
import { esecutoriUsabili } from './esecutori'
import { CHIAVE_COMPATTA, leggiConfig, leggiHome, leggiRegistro } from './fonti'
import { messaggioErrore } from './parsers'
import { leggiProfilo } from './profilo'
import { sciamiAttivi } from './sciame-motore'
import { isAgente, isPrincipaleOccupata, notaCompattazione, sveglia } from './sorveglianza'

/** I fatti della regia letti adesso. Ogni fonte e isolata: quella che fallisce manca, le altre restano. */
export async function leggiFatti($: EngineInterface, home: string): Promise<FattiRegia> {
  const sessione = await $.session.id().catch(() => undefined)
  const [profilo, registro, domande, sciami, esecutori] = await Promise.all([
    leggiProfilo($),
    leggiRegistro($, home),
    leggiDomande($, home),
    sciamiAttivi($).catch(() => undefined),
    esecutoriUsabili($, home).catch(() => undefined),
  ])

  return {
    profilo: profilo.profilo,
    isVia: profilo.isVia,
    // Come nel pane: le voci di questa sessione e quelle senza sessione, scritte a mano.
    ...(registro.dati === undefined ? {} : { piano: registro.dati.lavori.filter(v => v.sessione === undefined || v.sessione === sessione) }),
    ...(domande.avvisi.length > 0 ? {} : { domande: domandeAperte(domande.dati, sessione) }),
    ...(sciami === undefined ? {} : { sciami }),
    ...(esecutori === undefined ? {} : { esecutori }),
  }
}

/**
 * Hook di `session.compact`: le istruzioni della persona, poi quelle della regia. Vale per ogni
 * innesco (`manual`, `auto`, `plugin` e anche `precompute`, il cui riassunto il motore riusa per
 * la compattazione che segue). La compattazione di un subagente non si tocca. Non lancia.
 */
export async function conIstruzioni<E extends { agentId?: string; instructions?: string }>($: EngineInterface, e: E): Promise<E> {
  try {
    if (e.agentId !== undefined || haIstruzioniRegia(e.instructions)) return e
    const home = await leggiHome($)
    if (home === undefined || !(await leggiConfig($, home)).dati.compatta) return e

    return { ...e, instructions: unisciIstruzioni(e.instructions, testoIstruzioni(await leggiFatti($, home))) }
  } catch (errore) {
    $.ui.toast(`regia: istruzioni di compattazione non aggiunte (${messaggioErrore(errore)})`)

    return e
  }
}

async function leggiStato($: EngineInterface): Promise<StatoCompatta> {
  return statoCompattaDaStore(await $.store.get(`${CHIAVE_COMPATTA}${await $.session.id()}`))
}

async function scriviStato($: EngineInterface, stato: StatoCompatta): Promise<void> {
  await $.store.set(`${CHIAVE_COMPATTA}${await $.session.id()}`, { ...stato, aggiornatoMs: await $.clock.now() })
}

async function ricorda($: EngineInterface, dati: Omit<UltimaCompatta, 'oraMs'>): Promise<void> {
  await scriviStato($, conCompattazione(await leggiStato($), { ...dati, oraMs: await $.clock.now() }))
}

// Vive col modulo: una compattazione alla volta, fra quella della soglia e `/regia compact now`.
let isInCorso = false
/** Un prompt e arrivato mentre si compattava: la conversazione va avanti con quello. */
let isPromptArrivato = false
/** L'ultimo guasto detto, per non ripeterlo a ogni fine di turno. */
let guastoDetto = ''

/** Hook di `prompt.submit`. */
export function notaPrompt(): void {
  if (isInCorso) isPromptArrivato = true
}

type Esito =
  | { tipo: 'fatta'; tokensDopo?: number }
  | { tipo: 'saltata' | 'rifiutata'; motivo: string }
  | { tipo: 'occupata' }

/**
 * Vero se il motore ha rifiutato perche un turno e in corso: lo dice lui (2.1.325:
 * `$.session.compact: a turn is running (...)`) o la mod ne ha sentito l'inizio.
 */
const isRifiutoPerTurno = (motivo: string): boolean => /turn is running/i.test(motivo) || isPrincipaleOccupata()

/** Compatta con le istruzioni date e ricorda l'esito. Non lancia: il rifiuto del motore e un esito. */
async function compatta($: EngineInterface, o: { istruzioni: string; origine: 'soglia' | 'comando'; primaPct?: number }): Promise<Esito> {
  if (isInCorso) return { tipo: 'occupata' }
  isInCorso = true
  isPromptArrivato = false
  notaCompattazione(true)
  try {
    const esito = await $.session.compact({ instructions: o.istruzioni })
    if (esito.skip !== undefined) return { tipo: 'saltata', motivo: esito.skip }
    const { tokensBefore, tokensAfter } = esito
    // La compattazione e fatta anche se poi non si riesce a ricordarla.
    await ricorda($, {
      origine: o.origine,
      ...(o.primaPct === undefined ? {} : { primaPct: o.primaPct }),
      ...(tokensBefore === undefined ? {} : { tokensPrima: tokensBefore }),
      ...(tokensAfter === undefined ? {} : { tokensDopo: tokensAfter }),
    }).catch(errore => $.ui.toast(`regia: compattazione non ricordata (${messaggioErrore(errore)})`))

    return { tipo: 'fatta', ...(tokensAfter === undefined ? {} : { tokensDopo: tokensAfter }) }
  } catch (errore) {
    return { tipo: 'rifiutata', motivo: messaggioErrore(errore) }
  } finally {
    isInCorso = false
    notaCompattazione(false)
  }
}

function diGuasto($: EngineInterface, testo: string): void {
  if (testo === guastoDetto) return
  guastoDetto = testo
  $.ui.toast(testo, { timeoutMs: 15_000 })
}

/**
 * Dopo un turno della principale: se il contesto e alla soglia o oltre compatta, poi in long col
 * piano aperto la fa riprendere. Solo con una superficie, come la regola e la sveglia. Non lancia.
 */
export async function controllaSoglia($: EngineInterface, turno: string, leggiSnapshot: () => Promise<RegiaSnapshot>): Promise<void> {
  try {
    const home = await leggiHome($)
    if (home === undefined || isInCorso) return
    const config = (await leggiConfig($, home)).dati
    if (!config.compatta || (await $.session.surfaces()).length === 0) return
    // La chiamata semplice non costa nulla; un motore che non la conosce non ha nulla da misurare.
    const uso = await $.session.usage().catch(() => undefined)
    const pieno = uso?.context.percent
    const prima = await leggiStato($)
    const decisa = decidiCompatta({ isAccesa: true, soglia: config.compattaSoglia, pieno, turno, stato: prima })
    if (JSON.stringify({ ...decisa.stato, aggiornatoMs: 0 }) !== JSON.stringify({ ...prima, aggiornatoMs: 0 })) await scriviStato($, decisa.stato)
    if (decisa.azione === 'irraggiungibile' && !prima.isAvvisato) {
      $.ui.toast(`regia: il contesto resta al ${pieno}% anche dopo la compattazione, la soglia del ${config.compattaSoglia}% non si raggiunge: alzala con /regia compact <numero>`, { timeoutMs: 30_000 })
    }
    if (decisa.azione !== 'compatta') return
    // Cio che decide la ripresa si legge prima: uno sciame che finisce mentre si compatta scrive lui alla principale.
    const [fatti, snapshot] = await Promise.all([leggiFatti($, home), leggiSnapshot()])
    const esito = await compatta($, { istruzioni: testoIstruzioni(fatti), origine: 'soglia', primaPct: pieno })
    if (esito.tipo === 'occupata') return
    if (esito.tipo !== 'fatta') {
      // Un turno partito nel frattempo: si riprova alla sua fine, senza dirlo.
      if (esito.tipo === 'rifiutata' && isRifiutoPerTurno(esito.motivo)) return
      diGuasto($, `regia: compattazione ${esito.tipo === 'saltata' ? 'saltata' : 'non riuscita'} (${esito.motivo})`)

      return
    }
    guastoDetto = ''
    $.ui.toast(avvisoCompattato(pieno, esito.tokensDopo), { timeoutMs: 10_000 })
    const isDaRiprendere = decidiRipresa({
      profilo: fatti.profilo,
      piano: fatti.piano ?? [],
      sciamiAttivi: fatti.sciami?.length ?? 0,
      agentiInCorso: snapshot.viste.sessione.inCorso.filter(isAgente).length,
    })
    // Un prompt arrivato nel frattempo porta avanti lui la conversazione; e alla persona che scrive non si passa davanti.
    if (!isDaRiprendere || isPromptArrivato || isPrincipaleOccupata()) return
    if ((await $.prompt.read().catch(() => ({ text: '' }))).text.trim() !== '') return
    await sveglia($, testoRipresa({ piano: fatti.piano ?? [], domande: fatti.domande ?? [] }), 'ripresa dopo la compattazione')
  } catch (errore) {
    diGuasto($, `regia: compattazione: ${messaggioErrore(errore)}`)
  }
}

/** Hook di `turn.complete` della principale: il controllo parte dopo l'hook, dove il motore accetta di compattare. */
export function dopoTurno($: EngineInterface, e: { turnId: string; reason: string }, leggiSnapshot: () => Promise<RegiaSnapshot>): void {
  // Esc della persona: sta per scrivere lei, e una compattazione la farebbe aspettare. Si riprova al turno dopo.
  if (e.reason === 'aborted') return
  $.clock.after(0, () => controllaSoglia($, e.turnId, leggiSnapshot))
}

/** `/regia compact now`: chiesta dalla persona, quindi senza ripresa. L'esito e un avviso. Non lancia. */
async function compattaOra($: EngineInterface, home: string): Promise<void> {
  try {
    const uso = await $.session.usage().catch(() => undefined)
    const fatti = await leggiFatti($, home)
    const esito = await compatta($, { istruzioni: testoIstruzioni(fatti), origine: 'comando', primaPct: uso?.context.percent })
    const testo = esito.tipo === 'fatta' ? avvisoCompattato(uso?.context.percent, esito.tokensDopo)
      : esito.tipo === 'occupata' ? 'regia: una compattazione e gia in corso'
        : esito.tipo === 'saltata' ? `regia: compattazione saltata (${esito.motivo})`
          : isRifiutoPerTurno(esito.motivo) ? 'regia: il motore non compatta adesso, un turno e in corso: riprova a turno finito'
            : `regia: compattazione non riuscita (${esito.motivo})`
    $.ui.toast(testo, { timeoutMs: 15_000 })
  } catch (errore) {
    $.ui.toast(`regia: compattazione: ${messaggioErrore(errore)}`)
  }
}

/** Il testo di risposta di `/regia compact`. Non lancia: un errore diventa il testo. */
export async function comandoCompatta($: EngineInterface, a: ArgomentiCompatta): Promise<string> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia: HOME non definita, non trovo la config.'
    if (a.azione === 'sbagliato') return USO_COMPATTA
    if (a.azione === 'ora') {
      // Dentro l'hook di un comando il motore rifiuta di compattare: parte subito dopo.
      $.clock.after(0, () => compattaOra($, home))

      return 'Compatto adesso con le istruzioni della regia. Il motore compatta solo fra un turno e l\'altro e non dentro un comando: parte appena questo e finito, e l\'esito (o il rifiuto, se un turno e in corso) arriva come avviso.'
    }
    if (a.azione === 'accendi') await scriviChiave($, home, 'compatta', a.valore)
    if (a.azione === 'soglia') await scriviChiave($, home, 'compattaSoglia', a.valore)
    const [{ dati, avvisi }, uso, stato] = await Promise.all([
      leggiConfig($, home),
      $.session.usage().catch(() => undefined),
      leggiStato($).catch(() => statoCompattaDaStore(undefined)),
    ])

    return [testoCompatta({ config: dati, contesto: uso?.context ?? {}, stato }), ...avvisi.map(x => `Attenzione: ${x}`)].join('\n')
  } catch (errore) {
    return `regia: non riesco a cambiare la compattazione (${messaggioErrore(errore)}).`
  }
}
