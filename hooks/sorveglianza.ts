// La sorveglianza: tiene in moto il piano quando nessuno guarda (la sveglia
// solo in modalita long, gli stalli anche in medio, nulla in quick). Due cose:
// - un agente che non da segni di vita da `stalloMinuti` e fermo: un Codex si
//   uccide (lo sciame lo rilancia un gradino sopra), un subagente Claude, che una
//   mod non puo fermare, si segnala alla principale perche usi TaskStop;
// - la principale ferma con voci del piano ancora aperte e nessun agente che
//   lavora (o qualcosa appena finito) viene svegliata con un turno che le dice
//   di andare avanti. Senza progressi le sveglie si diradano e poi smettono.

import type { EngineInterface, Timer } from 'claude-code'

import type { RegiaRiga, RegiaSnapshot } from '../types/index'
import { intestazioneLog } from './codex'
import { leggiConfig, leggiHome, leggiProcessi } from './fonti'
import { messaggioErrore } from './parsers'
import { leggiProfilo, notifica } from './profilo'

const GIRO_MS = 60_000
export const ATTESA_MS = 3 * 60_000
const ATTESA_MASSIMA_MS = 60 * 60_000
export const MASSIMO_SVEGLIE = 5
const MASSIMO_VOCI_NEL_TESTO = 10

/** La principale: se ha un turno in corso e quando ha finito l'ultimo. */
export type StatoPrincipale = { isOccupata: boolean; fineMs: number; motivo?: string }

/** Memoria delle sveglie: l'impronta del piano all'ultima, quante senza progressi. */
export type Sveglie = { impronta: string; tentativi: number; ultimaMs: number; isEsaurita: boolean }

const isAgente = (r: RegiaRiga) => r.fonte === 'claude' || r.fonte === 'codex'

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
 * L'attesa raddoppia a ogni sveglia senza progressi (3, 6, 12... fino a 60 min).
 */
export function decidiSveglia(o: {
  oraMs: number
  principale: StatoPrincipale
  aperte: number
  agentiInCorso: number
  impronta: string
  sveglie: Sveglie
  /** La principale ha chiuso un turno dal giro prima: cio che e cambiato l'ha gia visto. */
  isTurnoNuovo?: boolean
}): { isDovuta: boolean; sveglie: Sveglie } {
  const isProgresso = o.impronta !== o.sveglie.impronta
  const base: Sveglie = isProgresso ? { impronta: o.impronta, tentativi: 0, ultimaMs: o.sveglie.ultimaMs, isEsaurita: false } : o.sveglie
  const no = { isDovuta: false, sveglie: base }
  // Esc della persona: la principale resta ferma finche non scrive lei.
  if (o.principale.isOccupata || o.principale.motivo === 'aborted' || o.aperte === 0 || base.isEsaurita) return no
  // Qualcuno lavora e nulla e finito che la principale non abbia visto: si aspetta (lo stallo lo guarda a parte).
  if (o.agentiInCorso > 0 && (!isProgresso || o.isTurnoNuovo === true)) return no
  const attesa = Math.min(ATTESA_MS * 2 ** base.tentativi, ATTESA_MASSIMA_MS)
  if (o.oraMs - Math.max(o.principale.fineMs, base.ultimaMs) < attesa) return no
  if (base.tentativi >= MASSIMO_SVEGLIE) return { isDovuta: false, sveglie: { ...base, isEsaurita: true } }

  return { isDovuta: true, sveglie: { ...base, tentativi: base.tentativi + 1, ultimaMs: o.oraMs } }
}

export function testoSveglia(o: { aperte: readonly RegiaRiga[]; agentiInCorso: number; minuti: number; motivo?: string; domande?: number }): string {
  const voci = o.aperte.slice(0, MASSIMO_VOCI_NEL_TESTO).map(r => `- ${r.nome} (${r.stato})`)
  const altre = o.aperte.length - voci.length

  return [
    `[regia · sveglia] La sessione e ferma da ${o.minuti} min e il piano ha ${o.aperte.length} voci aperte:`,
    ...voci,
    ...(altre > 0 ? [`- e altre ${altre}`] : []),
    o.agentiInCorso === 0 ? 'Nessun agente sta lavorando.' : `Agenti ancora in corso: ${o.agentiInCorso}; qualcosa e finito da quando la sessione si e fermata.`,
    ...((o.domande ?? 0) > 0 ? [`Ci sono ${o.domande} domande aperte per la persona (le vede nel pane): non ripeterle, vai avanti con cio che non dipende da esse.`] : []),
    ...(o.motivo === 'error' ? ['Il tuo ultimo turno si e chiuso per un errore dell\'API: riprendi da dove eri.'] : []),
    'Vai avanti da sola col piano: controlla gli esiti, lancia le prossime voci (insieme quelle indipendenti) e aggiorna la scaletta con scaletta_scrivi.',
    'Non chiedere alla persona il permesso di proseguire. Una voce che non puoi fare segnala `bloccato` con il motivo e passa alla successiva; fermati solo se manca una decisione che spetta a lei, e scrivilo. Se il piano e finito, segna le voci `fatto`.',
  ].join('\n')
}

// ── la parte che parla col motore ──

// Vive col modulo: dopo un ricaricamento la principale si considera ferma da adesso.
const principale: StatoPrincipale = { isOccupata: false, fineMs: 0 }
let sveglie: Sveglie = { impronta: '', tentativi: 0, ultimaMs: 0, isEsaurita: false }
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

export function notaInizioPrincipale(): void {
  principale.isOccupata = true
}

export function notaFinePrincipale(oraMs: number, motivo: string): void {
  principale.isOccupata = false
  principale.fineMs = oraMs
  principale.motivo = motivo
}

export function notaPassoAgente(agentId: string, oraMs: number): void {
  ultimoPasso.set(agentId, oraMs)
}

/** Uccide i `codex exec` di un lavoro: lo script scrive `fine` con exit diverso da 0. */
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

/** Gli agenti in corso fermi da troppo: i Codex li ferma, i Claude li elenca. */
async function controllaStalli($: EngineInterface, home: string, inCorso: readonly RegiaRiga[], oraMs: number, stalloMs: number): Promise<string[]> {
  const righe: string[] = []
  for (const r of inCorso) {
    if (r.fonte === 'codex' && r.fileLog !== undefined) {
      if (segnalati.has(r.chiave)) continue
      const log = await $.fs.stat(r.fileLog).catch(() => undefined)
      if (log === undefined || oraMs - log.mtimeMs < stalloMs) continue
      const segno = await ultimoSegnoCodex($, home, r.fileLog)
      if (segno === undefined || oraMs - segno < stalloMs) continue
      segnalati.add(r.chiave)
      const minuti = Math.round((oraMs - segno) / 60_000)
      const isUcciso = await uccidiCodex($, r.nome)
      $.ui.toast(`regia: Codex ${r.nome} fermo da ${minuti} min${isUcciso ? ', fermato' : ''}`, { timeoutMs: 10_000 })
      righe.push(isUcciso
        ? `- Codex "${r.nome}": nessun segno di vita da ${minuti} min (log e sessione Codex fermi), l'ho fermato. Se era di uno sciame lo rilancia lo sciame; se no rilancialo tu (codex_riprendi o un nuovo lavoro).`
        : `- Codex "${r.nome}": nessun segno di vita da ${minuti} min, e non e stato possibile fermarlo: fallo tu.`)
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

async function sveglia($: EngineInterface, testo: string): Promise<void> {
  // Una sveglia alla volta: la prossima solo dopo che la principale ha girato.
  principale.isOccupata = true
  await $.prompt.submit({ text: testo }).catch(errore => {
    principale.isOccupata = false
    $.ui.toast(`regia: sveglia non riuscita (${messaggioErrore(errore)})`)
  })
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
    const decisa = decidiSveglia({ oraMs, principale, aperte: aperte.length, agentiInCorso: inCorso.length, impronta: impronta(s), sveglie, isTurnoNuovo })
    if (decisa.sveglie.isEsaurita && !sveglie.isEsaurita) {
      $.ui.toast(`regia: ${MASSIMO_SVEGLIE} sveglie senza progressi, il piano e fermo: serve te`, { timeoutMs: 30_000 })
      void notifica($, `Il piano e fermo: ${MASSIMO_SVEGLIE} sveglie senza progressi, serve te.`, 'piano')
    }
    if (!decisa.isDovuta) sveglie = decisa.sveglie
    if (principale.isOccupata || principale.motivo === 'aborted' || (!decisa.isDovuta && daDire.length === 0)) return
    // La persona sta scrivendo: non le si passa davanti (la sveglia non conta).
    if ((await $.prompt.read()).text.trim() !== '') return
    sveglie = decisa.sveglie
    const minuti = Math.round((oraMs - principale.fineMs) / 60_000)
    const parti = [
      ...(daDire.length > 0 ? ['[regia · sorveglianza] Agenti fermi:', ...daDire] : []),
      ...(decisa.isDovuta ? [testoSveglia({ aperte, agentiInCorso: inCorso.length, minuti, motivo: principale.motivo, domande: s.domande.length })] : []),
    ]
    daDire = []
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
