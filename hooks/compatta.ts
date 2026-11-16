// La compattazione, la parte pura: le istruzioni per chi scrive il riassunto
// (che cosa tenere, e i fatti che la regia tiene fuori dalla conversazione),
// quando compattare, quando far riprendere la principale e che cosa dirle.

import type { RegiaDomanda } from '../types/index'
import { formattaToken } from './parsers'
import { NOME_PROFILO } from './profilo'
import type { Profilo } from './profilo'
import { SOGLIA_COMPATTA_MASSIMA, SOGLIA_COMPATTA_MINIMA, isSogliaCompatta } from './registro'
import type { ConfigRegia, VoceRegistro } from './registro'
import { descrivi } from './sciame'
import type { Sciame } from './sciame'

/** La prima riga delle istruzioni della regia: da li si riconosce che ci sono gia. */
export const INTESTAZIONE = '[regia · compattazione]'
/** Il tetto di tutto il testo della regia, in caratteri. */
export const MASSIMO_ISTRUZIONI = 6000
export const MASSIMO_VOCI = 40
export const MASSIMO_PIANO = 4000
const MASSIMO_DOMANDE = 900
const MASSIMO_SCIAMI = 1000
/** Intestazione del piano e riga delle voci lasciate fuori. */
const RISERVA_PIANO = 260
const MASSIMO_VOCI_RIPRESA = 12
/** Di quanti punti il contesto deve crescere prima di riprovare una compattazione che non e bastata. */
export const CRESCITA_MINIMA = 10

const COSA_TENERE: readonly string[] = [
  `${INTESTAZIONE} Istruzioni della mod Regia per il riassunto.`,
  'Tieni:',
  '- l\'obiettivo che la persona ha dato e ogni vincolo o preferenza che ha espresso, con le sue parole;',
  '- le decisioni gia prese e il perche;',
  '- che cosa e stato fatto e verificato (test, build, comandi, con l\'esito), distinto da cio che e solo affermato;',
  '- i file e i rami toccati, con i percorsi;',
  '- che cosa e in corso adesso e il passo subito successivo;',
  '- gli errori incontrati e come sono stati risolti;',
  '- cio che la persona sta aspettando.',
  'Lascia fuori le uscite degli strumenti riportate per intero e le esplorazioni che non hanno portato a nulla.',
]

const FATTI = 'Fatti che la regia tiene fuori dalla conversazione, letti adesso dai suoi archivi: sono lo stato attuale. Riportali nel riassunto cosi come sono, in un elenco a parte, anche dove la conversazione dice altro.'

/** Cio che la regia sa senza la conversazione. Una fonte che non si e potuta leggere manca, e la sua riga non si scrive. */
export type FattiRegia = {
  profilo: Profilo
  isVia: boolean
  /** Le voci del piano di questa sessione, nell'ordine del piano. */
  piano?: readonly VoceRegistro[]
  /** Le domande aperte per la persona. */
  domande?: readonly Pick<RegiaDomanda, 'id' | 'titolo' | 'opzioni'>[]
  /** Gli sciami di questa sessione in corsa o in attesa. */
  sciami?: readonly Sciame[]
  /** Gli esecutori esterni usabili adesso. */
  esecutori?: readonly string[]
}

function unaRiga(testo: string, massimo: number): string {
  const pulito = testo.replace(/\s+/g, ' ').trim()

  return pulito.length <= massimo ? pulito : `${pulito.slice(0, massimo - 1)}…`
}

const pesoRighe = (righe: readonly string[]): number => righe.reduce((n, r) => n + r.length + 1, 0)

function rigaVoce(v: VoceRegistro): string {
  const fase = v.fase === undefined || v.fase.trim() === '' ? '' : ` [${unaRiga(v.fase, 40)}]`
  const descrizione = v.descrizione === undefined || v.descrizione.trim() === '' ? '' : ` — ${unaRiga(v.descrizione, 160)}`
  const motivo = v.stato === 'bloccato' && v.note !== undefined && v.note.trim() !== '' ? ` (motivo: ${unaRiga(v.note, 120)})` : ''

  return `- ${unaRiga(v.id, 60)}${fase} ${v.stato}: ${unaRiga(v.titolo, 100)}${descrizione}${motivo}`
}

/**
 * Il piano entro i limiti: una riga per voce con fase, stato e descrizione. Se non ci sta tutto
 * escono prima le voci fatte (dalle piu vecchie), poi quelle in fondo, e si dice quante.
 */
export function righePiano(voci: readonly VoceRegistro[], massimoCaratteri = MASSIMO_PIANO, massimoVoci = MASSIMO_VOCI): string[] {
  if (voci.length === 0) return ['Piano: nessuna voce.']
  const isTroppo = (t: readonly { riga: string }[]) => t.length > massimoVoci || pesoRighe(t.map(x => x.riga)) > massimoCaratteri - RISERVA_PIANO
  let tenute = voci.map(voce => ({ voce, riga: rigaVoce(voce) }))
  while (isTroppo(tenute) && tenute.some(t => t.voce.stato === 'fatto')) {
    const prima = tenute.findIndex(t => t.voce.stato === 'fatto')
    tenute = tenute.filter((_, i) => i !== prima)
  }
  while (isTroppo(tenute) && tenute.length > 0) tenute = tenute.slice(0, -1)
  const fuori = voci.filter(v => !tenute.some(t => t.voce === v))
  const fatte = fuori.filter(v => v.stato === 'fatto').length

  return [
    `Piano (${voci.length} voci${fuori.length === 0 ? '' : `, ${tenute.length} elencate`}), nell'ordine in cui va fatto:`,
    ...tenute.map(t => t.riga),
    ...(fuori.length === 0 ? [] : [`(lasciate fuori ${fuori.length} voci: ${fatte} gia fatte, ${fuori.length - fatte} ancora aperte in fondo al piano; il piano intero e in ~/.claude/regia/registro.json)`]),
  ]
}

function rigaDomanda(d: Pick<RegiaDomanda, 'id' | 'titolo' | 'opzioni'>): string {
  const opzioni = d.opzioni.length === 0 ? 'risposta libera' : d.opzioni.map((o, i) => `${i + 1}) ${unaRiga(o, 80)}`).join('; ')

  return `- ${unaRiga(d.titolo, 160)} (id ${unaRiga(d.id, 40)}) — opzioni: ${opzioni}`
}

function righeDomande(domande: readonly Pick<RegiaDomanda, 'id' | 'titolo' | 'opzioni'>[]): string[] {
  if (domande.length === 0) return ['Domande aperte per la persona: nessuna.']
  const righe = domande.map(rigaDomanda)
  const tenute = righe.filter((_, i) => pesoRighe(righe.slice(0, i + 1)) <= MASSIMO_DOMANDE)

  return [
    `Domande aperte per la persona (${domande.length}), ancora senza risposta:`,
    ...tenute,
    ...(tenute.length === righe.length ? [] : [`(e altre ${righe.length - tenute.length}: sono nel pane della regia)`]),
  ]
}

function righeSciami(sciami: readonly Sciame[]): string[] {
  if (sciami.length === 0) return ['Sciami di questa sessione in corsa o in attesa: nessuno.']
  const lavagne = sciami.flatMap(s => descrivi(s, 60).split('\n').map(r => unaRiga(r, 160)))
  // Se le lavagne non ci stanno resta la riga dei conteggi di ogni sciame.
  const corte = sciami.map(s => unaRiga(descrivi(s).split('\n')[0] ?? s.id, 200))
  const isIntere = pesoRighe(lavagne) <= MASSIMO_SCIAMI

  return [
    `Sciami di questa sessione in corsa o in attesa (${sciami.length}); alla fine ognuno scrive alla principale${isIntere ? '' : ', la lavagna intera la da mcp__regia__sciame_stato'}:`,
    ...(isIntere ? lavagne : corte),
  ]
}

/** Il testo che la regia da a chi scrive il riassunto: che cosa tenere, poi i suoi fatti. Mai oltre `MASSIMO_ISTRUZIONI`. */
export function testoIstruzioni(f: FattiRegia): string {
  const modalita = `Modalita: ${NOME_PROFILO[f.profilo]}; la persona ${f.isVia ? 'e via (away): le domande le arrivano come notifica' : 'e qui (here)'}.`
  const domande = f.domande === undefined ? [] : righeDomande(f.domande)
  const sciami = f.sciami === undefined ? [] : righeSciami(f.sciami)
  const esecutori = f.esecutori === undefined ? [] : [`Esecutori esterni usabili: ${f.esecutori.length === 0 ? 'nessuno, lavora solo Claude' : f.esecutori.join(', ')}.`]
  const fissi = [...COSA_TENERE, '', FATTI, modalita, ...domande, ...sciami, ...esecutori]
  // Il piano prende cio che resta, fino al suo tetto.
  const piano = f.piano === undefined ? [] : righePiano(f.piano, Math.min(MASSIMO_PIANO, MASSIMO_ISTRUZIONI - pesoRighe(fissi)))
  const testo = [...COSA_TENERE, '', FATTI, modalita, ...piano, ...domande, ...sciami, ...esecutori].join('\n')

  return testo.length <= MASSIMO_ISTRUZIONI ? testo : `${testo.slice(0, MASSIMO_ISTRUZIONI - 1)}…`
}

/** Vero se nel testo ci sono gia le istruzioni della regia: la chiamata della mod le porta con se. */
export const haIstruzioniRegia = (istruzioni: string | undefined): boolean => istruzioni?.includes(INTESTAZIONE) === true

/** Le istruzioni della persona (cio che ha scritto dopo `/compact`) restano in testa; quelle della regia seguono. */
export function unisciIstruzioni(dellaPersona: string | undefined, dellaRegia: string): string {
  const sue = dellaPersona?.trim() ?? ''

  return sue === '' ? dellaRegia : `${sue}\n\n${dellaRegia}`
}

/** L'ultima compattazione fatta dalla mod in una sessione. */
export type UltimaCompatta = {
  oraMs: number
  /** La soglia superata a fine turno, o `/regia compact now`. */
  origine: 'soglia' | 'comando'
  /** Il riempimento del contesto prima, in percento. */
  primaPct?: number
  /**
   * Il riempimento piu basso misurato a fine turno da allora. Subito dopo una compattazione il motore
   * non lo sa (lo dice la risposta successiva) e `tokensAfter` conta solo la conversazione.
   */
  dopoPct?: number
  tokensPrima?: number
  tokensDopo?: number
}

/** Cio che la mod ricorda delle sue compattazioni, per sessione (`regia.compatta.<id>`). */
export type StatoCompatta = {
  ultima?: UltimaCompatta
  /** Il turno alla cui fine si e gia compattato (o provato). */
  turno?: string
  /** Detto una volta che la soglia non si raggiunge. */
  isAvvisato: boolean
  aggiornatoMs: number
}

export const STATO_COMPATTA_VUOTO: StatoCompatta = { isAvvisato: false, aggiornatoMs: 0 }

const numero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function statoCompattaDaStore(grezzo: unknown): StatoCompatta {
  if (typeof grezzo !== 'object' || grezzo === null) return STATO_COMPATTA_VUOTO
  const o = grezzo as Record<string, unknown>
  const u = typeof o.ultima === 'object' && o.ultima !== null ? o.ultima as Record<string, unknown> : undefined
  const oraMs = numero(u?.oraMs)
  const opzionali = Object.fromEntries((['primaPct', 'dopoPct', 'tokensPrima', 'tokensDopo'] as const).flatMap(k => (numero(u?.[k]) === undefined ? [] : [[k, numero(u?.[k])]])))

  return {
    ...(oraMs === undefined ? {} : { ultima: { oraMs, origine: u?.origine === 'comando' ? 'comando' as const : 'soglia' as const, ...opzionali } }),
    ...(typeof o.turno === 'string' ? { turno: o.turno } : {}),
    isAvvisato: o.isAvvisato === true,
    aggiornatoMs: numero(o.aggiornatoMs) ?? 0,
  }
}

export type AzioneCompatta = 'nulla' | 'compatta' | 'irraggiungibile'

/**
 * Che cosa fare alla fine di un turno della principale, e la memoria aggiornata. Puro.
 * Si compatta quando il contesto e alla soglia o oltre. Mai due volte alla fine dello stesso turno.
 * E non di nuovo se dopo l'ultima compattazione della mod il contesto e rimasto alla soglia o oltre
 * e da allora non e cresciuto di `CRESCITA_MINIMA` punti: lo riempie qualcosa che il riassunto non riduce.
 */
export function decidiCompatta(o: {
  isAccesa: boolean
  soglia: number
  /** Il riempimento del contesto, da 0 a 100; `undefined` finche il motore non lo sa (sessione nuova o appena compattata). */
  pieno: number | undefined
  /** Il turno appena finito. */
  turno: string
  stato: StatoCompatta
}): { azione: AzioneCompatta; stato: StatoCompatta } {
  const { ultima } = o.stato
  const misurata = ultima === undefined || o.pieno === undefined ? ultima : { ...ultima, dopoPct: Math.min(ultima.dopoPct ?? o.pieno, o.pieno) }
  const base: StatoCompatta = { ...o.stato, ...(misurata === undefined ? {} : { ultima: misurata }) }
  if (!o.isAccesa || o.pieno === undefined) return { azione: 'nulla', stato: base }
  if (o.pieno < o.soglia) return { azione: 'nulla', stato: { ...base, isAvvisato: false } }
  if (o.turno === base.turno) return { azione: 'nulla', stato: base }
  const dopo = misurata?.dopoPct
  if (dopo !== undefined && dopo >= o.soglia && o.pieno < dopo + CRESCITA_MINIMA) return { azione: 'irraggiungibile', stato: { ...base, isAvvisato: true } }

  return { azione: 'compatta', stato: { ...base, turno: o.turno, isAvvisato: false } }
}

/** La memoria dopo una compattazione riuscita: la misura del dopo arriva al turno seguente. */
export function conCompattazione(stato: StatoCompatta, ultima: UltimaCompatta): StatoCompatta {
  return { ...stato, ultima, isAvvisato: false }
}

/** Le voci su cui la principale puo lavorare. Una voce `bloccato` aspetta altro, spesso una risposta della persona. */
export const vociDaFare = <V extends Pick<VoceRegistro, 'stato'>>(piano: readonly V[]): V[] =>
  piano.filter(v => v.stato === 'scaletta' || v.stato === 'in_corso')

/**
 * Se dopo una compattazione fatta dalla mod la principale va fatta riprendere. Puro.
 * Solo in long, col piano che ha voci da fare: se restano solo voci bloccate (in attesa di una
 * risposta della persona) non c'e nulla da riprendere. E non mentre uno sciame o un agente lavora:
 * quando finisce scrive lui alla principale, e la ripresa sarebbe un doppione.
 */
export function decidiRipresa(o: { profilo: Profilo; piano: readonly Pick<VoceRegistro, 'stato'>[]; sciamiAttivi: number; agentiInCorso: number }): boolean {
  return o.profilo === 'long' && o.sciamiAttivi === 0 && o.agentiInCorso === 0 && vociDaFare(o.piano).length > 0
}

/** Il messaggio che fa riprendere la principale dopo una compattazione: corto, con il piano e le domande dagli archivi. */
export function testoRipresa(o: { piano: readonly VoceRegistro[]; domande: readonly Pick<RegiaDomanda, 'id' | 'titolo'>[] }): string {
  const daFare = vociDaFare(o.piano)
  const elencate = daFare.slice(0, MASSIMO_VOCI_RIPRESA)
  const bloccate = o.piano.filter(v => v.stato === 'bloccato')

  return [
    '[regia · ripresa] La regia ha compattato il contesto di questa conversazione: sopra hai il riassunto, non piu i messaggi.',
    `Voci del piano ancora da fare (${daFare.length}):`,
    ...elencate.map(v => `- ${unaRiga(v.id, 60)}${v.fase === undefined || v.fase.trim() === '' ? '' : ` [${unaRiga(v.fase, 40)}]`} ${v.stato}: ${unaRiga(v.titolo, 100)}`),
    ...(daFare.length > elencate.length ? [`- e altre ${daFare.length - elencate.length}`] : []),
    ...(bloccate.length === 0 ? [] : [`Voci bloccate, da lasciare ferme finche il motivo resta: ${unaRiga(bloccate.map(v => v.id).join(', '), 300)}.`]),
    ...(o.domande.length === 0 ? [] : [`Domande aperte per la persona, non ripeterle: ${unaRiga(o.domande.map(d => `${d.titolo} (${d.id})`).join('; '), 500)}.`]),
    'Riprendi dalla prima voce ancora da fare e vai avanti da sola col piano, senza chiedere il permesso. Per i dettagli (codice, percorsi, esiti) rileggi i file invece di fidarti del riassunto. Aggiorna il piano con scaletta_scrivi e segna `bloccato` con il motivo cio che non puoi fare.',
  ].join('\n')
}

/** L'avviso dopo una compattazione riuscita, in una riga. */
export function avvisoCompattato(primaPct: number | undefined, tokensDopo: number | undefined): string {
  const era = primaPct === undefined ? '' : `, era al ${primaPct}%`
  const ora = tokensDopo === undefined ? '' : `; la conversazione ora pesa circa ${formattaToken(tokensDopo)} token`

  return `regia: contesto compattato${era}${ora}`
}

export type ArgomentiCompatta =
  | { azione: 'mostra' | 'ora' | 'sbagliato' }
  | { azione: 'accendi'; valore: boolean }
  | { azione: 'soglia'; valore: number }

/** `compact`, `compact off`, `compact 70`, `compact now`; `undefined` se la prima parola non e questo comando. */
export function leggiArgomentiCompatta(args: string): ArgomentiCompatta | undefined {
  const [parola, valore, ...resto] = args.trim().toLowerCase().split(/\s+/)
  if (parola !== 'compact' && parola !== 'compatta') return undefined
  if (valore === undefined) return { azione: 'mostra' }
  if (resto.length > 0) return { azione: 'sbagliato' }
  if (valore === 'on' || valore === 'off') return { azione: 'accendi', valore: valore === 'on' }
  if (valore === 'now' || valore === 'ora') return { azione: 'ora' }
  const soglia = /^\d+%?$/.test(valore) ? Number.parseInt(valore, 10) : undefined

  return isSogliaCompatta(soglia) ? { azione: 'soglia', valore: soglia } : { azione: 'sbagliato' }
}

export const USO_COMPATTA = `regia: /regia compact mostra lo stato; /regia compact on|off accende o spegne; /regia compact <numero> mette la soglia, da ${SOGLIA_COMPATTA_MINIMA} a ${SOGLIA_COMPATTA_MASSIMA}; /regia compact now compatta adesso.`

/** Il contesto come lo da `$.session.usage()`: senza `percent` finche il motore non ha una risposta da cui misurarlo. */
export type Contesto = { percent?: number; tokens?: number; window?: number }

function rigaContesto(c: Contesto): string {
  if (c.percent === undefined) return 'non ancora misurato (sessione nuova o appena compattata: lo dice la prossima risposta)'
  const token = c.tokens === undefined || c.window === undefined ? '' : ` (${formattaToken(c.tokens)} di ${formattaToken(c.window)} token)`

  return `${c.percent}%${token}`
}

function rigaUltima(u: UltimaCompatta | undefined): string {
  if (u === undefined) return 'nessuna'

  return [
    `alle ${new Date(u.oraMs).toTimeString().slice(0, 5)} (${u.origine === 'comando' ? '/regia compact now' : 'soglia superata'})`,
    ...(u.primaPct === undefined ? [] : [`il contesto era al ${u.primaPct}%`]),
    ...(u.tokensDopo === undefined ? [] : [`la conversazione e scesa a circa ${formattaToken(u.tokensDopo)} token`]),
    u.dopoPct === undefined ? 'il riempimento dopo si misura alla prossima risposta' : `ai turni dopo il contesto e sceso fino al ${u.dopoPct}%`,
  ].join(', ')
}

/** Il testo di `/regia compact`. Puro. */
export function testoCompatta(o: { config: Pick<ConfigRegia, 'compatta' | 'compattaSoglia'>; contesto: Contesto; stato: StatoCompatta }): string {
  const { compatta, compattaSoglia } = o.config
  // Che cosa succederebbe alla prossima fine di turno, col contesto com'e adesso.
  const prossima = decidiCompatta({ isAccesa: compatta, soglia: compattaSoglia, pieno: o.contesto.percent, turno: '', stato: { ...o.stato, turno: undefined } })

  return [
    `Compattazione: ${compatta ? 'ACCESA' : 'SPENTA'}, soglia ${compattaSoglia}%.`,
    `Contesto adesso: ${rigaContesto(o.contesto)}.`,
    `Ultima compattazione della mod in questa sessione: ${rigaUltima(o.stato.ultima)}.`,
    ...(prossima.azione === 'compatta' ? ['Da compattare: il contesto e alla soglia o oltre. Il motore compatta solo fra un turno e l\'altro: parte alla prossima fine di turno.'] : []),
    ...(prossima.azione === 'irraggiungibile' ? [`La soglia non si raggiunge: dopo l'ultima compattazione il contesto e rimasto al ${prossima.stato.ultima?.dopoPct ?? '?'}%. La regia riprova solo se cresce di altri ${CRESCITA_MINIMA} punti: alza la soglia.`] : []),
    'A fine turno, col contesto alla soglia o oltre, la regia compatta la conversazione con le sue istruzioni: che cosa tenere, e piano, domande, sciami ed esecutori letti dai suoi archivi. Le stesse istruzioni si aggiungono a /compact e alla compattazione automatica del motore. Poi in long, col piano aperto, la principale riprende da sola; in medium e quick aspetta te.',
    `Si cambia con /regia compact on|off, /regia compact <soglia da ${SOGLIA_COMPATTA_MINIMA} a ${SOGLIA_COMPATTA_MASSIMA}>, /regia compact now ("compatta" e "compattaSoglia" in ~/.claude/regia/config.json).`,
  ].join('\n')
}

/** La riga di `/regia doctor`. */
export function rigaDoctorCompatta(c: Pick<ConfigRegia, 'compatta' | 'compattaSoglia'>, contesto: Contesto | undefined): string {
  const pieno = contesto === undefined ? 'contesto non leggibile' : contesto.percent === undefined ? 'contesto non ancora misurato' : `contesto ora al ${contesto.percent}%`

  return `Compattazione: ${c.compatta ? 'ACCESA' : 'SPENTA'}, soglia ${c.compattaSoglia}% — ${pieno} (/regia compact).`
}
