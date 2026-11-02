// Dalle righe del cruscotto alle celle colorate e alle colonne delle tabelle.
// Puro: larghezza del pane e ora arrivano come argomenti, i colori sono nomi
// del tema (funzionano in chiaro e in scuro).

import type { RegiaRiga, RegiaStato } from '../types/index'
import {
  abbreviaModello,
  esitoBreve,
  formattaDurata,
  formattaToken,
  ultimoSegmento,
} from './parsers'
import { ACCENTO, cellWidth, fitColumns, scorrimento, spinner, tacche } from './tavola'
import type { Azione, Cella, Colonna, Pezzo, RigaTabella } from './tavola'

/** Colore del tema per l'esecutore Codex, distinto dall'arancio di Claude. */
export const COLORE_CODEX = 'permission'
const CELLE_MOTO = 4
const MIN_LAVORO = 14
/** `▸ apri ✉ scrivi`, `▸ log ↻ riprendi`. */
const MAX_TASTI = 16
const MAX_MODELLO = 14
const MAX_ULTIMA = 16
/** Fin dove l'ultima colonna si allarga quando il pane ha spazio in avanzo. */
const MAX_ULTIMA_LARGA = 32
const MAX_LAVORO = 40
/** Fin dove l'ultima colonna si stringe per lasciare spazio al nome del lavoro. */
const MIN_ULTIMA_CEDUTA = 12

/** Il simbolo di stato e il suo colore; chi è in corso gira col fotogramma. */
export function segnoStato(stato: RegiaStato, fotogramma: number, fonte?: RegiaRiga['fonte']): Pezzo {
  switch (stato) {
    case 'in_corso':
      return { testo: spinner(fotogramma), colore: ACCENTO }
    case 'scaletta':
      return { testo: '○', isAttenuato: true }
    case 'bloccato':
      return { testo: '⊘', colore: 'warning' }
    case 'fatto':
      return { testo: '✓', colore: 'success' }
    case 'fallito':
      return { testo: '✗', colore: 'error' }
    case 'interrotto':
      return { testo: '■', colore: 'warning' }
  }
}

function cellaEsecutore(riga: RegiaRiga): Cella {
  if (riga.esecutore.startsWith('claude')) return [{ testo: 'claude', colore: ACCENTO }]
  if (riga.esecutore === 'codex') return [{ testo: 'codex', colore: COLORE_CODEX }]

  return [{ testo: riga.esecutore, isAttenuato: true }]
}

function cellaModello(riga: RegiaRiga): Cella {
  if (riga.modello === undefined) return [{ testo: '—', isAttenuato: true }]
  const sforzo = riga.effort === undefined ? undefined : tacche(riga.effort)
  const nome = { testo: abbreviaModello(riga.modello) }
  if (sforzo !== undefined) return [nome, { testo: ' ' }, sforzo]

  return riga.effort === undefined ? [nome] : [nome, { testo: `·${riga.effort}`, isAttenuato: true }]
}

/** Durata viva al secondo per chi è in corso: `45s`, `21m04s`, `1h04m`. */
export function durataViva(secondi: number): string {
  const s = Math.max(0, Math.floor(secondi))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

function cellaDurata(riga: RegiaRiga, trascorsiSec: number): Cella {
  if (riga.durataSec === undefined) return [{ testo: '—', isAttenuato: true }]
  // Inizio sconosciuto: solo un minimo, detto come tale.
  if (riga.isDurataCerta !== true) return [{ testo: `≥${formattaDurata(riga.durataSec + trascorsiSec)}`, isAttenuato: true }]
  if (riga.stato === 'in_corso') return [{ testo: durataViva(riga.durataSec + trascorsiSec), isGrassetto: true }]

  return [{ testo: formattaDurata(riga.durataSec), isAttenuato: true }]
}

const COLORI_ESITO: Partial<Record<RegiaStato, string>> = {
  fatto: 'success',
  fallito: 'error',
  interrotto: 'warning',
}

/** Ultima colonna: dove gira chi è in corso, la nota in scaletta, l'esito dei fatti. */
function cellaUltima(riga: RegiaRiga): Cella {
  if (riga.stato === 'in_corso') {
    if (riga.fonte === 'claude') return cellaTipoAgente(riga)
    const dove = riga.cartella === undefined ? '' : ultimoSegmento(riga.cartella)

    return [{ testo: dove, isAttenuato: true }]
  }
  if (riga.stato === 'bloccato') return [{ testo: 'bloccato', colore: 'warning' }]
  if (riga.stato === 'scaletta') {
    const luogo = riga.cartella === undefined ? undefined : ultimoSegmento(riga.cartella)

    return [{ testo: luogo ?? riga.note ?? '', isAttenuato: true }]
  }
  const segno = riga.stato === 'fatto' ? '✓' : riga.stato === 'fallito' ? '✗' : '■'

  return [{ testo: `${segno} ${esitoBreve(riga.esito)}`, colore: COLORI_ESITO[riga.stato] }]
}

const NOTE_PROVENIENZA: Readonly<Record<NonNullable<RegiaRiga['provenienzaModello']>, string>> = {
  regia: 'scelto da regia',
  esplicito: 'esplicito',
  ereditato: 'ereditato',
}

/** Il tipo di un subagente in corso e, se nota, la ragione del suo modello. */
function cellaTipoAgente(riga: RegiaRiga): Cella {
  const tipo = { testo: riga.esecutore.replace(/^claude:/, ''), isAttenuato: true }
  if (riga.provenienzaModello === undefined) return [tipo]
  const motivo = riga.provenienzaModello === 'regia' && riga.motivoModello !== undefined
    ? riga.motivoModello
    : NOTE_PROVENIENZA[riga.provenienzaModello]

  return [tipo, { testo: ` · ${motivo}`, colore: riga.provenienzaModello === 'regia' ? ACCENTO : undefined, isAttenuato: true }]
}

function cellaToken(riga: RegiaRiga): Cella {
  return riga.token === undefined ? [] : [{ testo: formattaToken(riga.token), isAttenuato: true }]
}

export type Momento = {
  /** Fotogramma dell'animazione: un passo al secondo. */
  fotogramma: number
  /** Secondi passati dall'ultima lettura, da aggiungere a chi è in corso. */
  trascorsiSec: number
}

/** Cosa fanno i tasti di riga; senza, le righe non hanno tasti. */
export type Azioni = {
  apriAgente: (agenteId: string) => void
  apriLog: (nome: string, percorso: string) => void
  /** Apre il campo per scrivere a un agente in corso (indirizzo, nome da mostrare). */
  scrivi?: (indirizzo: string, etichetta: string) => void
  /** Apre il campo per riprendere un lavoro Codex finito. */
  riprendi?: (nome: string) => void
}

function azioneRiga(riga: RegiaRiga, azioni: Azioni | undefined): Azione | undefined {
  if (azioni === undefined) return undefined
  const { agenteId, fileLog } = riga
  if (riga.fonte === 'claude' && riga.stato === 'in_corso' && agenteId !== undefined) {
    return { chiave: `apri:${agenteId}`, etichetta: '▸ apri', onPress: () => azioni.apriAgente(agenteId) }
  }
  if (riga.fonte === 'codex' && fileLog !== undefined) {
    return { chiave: `log:${riga.chiave}`, etichetta: '▸ log', onPress: () => azioni.apriLog(riga.nome, fileLog) }
  }

  return undefined
}

/** I tasti oltre al principale: `✉ scrivi` per chi e in corso, `↻ riprendi` per un Codex finito. */
function altreAzioni(riga: RegiaRiga, azioni: Azioni | undefined): Azione[] {
  if (azioni === undefined || (riga.fonte !== 'claude' && riga.fonte !== 'codex')) return []
  const indirizzo = riga.fonte === 'claude' ? riga.agenteId : riga.nome
  const { scrivi, riprendi } = azioni
  if (riga.stato === 'in_corso' && indirizzo !== undefined && scrivi !== undefined) {
    return [{ chiave: `scrivi:${riga.chiave}`, etichetta: '✉ scrivi', onPress: () => scrivi(indirizzo, riga.nome) }]
  }
  const isConcluso = riga.stato === 'fatto' || riga.stato === 'fallito' || riga.stato === 'interrotto'
  if (riga.fonte === 'codex' && isConcluso && riga.fileLog !== undefined && riprendi !== undefined) {
    return [{ chiave: `riprendi:${riga.chiave}`, etichetta: '↻ riprendi', onPress: () => riprendi(riga.nome) }]
  }

  return []
}

export function rigaTabella(riga: RegiaRiga, momento: Momento, azioni?: Azioni): RigaTabella {
  const isProcessoVivo = riga.stato === 'in_corso'
  const azione = azioneRiga(riga, azioni)
  const altre = altreAzioni(riga, azioni)
  const tasti = [...(azione === undefined ? [] : [azione]), ...altre]

  return {
    chiave: riga.chiave,
    azione,
    altre,
    celle: {
      stato: [segnoStato(riga.stato, momento.fotogramma, riga.fonte)],
      lavoro: [{ testo: riga.nome, isAttenuato: riga.stato === 'scaletta' }],
      azione: tasti.length === 0 ? [] : [{ testo: tasti.map(t => t.etichetta).join(' '), colore: ACCENTO }],
      moto: isProcessoVivo ? scorrimento(momento.fotogramma, CELLE_MOTO) : [],
      esecutore: cellaEsecutore(riga),
      modello: cellaModello(riga),
      durata: cellaDurata(riga, momento.trascorsiSec),
      token: cellaToken(riga),
      ultima: cellaUltima(riga),
    },
  }
}

const larghezzaCella = (c: Cella | undefined) => (c ?? []).reduce((s, p) => s + cellWidth(p.testo), 0)

function piuLarga(righe: readonly RigaTabella[], id: string, minimo: number, tetto: number): number {
  const contenuto = Math.max(0, ...righe.map(r => larghezzaCella(r.celle[id])))

  return Math.max(minimo, Math.min(tetto, contenuto))
}

/**
 * Le colonne di tutte le tabelle del pane, uguali per ogni sezione così che
 * restino allineate; quando lo spazio manca cedono, nell'ordine, i token,
 * l'indicatore di attività, l'esecutore (il modello lo lascia capire), la
 * colonna dei tasti (allora e il Lavoro a fare da tasto), il modello e la
 * colonna Dove/Esito.
 */
export function colonnePane(righe: readonly RigaTabella[], spazio: number): Colonna[] {
  const conMoto = righe.some(r => larghezzaCella(r.celle.moto) > 0)
  const conAzioni = righe.some(r => r.azione !== undefined || (r.altre ?? []).length > 0)
  const conToken = righe.some(r => larghezzaCella(r.celle.token) > 0)
  const colonne: Colonna[] = [
    { id: 'stato', titolo: ' ', larghezza: 1 },
    { id: 'lavoro', titolo: 'Lavoro', larghezza: MIN_LAVORO, cresce: true },
    ...(conAzioni ? [{ id: 'azione', titolo: ' ', larghezza: piuLarga(righe, 'azione', 6, MAX_TASTI), priorita: 2 }] : []),
    ...(conMoto ? [{ id: 'moto', titolo: ' ', larghezza: CELLE_MOTO, priorita: 0 }] : []),
    { id: 'esecutore', titolo: 'Esec.', larghezza: piuLarga(righe, 'esecutore', 5, 9), priorita: 1 },
    { id: 'modello', titolo: 'Modello', larghezza: piuLarga(righe, 'modello', 7, MAX_MODELLO), priorita: 3 },
    { id: 'durata', titolo: 'Durata', larghezza: piuLarga(righe, 'durata', 6, 7), isADestra: true, priorita: 5 },
    ...(conToken ? [{ id: 'token', titolo: 'Token', larghezza: piuLarga(righe, 'token', 5, 6), isADestra: true, priorita: -1 }] : []),
    { id: 'ultima', titolo: 'Esito', larghezza: piuLarga(righe, 'ultima', 6, MAX_ULTIMA), priorita: 4 },
  ]

  return ridistribuisci(fitColumns(colonne, spazio), righe)
}

/**
 * Il Lavoro ha preso tutto l'avanzo: quello che supera il nome più lungo va
 * prima all'ultima colonna, finché non mostra intero il suo testo più lungo;
 * oltre il nome più lungo (più due celle) la tabella non si allarga e lascia il bianco.
 * Se invece il nome non ci sta, l'ultima colonna gli cede qualche cella.
 */
function ridistribuisci(colonne: Colonna[], righe: readonly RigaTabella[]): Colonna[] {
  const lavoro = colonne.find(c => c.id === 'lavoro')
  const ultima = colonne.find(c => c.id === 'ultima')
  if (lavoro === undefined || ultima === undefined) return colonne
  // `+2`: quando il Lavoro fa da tasto gli si antepone `▸ `.
  const conFreccia = righe.map(r => larghezzaCella(r.celle.lavoro) + (r.azione === undefined ? 0 : 2))
  const bisognoLavoro = Math.max(MIN_LAVORO, Math.min(MAX_LAVORO, Math.max(0, ...conFreccia)))
  const avanzo = Math.max(0, lavoro.larghezza - bisognoLavoro)
  const bisognoUltima = piuLarga(righe, 'ultima', ultima.larghezza, MAX_ULTIMA_LARGA)
  // Lavoro tagliato: l'ultima colonna gli cede fino a restare di MIN_ULTIMA_CEDUTA.
  const manca = Math.max(0, bisognoLavoro - lavoro.larghezza)
  const ceduto = Math.min(manca, Math.max(0, ultima.larghezza - MIN_ULTIMA_CEDUTA))
  const dato = Math.min(avanzo, Math.max(0, bisognoUltima - ultima.larghezza)) - ceduto

  return colonne.map(c => {
    if (c.id === 'lavoro') return { ...c, larghezza: Math.min(c.larghezza - dato, bisognoLavoro + 2) }
    if (c.id === 'ultima') return { ...c, larghezza: c.larghezza + dato }

    return c
  })
}

/** Le stesse colonne col titolo dell'ultima adatto alla sezione. */
export function conTitoloUltima(colonne: readonly Colonna[], titolo: string): Colonna[] {
  return colonne.map(c => (c.id === 'ultima' ? { ...c, titolo } : c))
}
