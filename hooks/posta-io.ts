// Posta fra agenti, la parte che parla col mondo: la casella si legge col
// disco e si scrive solo con `script/posta` (che tiene il lucchetto, cosi
// Codex e la mod non si sovrascrivono); la consegna ai Claude passa da
// `$.session.append`.

import type { EngineInterface } from 'claude-code'

import { statoAgente } from './agenti'
import { leggiCoda, leggiProcessi } from './fonti'
import { leggiMemoriaAgenti } from './memoria-agenti'
import { messaggioErrore } from './parsers'
import { PRINCIPALE, percorsiPosta, piegaPosta, risolviIndirizzo, testoConsegna } from './posta'
import type { AgenteNoto, Destinatario, Messaggio, StatoPosta } from './posta'

const RIGHE_CASELLA = 4000

export function cliPosta($: EngineInterface): string {
  return `${$.plugin.root}/script/posta`
}

/** I messaggi della casella; senza casella nessuno. */
export async function leggiCasella($: EngineInterface, home: string): Promise<{ dati: Messaggio[]; avvisi: string[] }> {
  const { casella } = percorsiPosta(home)
  if (!(await $.fs.exists(casella))) return { dati: [], avvisi: [] }
  const coda = await leggiCoda($, casella, RIGHE_CASELLA)
  if (coda.dati === undefined) return { dati: [], avvisi: coda.avvisi.map(a => `posta: ${a}`) }

  return { dati: piegaPosta(coda.dati), avvisi: [] }
}

export type NuovoMessaggio = { da: string; a: string; testo: string; sessione?: string; via: string; stato?: StatoPosta }

/** Scrive un messaggio con la CLI e lo restituisce com'e stato registrato. */
export async function aggiungiMessaggio($: EngineInterface, nuovo: NuovoMessaggio): Promise<Messaggio> {
  const r = await $.process.run(['python3', '-I', cliPosta($), 'aggiungi'], { stdin: JSON.stringify(nuovo), timeoutMs: 10_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim().replace(/^posta: /, '') || `posta terminata con codice ${r.exitCode}`)
  const [registrato] = piegaPosta(r.stdout)
  if (registrato === undefined) throw new Error('la posta non ha restituito il messaggio registrato')

  return registrato
}

export async function segnaStato($: EngineInterface, id: string, stato: StatoPosta, nota?: string): Promise<void> {
  const argv = ['python3', '-I', cliPosta($), 'stato', id, stato, ...(nota === undefined ? [] : [nota])]
  const r = await $.process.run(argv, { timeoutMs: 10_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `posta stato terminata con codice ${r.exitCode}`)
}

/** Gli agenti della sessione, per nome e id, e i lavori Codex vivi e conclusi. */
export async function rubrica($: EngineInterface, sessione: string) {
  const [agenti, processi, memoria] = await Promise.all([
    $.agent.list().catch(() => []),
    leggiProcessi($),
    leggiMemoriaAgenti($, sessione),
  ])
  const noti: AgenteNoto[] = agenti.map(a => ({ id: a.id, nome: a.name, isInCorso: statoAgente(a) === 'in_corso' }))
  const inCorso = (processi.dati ?? []).map(p => p.nome)
  const finiti = Object.keys(memoria.dati.lanci).filter(n => !inCorso.includes(n))

  return { agenti: noti, codex: { inCorso, finiti } }
}

/** Il nome con cui firma un loop: la principale, o il nome (o l'id) del subagente. */
export async function mittenteDi($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return PRINCIPALE
  const agenti = await $.agent.list().catch(() => [])

  return agenti.find(a => a.id === agentId)?.name ?? agentId
}

/** Mette il messaggio nella conversazione di chi lo riceve; torna l'errore, se c'e. */
export async function consegna($: EngineInterface, m: Messaggio, d: Destinatario): Promise<string | undefined> {
  const message = { type: 'user' as const, content: [{ type: 'text' as const, text: testoConsegna(m) }] }
  try {
    if (d.tipo === 'subagente') {
      const r = await $.session.append({ agentId: d.agentId, message })
      return r.deny
    }
    if (d.tipo === 'principale') {
      const r = await $.session.append({ message })
      if (r.deny === undefined) $.ui.toast(`✉ da ${m.da}: ${m.testo.slice(0, 80)}`, { timeoutMs: 8_000 })
      return r.deny
    }
    if (d.tipo === 'utente') $.ui.toast(`✉ per te da ${m.da}: ${m.testo.slice(0, 80)}`, { timeoutMs: 8_000 })

    return undefined
  } catch (errore) {
    return messaggioErrore(errore)
  }
}
