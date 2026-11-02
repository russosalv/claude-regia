// Dalle letture grezze allo snapshot mostrato nel pane. Puro: l'ora e ogni
// lettura arrivano come argomenti.

import type { AgentInfo } from 'claude-code'

import type {
  RegiaMessaggio,
  RegiaRiga,
  RegiaSnapshot,
  RegiaStato,
  RegiaTempoAgente,
  RegiaVista,
  RegiaVistaDati,
} from '../types/index'
import {
  accorciaPercorso,
  cartellaLavoro,
  ultimoSegmento,
} from './parsers'
import type { ProcessoCodex, VoceLog } from './parsers'
import type { VoceRegistro } from './registro'
import { aggiornaTempi, conInfoAgenti, conLanci, righeAgenti, righeDaRicordi } from './agenti'
import type { InfoAgente, LancioCodex } from './memoria-agenti'
import { ultimiMessaggi } from './posta'
import type { Messaggio } from './posta'
import type { RicordoAgente } from './agenti'

export const MASSIMO_FATTI = 5
export const MASSIMO_SCALETTA = 8
const MASSIMO_NOMI_RICORDATI = 200

export type LetturaLog = {
  percorso: string
  voci: readonly VoceLog[]
  /** Nomi dei lavori il cui `<nome>.esito.md` esiste accanto al log. */
  esiti: ReadonlySet<string>
}

export type InputSnapshot = {
  oraMs: number
  home: string
  /** Una fonte che e fallita resta `undefined`: il suo avviso e in `avvisi`. */
  agenti?: readonly AgentInfo[]
  processi?: readonly ProcessoCodex[]
  log: readonly LetturaLog[]
  registro?: readonly VoceRegistro[]
  isRegistroPresente: boolean
  tempiPrecedenti: Readonly<Record<string, RegiaTempoAgente>>
  /** Vero se e la prima lettura della mod in questa sessione. */
  isPrimaLettura: boolean
  /** `$.session.id()`. */
  sessioneId?: string
  /** Compiti di uno sciame di questa sessione che aspettano di partire. */
  attesaSciame?: readonly { sciame: string; nome: string; esecutore: string; isBloccato: boolean }[]
  /** Subagenti conclusi ricordati in `$.store`. */
  ricordiAgenti?: readonly RicordoAgente[]
  /** Modello, motivo e token dei subagenti, per id (`regia.agenti.<sessione>`). */
  infoAgenti?: Readonly<Record<string, InfoAgente>>
  /** I messaggi della casella (tutti: il filtro per sessione si fa qui). */
  posta?: readonly Messaggio[]
  /** Lavori lanciati da `codex_avvia` in questa sessione, per nome. */
  lanci?: Readonly<Record<string, LancioCodex>>
  avvisi: readonly string[]
  /** Pid dei processi lanciati da questa sessione; `undefined` se non attribuibili. */
  pidMiei?: ReadonlySet<number>
  /** Nomi dei lavori Codex attribuiti a questa sessione (anche finiti). */
  nomiSessione: ReadonlySet<string>
}

export const MASSIMO_POSTA = 5

const VISTA_VUOTA: RegiaVistaDati = { inCorso: [], scaletta: [], scalettaExtra: 0, fatti: [], fattiExtra: 0 }

export const SNAPSHOT_VUOTO: RegiaSnapshot = {
  aggiornatoMs: 0,
  viste: { sessione: VISTA_VUOTA, tutti: VISTA_VUOTA },
  avvisi: [],
  isRegistroPresente: false,
  tempiAgenti: {},
  posta: { sessione: [], tutti: [] },
}

function testoEsito(voce: VoceLog): string | undefined {
  const parti = [
    voce.exitCode === undefined ? undefined : `exit ${voce.exitCode}`,
    voce.commit === undefined
      ? undefined
      : `${voce.commit} commit`,
    voce.tentativi > 0 ? `riprovi: ${voce.tentativi}` : undefined,
  ]
  const presenti = parti.filter((p): p is string => p !== undefined)

  return presenti.length === 0 ? undefined : presenti.join(' · ')
}

function trovaVoceAperta(
  nome: string,
  log: readonly LetturaLog[],
): { voce: VoceLog; lettura: LetturaLog } | undefined {
  const candidati = log.flatMap(lettura =>
    lettura.voci
      .filter(v => v.nome === nome && !v.isConclusa && !v.isSostituita)
      .map(voce => ({ voce, lettura })),
  )

  return candidati[candidati.length - 1]
}

function fileLog(lettura: LetturaLog | undefined, nome: string): string | undefined {
  return lettura === undefined ? undefined : `${cartellaLavoro(lettura.percorso, nome)}/${nome}.log`
}

function fileEsito(lettura: LetturaLog, nome: string, home: string) {
  return lettura.esiti.has(nome)
    ? accorciaPercorso(`${cartellaLavoro(lettura.percorso, nome)}/${nome}.esito.md`, home, 40)
    : undefined
}

function righeProcessi(input: InputSnapshot): RegiaRiga[] {
  return (input.processi ?? []).map(p => {
    const aperta = trovaVoceAperta(p.nome, input.log)
    const note = aperta?.voce.tentativi
      ? `riprovi: ${aperta.voce.tentativi}`
      : undefined

    return {
      chiave: `codex:${p.pid}`,
      nome: p.nome,
      fonte: 'codex',
      esecutore: 'codex',
      stato: 'in_corso',
      modello: p.modello,
      effort: p.effort,
      durataSec: p.durataSec,
      cartella:
        p.cartella === undefined ? undefined : accorciaPercorso(p.cartella, input.home),
      fileEsito:
        aperta === undefined ? undefined : fileEsito(aperta.lettura, p.nome, input.home),
      fileLog: fileLog(aperta?.lettura ?? input.log[0], p.nome),
      isDurataCerta: true,
      note,
    }
  })
}

function rigaDaVoce(
  voce: VoceLog,
  indice: number,
  lettura: LetturaLog,
  vivi: ReadonlySet<string>,
  input: InputSnapshot,
): RegiaRiga | undefined {
  const isPsNota = input.processi !== undefined
  if (!voce.isConclusa && !voce.isSostituita && isPsNota && vivi.has(voce.nome)) {
    return undefined
  }
  const base = {
    chiave: `log:${lettura.percorso}:${indice}`,
    nome: voce.nome,
    fonte: 'codex' as const,
    esecutore: 'codex',
    durataSec: voce.durataSec,
    fileEsito: fileEsito(lettura, voce.nome, input.home),
    fileLog: fileLog(lettura, voce.nome),
    isDurataCerta: true,
  }
  if (voce.isConclusa) {
    const isFallito = voce.exitCode !== undefined && voce.exitCode !== 0

    return {
      ...base,
      stato: isFallito ? 'fallito' : 'fatto',
      esito: testoEsito(voce) ?? 'finito',
    }
  }
  if (voce.isSostituita) {
    return { ...base, stato: 'interrotto', esito: 'interrotto (sostituito da un nuovo avvio)' }
  }

  return isPsNota
    ? { ...base, stato: 'interrotto', esito: 'interrotto (nessun processo vivo)' }
    : { ...base, stato: 'in_corso', esito: 'stato non verificabile (ps non riuscito)' }
}

/** Righe dai log, le piu recenti per prime; i lavori vivi li copre `righeProcessi`. */
function righeLog(input: InputSnapshot): RegiaRiga[] {
  const vivi = new Set((input.processi ?? []).map(p => p.nome))

  return input.log.flatMap(lettura =>
    lettura.voci
      .map((voce, indice) => rigaDaVoce(voce, indice, lettura, vivi, input))
      .filter((riga): riga is RegiaRiga => riga !== undefined)
      .reverse(),
  )
}

function nomiEquivalenti(voce: VoceRegistro): string[] {
  const dalWorktree = voce.worktree === undefined ? [] : [ultimoSegmento(voce.worktree)]

  return [voce.id, ...dalWorktree].map(n => n.toLowerCase())
}

function rigaRegistro(voce: VoceRegistro, home: string): RegiaRiga {
  const luogo = voce.worktree ?? voce.ramo

  return {
    chiave: `registro:${voce.id}`,
    nome: voce.titolo,
    fonte: 'registro',
    esecutore: voce.esecutore ?? '—',
    stato: voce.stato,
    modello: voce.modello,
    cartella: luogo === undefined ? undefined : accorciaPercorso(luogo, home),
    note: voce.note,
  }
}

function conTitoli(righe: readonly RegiaRiga[], registro: readonly VoceRegistro[]) {
  return righe.map(riga => {
    const voce = registro.find(
      v => v.stato === 'in_corso' && nomiEquivalenti(v).includes(riga.nome.toLowerCase()),
    )

    return voce === undefined ? riga : { ...riga, note: riga.note ?? voce.titolo }
  })
}

function righeRegistro(input: InputSnapshot, vive: readonly RegiaRiga[]) {
  const nomiVivi = new Set(vive.map(r => r.nome.toLowerCase()))
  const righe = (input.registro ?? [])
    .filter(v => !(v.stato === 'in_corso' && nomiEquivalenti(v).some(n => nomiVivi.has(n))))
    .map(v => rigaRegistro(v, input.home))
  const perData = (a: VoceRegistro, b: VoceRegistro) =>
    (Date.parse(b.aggiornato ?? '') || 0) - (Date.parse(a.aggiornato ?? '') || 0)
  const fatti = (input.registro ?? []).filter(v => v.stato === 'fatto').sort(perData)
  const ordine = new Map(fatti.map((v, i) => [`registro:${v.id}`, i]))

  return [...righe].sort((a, b) => (ordine.get(a.chiave) ?? 0) - (ordine.get(b.chiave) ?? 0))
}

/** I nomi gia ricordati piu quelli dei processi vivi lanciati da questa sessione. */
export function nomiAggiornati(
  ricordati: readonly string[],
  processi: readonly ProcessoCodex[] | undefined,
  pidMiei: ReadonlySet<number> | undefined,
): string[] {
  const nuovi = (processi ?? [])
    .filter(p => pidMiei?.has(p.pid) === true)
    .map(p => p.nome)

  return [...new Set([...ricordati, ...nuovi])].slice(-MASSIMO_NOMI_RICORDATI)
}

/** Restringe le fonti Codex ai soli lavori di questa sessione. */
function soloSessione(input: InputSnapshot): InputSnapshot {
  return {
    ...input,
    processi: input.processi?.filter(p => input.pidMiei?.has(p.pid) === true),
    // Il registro: le voci di questa sessione e quelle senza sessione, scritte a mano.
    registro: input.registro?.filter(v => v.sessione === undefined || v.sessione === input.sessioneId),
    log: input.log.map(l => ({
      ...l,
      voci: l.voci.filter(v => input.nomiSessione.has(v.nome)),
    })),
  }
}

function costruisciVista(
  input: InputSnapshot,
  agenti: readonly RegiaRiga[],
  fineAgente: (r: RegiaRiga) => number,
): RegiaVistaDati {
  const codexVivi = conTitoli(righeProcessi(input), input.registro ?? [])
  const registro = righeRegistro(input, [...agenti, ...codexVivi])
  const tutte = conLanci([...agenti, ...codexVivi, ...righeLog(input), ...registro], input.lanci ?? {})
  const perStato = (...stati: RegiaStato[]) => tutte.filter(r => stati.includes(r.stato))
  const concluso = perStato('fatto', 'fallito', 'interrotto')
  const daAgenti = concluso.filter(r => r.fonte === 'claude').sort((a, b) => fineAgente(b) - fineAgente(a))
  const fatti = [...daAgenti, ...concluso.filter(r => r.fonte !== 'claude')]
  const sciame = (input.attesaSciame ?? []).map((c): RegiaRiga => ({
    chiave: `sciame:${c.sciame}:${c.nome}`,
    nome: c.nome,
    fonte: 'registro',
    esecutore: c.esecutore,
    stato: c.isBloccato ? 'bloccato' : 'scaletta',
    note: `sciame ${c.sciame}`,
  }))
  const scaletta = [...sciame, ...perStato('scaletta', 'bloccato')]

  return {
    inCorso: perStato('in_corso'),
    scaletta: scaletta.slice(0, MASSIMO_SCALETTA),
    scalettaExtra: Math.max(0, scaletta.length - MASSIMO_SCALETTA),
    fatti: fatti.slice(0, MASSIMO_FATTI),
    fattiExtra: Math.max(0, fatti.length - MASSIMO_FATTI),
  }
}

export function costruisciSnapshot(input: InputSnapshot): RegiaSnapshot {
  const agentiLetti = input.agenti ?? []
  const tempiAgenti = aggiornaTempi(agentiLetti, input.tempiPrecedenti, input.oraMs, input.isPrimaLettura)
  const ricordi = input.ricordiAgenti ?? []
  const presenti = new Set(agentiLetti.map(a => a.id))
  const agenti = conInfoAgenti(
    [...righeAgenti(agentiLetti, tempiAgenti, input.oraMs), ...righeDaRicordi(ricordi, presenti)],
    input.infoAgenti ?? {},
  )
  const fineRicordata = new Map(ricordi.map(r => [r.id, r.fineMs]))
  const fineAgente = (r: RegiaRiga) => {
    const id = r.chiave.slice('claude:'.length)

    return tempiAgenti[id]?.fineMs ?? fineRicordata.get(id) ?? 0
  }

  return {
    aggiornatoMs: input.oraMs,
    viste: {
      sessione: costruisciVista(soloSessione(input), agenti, fineAgente),
      tutti: costruisciVista(input, agenti, fineAgente),
    },
    avvisi: [...input.avvisi],
    isRegistroPresente: input.isRegistroPresente,
    tempiAgenti,
    posta: {
      sessione: ultimiMessaggi(input.posta ?? [], MASSIMO_POSTA, input.sessioneId ?? '').map(perPane),
      tutti: ultimiMessaggi(input.posta ?? [], MASSIMO_POSTA).map(perPane),
    },
  }
}

function perPane(m: Messaggio): RegiaMessaggio {
  return { id: m.id, da: m.da, a: m.a, testo: m.testo, ora: m.ora, stato: m.stato }
}

export type Conteggi = { codex: number; claude: number; altri: number; scaletta: number }

export function contaVista(vista: RegiaVistaDati): Conteggi {
  const per = (fonte: RegiaRiga['fonte']) =>
    vista.inCorso.filter(r => r.fonte === fonte).length

  return {
    codex: per('codex'),
    claude: per('claude'),
    altri: per('registro'),
    scaletta: vista.scaletta.length + vista.scalettaExtra,
  }
}

/**
 * Status line, sempre sulla sessione: `● 3 codex · 2 claude · 4 da fare`.
 * Il motore la scrive gia dopo il nome della mod, quindi niente prefisso;
 * `undefined` (nessuna riga) quando non c'e nulla da dire.
 */
export function testoStato(snapshot: RegiaSnapshot): string | undefined {
  if (snapshot.aggiornatoMs === 0) return undefined
  const c = contaVista(snapshot.viste.sessione)
  const parti = [
    c.codex > 0 ? `${c.codex} codex` : undefined,
    c.claude > 0 ? `${c.claude} claude` : undefined,
    c.altri > 0 ? `${c.altri} altri` : undefined,
    c.scaletta > 0 ? `${c.scaletta} da fare` : undefined,
  ].filter((p): p is string => p !== undefined)

  return parti.length === 0 ? undefined : `● ${parti.join(' · ')}`
}

function rigaRiepilogo(r: RegiaRiga): string {
  const modello = r.modello === undefined ? '' : `, ${r.modello}${r.effort === undefined ? '' : ` ${r.effort}`}`
  const motivo = r.motivoModello === undefined ? '' : ` — ${r.motivoModello}`

  return `- ${r.nome} (${r.esecutore}${modello})${motivo}`
}

export function riepilogoTestuale(snapshot: RegiaSnapshot, vista: RegiaVista): string {
  if (snapshot.aggiornatoMs === 0) return 'Regia: prima lettura in corso, riprova tra un attimo.'
  const dati = snapshot.viste[vista]
  const c = contaVista(dati)
  const quale = vista === 'tutti' ? 'tutta la macchina' : 'questa sessione'
  const intestazione =
    `Regia (${quale}): ${dati.inCorso.length} in corso (${c.codex} codex, ${c.claude} claude, ${c.altri} altri), ` +
    `${c.scaletta} in scaletta, ${dati.fatti.length + dati.fattiExtra} fatti.`
  const righe = dati.inCorso.slice(0, 6).map(rigaRiepilogo)
  const avvisi = snapshot.avvisi.map(a => `Attenzione: ${a}`)
  const cambio = vista === 'tutti' ? '/regia per tornare a questa sessione' : '/regia tutti per vedere tutta la macchina'

  return [intestazione, ...righe, ...avvisi, cambio].join('\n')
}
