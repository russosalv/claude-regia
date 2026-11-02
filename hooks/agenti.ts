// Subagenti Claude: dallo stato di `$.agent.list()` alle righe del cruscotto.
// Puro. AgentInfo non porta l'ora di inizio: la mod ricorda quando ha visto
// un agente la prima volta e dichiara la durata incerta se c'era gia alla
// prima lettura.

import type { AgentInfo } from 'claude-code'

import type { RegiaRiga, RegiaStato, RegiaTempoAgente } from '../types/index'
import { tokenTotali } from './memoria-agenti'
import type { InfoAgente, LancioCodex } from './memoria-agenti'

/**
 * In corso solo chi lavora davvero: `running`, `pending`, `waiting` (in attesa
 * di un permesso). `idle` vale solo per un teammate, che aspetta messaggi; un
 * subagente `idle` ha finito il suo giro e conta come concluso.
 */
export function statoAgente(agente: Pick<AgentInfo, 'status' | 'teammateId'>): RegiaStato {
  switch (agente.status) {
    case 'running':
    case 'pending':
    case 'waiting':
      return 'in_corso'
    case 'idle':
      return agente.teammateId === undefined ? 'fatto' : 'in_corso'
    case 'failed':
      return 'fallito'
    case 'killed':
      return 'interrotto'
    case 'completed':
      return 'fatto'
  }
}

const ESITI: Readonly<Record<AgentInfo['status'], string | undefined>> = {
  running: undefined,
  pending: 'in avvio',
  waiting: 'in attesa di permesso',
  idle: 'concluso',
  completed: 'completato',
  failed: 'fallito',
  killed: 'fermato',
}

function esitoAgente(agente: Pick<AgentInfo, 'status' | 'teammateId'>): string | undefined {
  if (agente.status === 'idle' && agente.teammateId !== undefined) return 'in attesa di messaggi'

  return ESITI[agente.status]
}

/**
 * Quando ogni agente e stato visto: un agente nuovo ha l'inizio noto solo se
 * compare dopo la prima lettura ed e ancora attivo; uno gia concluso alla
 * prima vista non ha ne inizio ne fine noti.
 */
export function aggiornaTempi(
  agenti: readonly AgentInfo[],
  precedenti: Readonly<Record<string, RegiaTempoAgente>>,
  oraMs: number,
  isPrimaLettura: boolean,
): Record<string, RegiaTempoAgente> {
  const voci = agenti.map((a): [string, RegiaTempoAgente] => {
    const prima = precedenti[a.id]
    const isAttivo = statoAgente(a) === 'in_corso'
    if (prima === undefined) {
      return [a.id, { inizioMs: oraMs, fineMs: isAttivo ? undefined : oraMs, isInizioNoto: !isPrimaLettura && isAttivo }]
    }

    return [a.id, { ...prima, fineMs: isAttivo ? undefined : (prima.fineMs ?? oraMs) }]
  })

  return Object.fromEntries(voci)
}

/** Secondi e certezza: certi con l'inizio noto, un minimo se e ancora in corso, nulla se no. */
function durata(tempo: RegiaTempoAgente | undefined, oraMs: number) {
  if (tempo === undefined) return { durataSec: undefined, isDurataCerta: false }
  const secondi = ((tempo.fineMs ?? oraMs) - tempo.inizioMs) / 1000
  if (tempo.isInizioNoto) return { durataSec: secondi, isDurataCerta: true }

  return tempo.fineMs === undefined
    ? { durataSec: secondi, isDurataCerta: false }
    : { durataSec: undefined, isDurataCerta: false }
}

export function righeAgenti(
  agenti: readonly AgentInfo[],
  tempi: Readonly<Record<string, RegiaTempoAgente>>,
  oraMs: number,
): RegiaRiga[] {
  return agenti.map(a => ({
    chiave: `claude:${a.id}`,
    nome: a.description || a.name || a.id,
    fonte: 'claude',
    esecutore: `claude:${a.type}`,
    stato: statoAgente(a),
    ...durata(tempi[a.id], oraMs),
    esito: esitoAgente(a),
    agenteId: a.id,
  }))
}

/**
 * Un subagente concluso ricordato in `$.store`: il motore lo toglie da
 * `$.agent.list()` poco dopo la fine, la mod lo tiene nei Fatti.
 */
export type RicordoAgente = {
  id: string
  nome: string
  tipo: string
  stato: RegiaStato
  esito?: string
  /** Quando la mod l'ha visto concluso. */
  fineMs: number
  durataSec?: number
}

const MASSIMO_AGENTI_RICORDATI = 50
const STATI_CONCLUSI: readonly RegiaStato[] = ['fatto', 'fallito', 'interrotto']

/** Legge i ricordi dallo store, scartando le voci malformate. */
export function ricordiDaMemoria(grezzo: unknown): RicordoAgente[] {
  const lista = (grezzo as { agenti?: unknown } | undefined)?.agenti
  if (!Array.isArray(lista)) return []

  return lista.filter((v): v is RicordoAgente => {
    const r = v as Partial<RicordoAgente> | null
    return typeof r?.id === 'string' && typeof r.nome === 'string' && typeof r.tipo === 'string'
      && typeof r.fineMs === 'number' && STATI_CONCLUSI.includes(r.stato as RegiaStato)
  })
}

/** I ricordi di prima piu gli agenti conclusi ora, i piu recenti per primi. */
export function ricordiAggiornati(
  ricordati: readonly RicordoAgente[],
  agenti: readonly AgentInfo[],
  tempi: Readonly<Record<string, RegiaTempoAgente>>,
  oraMs: number,
): RicordoAgente[] {
  const nuovi = righeAgenti(agenti, tempi, oraMs)
    .filter(r => STATI_CONCLUSI.includes(r.stato) && r.agenteId !== undefined)
    .map((r): RicordoAgente => ({
      id: r.agenteId ?? '',
      nome: r.nome,
      tipo: r.esecutore.replace(/^claude:/, ''),
      stato: r.stato,
      esito: r.esito,
      fineMs: tempi[r.agenteId ?? '']?.fineMs ?? oraMs,
      ...(r.durataSec === undefined ? {} : { durataSec: r.durataSec }),
    }))
  const perId = new Map(ricordati.map(r => [r.id, r]))
  for (const r of nuovi) perId.set(r.id, { ...r, fineMs: perId.get(r.id)?.fineMs ?? r.fineMs })

  return [...perId.values()].sort((a, b) => b.fineMs - a.fineMs).slice(0, MASSIMO_AGENTI_RICORDATI)
}

/** Righe dei Fatti per gli agenti ricordati che `$.agent.list()` non riporta piu. */
export function righeDaRicordi(ricordi: readonly RicordoAgente[], presenti: ReadonlySet<string>): RegiaRiga[] {
  return ricordi
    .filter(r => !presenti.has(r.id))
    .map(r => ({
      chiave: `claude:${r.id}`,
      nome: r.nome,
      fonte: 'claude' as const,
      esecutore: `claude:${r.tipo}`,
      stato: r.stato,
      esito: r.esito,
      durataSec: r.durataSec,
      isDurataCerta: r.durataSec !== undefined,
    }))
}

/** Modello, motivo e token che la mod ha registrato per ogni subagente. */
export function conInfoAgenti(righe: readonly RegiaRiga[], info: Readonly<Record<string, InfoAgente>>): RegiaRiga[] {
  return righe.map(r => {
    const voce = r.fonte === 'claude' ? info[r.chiave.slice('claude:'.length)] : undefined
    if (voce === undefined) return r
    const token = tokenTotali(voce.token)

    return {
      ...r,
      ...(voce.modello === undefined ? {} : { modello: voce.modello }),
      ...(voce.sforzo === undefined ? {} : { effort: voce.sforzo }),
      ...(voce.motivo === undefined ? {} : { motivoModello: voce.motivo }),
      ...(voce.provenienza === undefined ? {} : { provenienzaModello: voce.provenienza }),
      ...(token === undefined ? {} : { token }),
    }
  })
}

/** I lavori Codex conclusi non hanno piu il processo: modello e sforzo vengono dal lancio. */
export function conLanci(righe: readonly RegiaRiga[], lanci: Readonly<Record<string, LancioCodex>>): RegiaRiga[] {
  return righe.map(r => {
    const lancio = r.fonte === 'codex' && r.modello === undefined ? lanci[r.nome] : undefined

    return lancio === undefined ? r : { ...r, modello: lancio.modello, effort: lancio.sforzo }
  })
}
