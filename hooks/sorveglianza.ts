// La sorveglianza: tiene in moto il piano quando nessuno guarda (la sveglia
// solo in modalita long, gli stalli anche in medio, nulla in quick). Due cose:
// - un agente che non da segni di vita da `stalloMinuti` e fermo: un Codex si
//   uccide (lo sciame lo rilancia un gradino sopra), un subagente Claude, che una
//   mod non puo fermare, si segnala alla principale perche usi TaskStop;
// - la principale ferma con voci del piano ancora aperte e nessun agente che
//   lavora viene svegliata con un turno che le dice di andare avanti (senza
//   progressi le sveglie si diradano e poi smettono). Se gli agenti lavorano
//   la regia tace, a meno di novita per la principale (un compito finito o
//   fallito, posta non letta: una sola sveglia per tutte) e di un controllo
//   di paracadute ad attesa crescente, che riparte da capo quando lei fa un
//   turno per altri motivi.

import type { EngineInterface, Timer } from 'claude-code'

import type { RegiaRiga, RegiaSnapshot } from '../types/index'
import { ESECUTORI_CLI, NOME_CLI, intestazioneLog } from './codex'
import type { EsecutoreCli } from './codex'
import { leggiConfig, leggiHome, leggiProcessi } from './fonti'
import { CONTROLLO_PREDEFINITO_MIN } from './registro'
import { cartellaDi, messaggioErrore } from './parsers'
import { PRINCIPALE } from './posta'
import { leggiProfilo, notifica } from './profilo'

const GIRO_MS = 60_000
export const ATTESA_MS = 3 * 60_000
const ATTESA_MASSIMA_MS = 60 * 60_000
export const MASSIMO_SVEGLIE = 5
const MASSIMO_FINITI_NEL_TESTO = 8

/** La principale: se ha un turno in corso e quando ha finito l'ultimo. */
export type StatoPrincipale = { isOccupata: boolean; fineMs: number; motivo?: string; /** Il turno e quello che ha chiesto la regia. */ isDaSveglia?: boolean }

/**
 * Memoria delle sveglie: l'impronta del piano all'ultima, quante senza progressi
 * (nessuno al lavoro) e quanti controlli di paracadute di fila (agenti al lavoro).
 */
export type Sveglie = { impronta: string; tentativi: number; ultimaMs: number; isEsaurita: boolean; controlli: number }


/** Una riga del pane che e un agente al lavoro (Claude, Codex, Qwen, Copilot, Qoder) e non una voce del piano. */
export const isAgente = (r: RegiaRiga): boolean => r.fonte === 'claude' || r.fonte === 'codex'

/** Le voci del piano ancora da chiudere: scaletta e in corso del registro. */
export function vociAperte(s: RegiaSnapshot): RegiaRiga[] {
  const v = s.viste.sessione

  return [...v.inCorso, ...v.scaletta].filter(r => r.fonte === 'registro' && (r.stato === 'scaletta' || r.stato === 'in_corso'))
}

/** Cambia quando una voce del piano cambia stato o un lavoro finisce: e il progresso. */
export function impronta(s: RegiaSnapshot): string {
  const v = s.viste.sessione

  return JSON.stringify([
    [...v.inCorso, ...v.scaletta].filter(r => r.fonte === 'registro').map(r => `${r.chiave}:${r.stato}`).sort(),
    v.scalettaExtra,
    v.fatti.map(r => r.chiave),
    v.fattiExtra,
  ])
}

/**
 * Se svegliare la principale ora, e la memoria aggiornata. Puro.
 * Nessuno al lavoro: l'attesa raddoppia a ogni sveglia senza progressi (3, 6, 12... fino a 60 min).
 * Agenti al lavoro: si sveglia solo per le novita (dopo l'attesa breve, cosi si raggruppano) o,
 * senza novita, per un controllo a distanza crescente (`controlloMinuti`).
 */
export function decidiSveglia(o: {
  oraMs: number
  principale: StatoPrincipale
  aperte: number
  agentiInCorso: number
  impronta: string
  sveglie: Sveglie
  /** Compiti finiti o falliti e posta non letta, che la principale non ha ancora visto. */
  novita?: number
  /** La principale ha chiuso un turno dal giro prima: cio che e cambiato l'ha gia visto. */
  isTurnoNuovo?: boolean
  controlloMinuti?: readonly number[]
}): { isDovuta: boolean; sveglie: Sveglie } {
  const isProgresso = o.impronta !== o.sveglie.impronta
  // Un turno chiesto dalla regia non azzera il paracadute: altrimenti non crescerebbe mai.
  const isAltroTurno = o.isTurnoNuovo === true && o.principale.isDaSveglia !== true
  const base: Sveglie = {
    ...o.sveglie,
    ...(isProgresso ? { impronta: o.impronta, tentativi: 0, isEsaurita: false } : {}),
    ...(isAltroTurno ? { controlli: 0 } : {}),
  }
  const no = { isDovuta: false, sveglie: base }
  // Esc della persona: la principale resta ferma finche non scrive lei.
  if (o.principale.isOccupata || o.principale.motivo === 'aborted' || o.aperte === 0) return no
  const fermaDaMs = o.oraMs - Math.max(o.principale.fineMs, base.ultimaMs)
  if (o.agentiInCorso > 0) {
    const isNovita = (o.novita ?? 0) > 0
    const controlli = o.controlloMinuti ?? CONTROLLO_PREDEFINITO_MIN
    const attesa = isNovita ? ATTESA_MS : (controlli[Math.min(base.controlli, controlli.length - 1)] ?? 60) * 60_000
    if (fermaDaMs < attesa) return no

    return { isDovuta: true, sveglie: { ...base, controlli: isNovita ? 0 : base.controlli + 1, ultimaMs: o.oraMs } }
  }
  if (base.isEsaurita) return no
  const attesa = Math.min(ATTESA_MS * 2 ** base.tentativi, ATTESA_MASSIMA_MS)
  if (fermaDaMs < attesa) return no
  if (base.tentativi >= MASSIMO_SVEGLIE) return { isDovuta: false, sveglie: { ...base, isEsaurita: true } }

  return { isDovuta: true, sveglie: { ...base, tentativi: base.tentativi + 1, ultimaMs: o.oraMs } }
}

/** Corto: solo cio che e cambiato e i conteggi; l'elenco delle voci la principale lo legge dagli strumenti. */
export function testoSveglia(o: { aperte: number; agentiInCorso: number; minuti: number; motivo?: string; domande?: number; finiti?: readonly string[]; posta?: number }): string {
  const finiti = (o.finiti ?? []).slice(0, MASSIMO_FINITI_NEL_TESTO)
  const altri = (o.finiti ?? []).length - finiti.length
  const posta = o.posta ?? 0
  const domande = o.domande ?? 0

  return [
    `[regia · sveglia] Ferma da ${o.minuti} min. Voci aperte: ${o.aperte}. Agenti in corso: ${o.agentiInCorso}.`,
    ...(finiti.length > 0 ? [`Da quando hai guardato: ${finiti.join(', ')}${altri > 0 ? ` e altri ${altri}` : ''}.`] : []),
    ...(posta > 0 ? [`Posta non letta: ${posta} (posta_leggi).`] : []),
    ...(domande > 0 ? [`Domande aperte per la persona: ${domande}, non ripeterle.`] : []),
    ...(o.motivo === 'error' ? ['Il tuo ultimo turno si e chiuso per un errore dell\'API: riprendi da dove eri.'] : []),
    'Vai avanti da sola col piano (scaletta_scrivi lo aggiorna, sciame_stato dice gli esiti) senza chiedere il permesso; segna `bloccato` con il motivo cio che non puoi fare.',
  ].join('\n')
}

// ── la parte che parla col motore ──

// Vive col modulo: dopo un ricaricamento la principale si considera ferma da adesso.
const principale: StatoPrincipale = { isOccupata: false, fineMs: 0 }
let sveglie: Sveglie = { impronta: '', tentativi: 0, ultimaMs: 0, isEsaurita: false, controlli: 0 }
/** agentId → ultimo segno di vita (un passo o la prima volta che lo si vede). */
const ultimoPasso = new Map<string, number>()
/** Stalli gia segnalati, per non ripeterli. */
const segnalati = new Set<string>()
/** Stalli trovati e non ancora detti alla principale (era occupata). */
let daDire: string[] = []
let timer: Timer | undefined
let isInGiro = false
/** `fineMs` della principale al giro prima. */
let fineVista = 0
/** Voci aperte del piano al giro prima, per accorgersi che e finito. */
let aperteViste = 0
/** I lavori finiti che la principale ha gia visto (o fatto lei); `undefined` prima del primo giro. */
let finitiVisti: Set<string> | undefined
/** Finiti dopo l'ultima volta che la principale ha guardato, in attesa di una sveglia che li dica. */
let finitiNuovi: string[] = []
/** La regia ha chiesto un turno e la principale non l'ha ancora iniziato. */
let isSvegliaInAttesa = false
/** La mod sta compattando la conversazione (`compatta-motore.ts`): niente sveglie finche non ha finito. */
let isCompattazione = false

export function notaInizioPrincipale(): void {
  principale.isOccupata = true
  principale.isDaSveglia = isSvegliaInAttesa
  isSvegliaInAttesa = false
}

export function notaFinePrincipale(oraMs: number, motivo: string): void {
  principale.isOccupata = false
  principale.fineMs = oraMs
  principale.motivo = motivo
}

/** La compattazione fatta dalla mod inizia o finisce: nel mezzo la sorveglianza non manda turni. */
export function notaCompattazione(isInCorso: boolean): void {
  isCompattazione = isInCorso
}

/** Vero se la principale ha un turno in corso, o gliene e stato appena chiesto uno. */
export const isPrincipaleOccupata = (): boolean => principale.isOccupata

export function notaPassoAgente(agentId: string, oraMs: number): void {
  ultimoPasso.set(agentId, oraMs)
}

/** Uccide i processi (`codex exec`, `qwen`, `copilot`, `qodercli`) di un lavoro: lo script scrive `fine` con exit diverso da 0. */
async function uccidiCodex($: EngineInterface, nome: string): Promise<boolean> {
  const pids = (await leggiProcessi($)).dati?.filter(p => p.nome === nome).map(p => String(p.pid)) ?? []
  if (pids.length === 0) return false
  const r = await $.process.run(['kill', ...pids], { timeoutMs: 5_000 })

  return r.exitCode === 0
}

/**
 * L'ultimo segno di vita di un Codex. Il log (stderr) resta fermo per tutto un
 * comando lungo; il file di sessione di Codex (`~/.codex/sessions/.../rollout-*-<id>.jsonl`)
 * invece si scrive a ogni attesa del comando: lo si guarda quando il log e fermo.
 */
async function ultimoSegnoCodex($: EngineInterface, home: string, log: string): Promise<number | undefined> {
  const stat = await $.fs.stat(log).catch(() => undefined)
  if (stat === undefined) return undefined
  const testa = await $.process.run(['head', '-c', '4000', log], { timeoutMs: 5_000 })
  const id = intestazioneLog(testa.stdout).sessione
  if (id === undefined || !/^[\w-]+$/.test(id)) return stat.mtimeMs
  const radice = (await $.env.get('CODEX_HOME')) ?? `${home}/.codex`
  const r = await $.process.run(['find', `${radice}/sessions`, '-name', `rollout-*${id}.jsonl`], { timeoutMs: 15_000 })
  const rollout = r.stdout.split('\n').find(x => x !== '')
  const sessione = rollout === undefined ? undefined : await $.fs.stat(rollout).catch(() => undefined)

  return Math.max(stat.mtimeMs, sessione?.mtimeMs ?? 0)
}

/**
 * L'ultimo segno di vita di un Qwen (o di un Qoder, stesso formato in `~/.qoder`). Il log (stderr) e l'esito (stdout) restano fermi fino alla fine;
 * il file di sessione (`~/.qwen/projects/<cartella>/<id>.jsonl`, l'id sta in `<nome>.sessione`) si scrive a ogni passo.
 */
async function ultimoSegnoQwen($: EngineInterface, home: string, log: string, nome: string, cartellaCli = '.qwen'): Promise<number | undefined> {
  const stat = await $.fs.stat(log).catch(() => undefined)
  if (stat === undefined) return undefined
  const file = `${cartellaDi(log)}/${nome}.sessione`
  const id = (await $.fs.exists(file)) ? (await $.fs.read(file)).trim() : ''
  if (!/^[\w-]+$/.test(id)) return stat.mtimeMs
  const radice = `${home}/${cartellaCli}`
  const r = await $.process.run(['find', `${radice}/projects`, '-name', `${id}.jsonl`], { timeoutMs: 15_000 })
  const jsonl = r.stdout.split('\n').find(x => x !== '')
  const sessione = jsonl === undefined ? undefined : await $.fs.stat(jsonl).catch(() => undefined)

  return Math.max(stat.mtimeMs, sessione?.mtimeMs ?? 0)
}

/**
 * L'ultimo segno di vita di un Copilot. Il log (stderr) resta fermo: si guardano l'esito (stdout) e il registro
 * degli eventi della sessione (`~/.copilot/session-state/<id>/events.jsonl`, l'id sta in `<nome>.sessione`).
 */
async function ultimoSegnoCopilot($: EngineInterface, home: string, log: string, nome: string): Promise<number | undefined> {
  const stat = await $.fs.stat(log).catch(() => undefined)
  if (stat === undefined) return undefined
  const cartella = cartellaDi(log)
  const file = `${cartella}/${nome}.sessione`
  const id = (await $.fs.exists(file)) ? (await $.fs.read(file)).trim() : ''
  const radice = (await $.env.get('COPILOT_HOME')) ?? `${home}/.copilot`
  const altri = [`${cartella}/${nome}.esito.md`, ...(/^[\w-]+$/.test(id) ? [`${radice}/session-state/${id}/events.jsonl`] : [])]
  const tempi = await Promise.all(altri.map(p => $.fs.stat(p).then(x => x.mtimeMs, () => 0)))

  return Math.max(stat.mtimeMs, ...tempi)
}

/** Gli agenti in corso fermi da troppo: i Codex, i Qwen, i Copilot e i Qoder li ferma, i Claude li elenca. */
async function controllaStalli($: EngineInterface, home: string, inCorso: readonly RegiaRiga[], oraMs: number, stalloMs: number): Promise<string[]> {
  const righe: string[] = []
  for (const r of inCorso) {
    if (r.fonte === 'codex' && r.fileLog !== undefined) {
      if (segnalati.has(r.chiave)) continue
      const log = await $.fs.stat(r.fileLog).catch(() => undefined)
      if (log === undefined || oraMs - log.mtimeMs < stalloMs) continue
      const esecutore: EsecutoreCli = ESECUTORI_CLI.find(e => e === r.esecutore) ?? 'codex'
      const cli = NOME_CLI[esecutore]
      const segno = esecutore === 'copilot' ? await ultimoSegnoCopilot($, home, r.fileLog, r.nome)
        : esecutore === 'qwen' || esecutore === 'qoder' ? await ultimoSegnoQwen($, home, r.fileLog, r.nome, esecutore === 'qoder' ? '.qoder' : '.qwen')
          : await ultimoSegnoCodex($, home, r.fileLog)
      if (segno === undefined || oraMs - segno < stalloMs) continue
      segnalati.add(r.chiave)
      const minuti = Math.round((oraMs - segno) / 60_000)
      const isUcciso = await uccidiCodex($, r.nome)
      $.ui.toast(`regia: ${cli} ${r.nome} fermo da ${minuti} min${isUcciso ? ', fermato' : ''}`, { timeoutMs: 10_000 })
      righe.push(isUcciso
        ? `- ${cli} "${r.nome}": nessun segno di vita da ${minuti} min (log e sessione ${cli} fermi), l'ho fermato. Se era di uno sciame lo rilancia lo sciame; se no rilancialo tu (${esecutore}_riprendi o un nuovo lavoro).`
        : `- ${cli} "${r.nome}": nessun segno di vita da ${minuti} min, e non e stato possibile fermarlo: fallo tu.`)
    } else if (r.fonte === 'claude' && r.agenteId !== undefined) {
      const visto = ultimoPasso.get(r.agenteId)
      if (visto === undefined) {
        ultimoPasso.set(r.agenteId, oraMs)
        continue
      }
      if (oraMs - visto < stalloMs || segnalati.has(r.chiave)) continue
      segnalati.add(r.chiave)
      const minuti = Math.round((oraMs - visto) / 60_000)
      $.ui.toast(`regia: subagente ${r.nome} senza passi da ${minuti} min`, { timeoutMs: 10_000 })
      righe.push(`- Subagente "${r.nome}" (id ${r.agenteId}): nessun passo da ${minuti} min. Se non sta solo aspettando un comando lungo, fermalo con TaskStop e rilancia il compito.`)
    }
  }

  return righe
}

/** Chiede un turno alla principale. Anche la ripresa dopo una compattazione passa di qui, cosi non si somma a una sveglia. */
export async function sveglia($: EngineInterface, testo: string, nome = 'sveglia'): Promise<void> {
  // Una sveglia alla volta: la prossima solo dopo che la principale ha girato.
  principale.isOccupata = true
  isSvegliaInAttesa = true
  await $.prompt.submit({ text: testo }).catch(errore => {
    principale.isOccupata = false
    isSvegliaInAttesa = false
    $.ui.toast(`regia: ${nome} non riuscita (${messaggioErrore(errore)})`)
  })
}

/** Lavori finiti da quando la principale ha guardato; cio che vede (o fa) lei non e una novita. */
function aggiornaFiniti(fatti: readonly RegiaRiga[], isVisto: boolean): void {
  if (finitiVisti === undefined || isVisto) {
    finitiVisti = new Set(fatti.map(r => r.chiave))
    finitiNuovi = []

    return
  }
  for (const r of fatti.filter(f => !finitiVisti?.has(f.chiave))) {
    finitiVisti.add(r.chiave)
    finitiNuovi.push(`${r.nome} (${r.stato})`)
  }
}

/** Messaggi alla principale arrivati dopo il suo ultimo turno e non letti. */
export function postaNonLetta(s: RegiaSnapshot, dopoMs: number): number {
  return s.posta.sessione.filter(m => m.a.toLowerCase() === PRINCIPALE && (m.stato === 'nuovo' || m.stato === 'consegnato') && m.ora > dopoMs).length
}

/** Un giro: stalli, poi la sveglia. Solo con una superficie e la sveglia accesa. */
export async function giroSorveglianza($: EngineInterface, leggiSnapshot: () => Promise<RegiaSnapshot>): Promise<void> {
  if (isInGiro) return
  isInGiro = true
  try {
    const home = await leggiHome($)
    if (home === undefined) return
    const config = (await leggiConfig($, home)).dati
    if (!config.sveglia || (await $.session.surfaces()).length === 0) return
    // quick: un solo agente, nessuno da sorvegliare. medio: solo gli stalli. long: anche la sveglia.
    const { profilo } = await leggiProfilo($)
    if (profilo === 'quick') return
    const [s, oraMs] = await Promise.all([leggiSnapshot(), $.clock.now()])
    if (s.aggiornatoMs === 0) return
    if (principale.fineMs === 0) principale.fineMs = oraMs
    const inCorso = s.viste.sessione.inCorso.filter(isAgente)
    daDire = [...daDire, ...(await controllaStalli($, home, inCorso, oraMs, config.stalloMinuti * 60_000))]
    const aperte = profilo === 'long' ? vociAperte(s) : []
    if (aperteViste > 0 && aperte.length === 0 && s.piano.length > 0) void notifica($, `Piano finito: ${s.piano.length} voci chiuse.`, 'piano')
    aperteViste = aperte.length
    const isTurnoNuovo = principale.fineMs !== fineVista
    fineVista = principale.fineMs
    aggiornaFiniti(s.viste.sessione.fatti.filter(isAgente), principale.isOccupata || isTurnoNuovo)
    const posta = postaNonLetta(s, principale.fineMs)
    // Mentre la mod compatta la principale non e libera: la ripresa, se serve, la manda la compattazione.
    const isOccupata = principale.isOccupata || isCompattazione
    const decisa = decidiSveglia({
      oraMs, principale: { ...principale, isOccupata }, aperte: aperte.length, agentiInCorso: inCorso.length, impronta: impronta(s), sveglie, isTurnoNuovo,
      novita: finitiNuovi.length + posta, controlloMinuti: config.controlloMinuti,
    })
    if (decisa.sveglie.isEsaurita && !sveglie.isEsaurita) {
      $.ui.toast(`regia: ${MASSIMO_SVEGLIE} sveglie senza progressi, il piano e fermo: serve te`, { timeoutMs: 30_000 })
      void notifica($, `Il piano e fermo: ${MASSIMO_SVEGLIE} sveglie senza progressi, serve te.`, 'piano')
    }
    if (!decisa.isDovuta) sveglie = decisa.sveglie
    if (isOccupata || principale.motivo === 'aborted' || (!decisa.isDovuta && daDire.length === 0)) return
    // La persona sta scrivendo: non le si passa davanti (la sveglia non conta).
    if ((await $.prompt.read()).text.trim() !== '') return
    sveglie = decisa.sveglie
    const minuti = Math.round((oraMs - principale.fineMs) / 60_000)
    const parti = [
      ...(daDire.length > 0 ? ['[regia · sorveglianza] Agenti fermi:', ...daDire] : []),
      ...(decisa.isDovuta ? [testoSveglia({ aperte: aperte.length, agentiInCorso: inCorso.length, minuti, motivo: principale.motivo, domande: s.domande.length, finiti: finitiNuovi, posta })] : []),
    ]
    daDire = []
    if (decisa.isDovuta) finitiNuovi = []
    await sveglia($, parti.join('\n'))
  } catch (errore) {
    $.ui.toast(`regia: sorveglianza: ${messaggioErrore(errore)}`)
  } finally {
    isInGiro = false
  }
}

export function avviaSorveglianza($: EngineInterface, leggiSnapshot: () => Promise<RegiaSnapshot>): void {
  if (timer !== undefined) return
  timer = $.clock.every(GIRO_MS, () => giroSorveglianza($, leggiSnapshot))
}

export function fermaSorveglianza(): void {
  timer?.cancel()
  timer = undefined
}
