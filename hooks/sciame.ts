// Lo sciame, la parte pura: una lavagna di compiti con dipendenze, chi puo
// partire ora, che cosa succede quando uno finisce e il testo per ciascuno.

import type { Esecutore, GiaAssegnati, SceltaEsecutore } from './instradamento'

export const CHIAVE_SCIAMI = 'regia.sciami.'
export const MASSIMO_COMPITI = 40
export const MASSIMO_PARALLELO = 16
/** Chi fallisce riprova una volta, un gradino sopra. */
export const MASSIMO_TENTATIVI = 2
const RE_NOME = /^[a-z0-9][a-z0-9_-]{0,39}$/i

export type StatoCompito = 'attesa' | 'corsa' | 'fatto' | 'fallito' | 'bloccato' | 'annullato'

export type Compito = {
  nome: string
  prompt: string
  esecutore: Esecutore
  /** Chi ha scelto l'esecutore: `indicato`, `scelto dalla mod: ...`, `ripiego: ...`. Senza, il compito e ancora da assegnare. */
  motivoEsecutore?: string
  /** Tipo di agente Claude; se manca, `general-purpose`. */
  tipo?: string
  /** Vero se cambia dei file: lavora in un worktree suo. */
  scrive: boolean
  dopo: string[]
  stato: StatoCompito
  tentativi: number
  agenteId?: string
  lancioMs?: number
  /** Da quando l'agente si e fermato in attesa di un suo comando in background: il compito non e finito. */
  attesaMs?: number
  modello?: string
  sforzo?: string
  /** Il rapporto, accorciato; intero in `fileEsito`. */
  esito?: string
  fileEsito?: string
  cartella?: string
}

export type Sciame = {
  id: string
  obiettivo: string
  parallelo: number
  compiti: Compito[]
  creatoMs: number
  isAvvisato: boolean
}

type Grezzo = { nome?: unknown; prompt?: unknown; esecutore?: unknown; tipo?: unknown; scrive?: unknown; dopo?: unknown }

/** L'esecutore scritto nella chiamata: la mod non lo cambia. */
export const MOTIVO_INDICATO = 'indicato'

const ESECUTORI: readonly Esecutore[] = ['claude', 'codex', 'qwen', 'copilot']

/** Il nome con cui un compito gira ed e raggiungibile in posta. */
export const indirizzo = (s: Pick<Sciame, 'id'>, c: Pick<Compito, 'nome'>): string => `${s.id}-${c.nome}`

function leggiCompito(g: Grezzo): Compito | string {
  const nome = typeof g.nome === 'string' ? g.nome.trim() : ''
  if (!RE_NOME.test(nome)) return `nome di compito non valido: "${nome}" (lettere, cifre, - e _, al piu 40)`
  if (typeof g.prompt !== 'string' || g.prompt.trim() === '') return `il compito "${nome}" non ha un prompt`
  const isListaDopo = g.dopo === undefined || (Array.isArray(g.dopo) && g.dopo.every(d => typeof d === 'string'))
  if (!isListaDopo) return `"dopo" del compito "${nome}" deve essere una lista di nomi`
  // Senza esecutore il compito e di Claude finche la mod non sceglie (`conScelte`).
  const indicato = ESECUTORI.find(e => e === g.esecutore)

  return {
    nome,
    prompt: g.prompt,
    esecutore: indicato ?? 'claude',
    ...(indicato === undefined ? {} : { motivoEsecutore: MOTIVO_INDICATO }),
    ...(typeof g.tipo === 'string' && g.tipo.trim() !== '' ? { tipo: g.tipo.trim() } : {}),
    scrive: g.scrive === true,
    dopo: (g.dopo ?? []) as string[],
    stato: 'attesa',
    tentativi: 0,
  }
}

/** Un ciclo fra le dipendenze, se c'e: un compito che non partirebbe mai. */
function trovaCiclo(compiti: readonly Pick<Compito, 'nome' | 'dopo'>[]): string | undefined {
  const per = new Map(compiti.map(c => [c.nome, c.dopo]))
  const fatti = new Set<string>()
  let isAvanzato = true
  while (isAvanzato) {
    isAvanzato = false
    for (const c of compiti) {
      if (!fatti.has(c.nome) && (per.get(c.nome) ?? []).every(d => fatti.has(d))) {
        fatti.add(c.nome)
        isAvanzato = true
      }
    }
  }

  return compiti.find(c => !fatti.has(c.nome))?.nome
}

/** La lavagna con i compiti nuovi, o il motivo per cui non si puo. Tutto o niente. */
export function conCompiti(s: Sciame, grezzi: unknown): Sciame | string {
  if (!Array.isArray(grezzi) || grezzi.length === 0) return 'serve almeno un compito'
  const letti = grezzi.map(g => leggiCompito((g ?? {}) as Grezzo))
  const sbagliato = letti.find((c): c is string => typeof c === 'string')
  if (sbagliato !== undefined) return sbagliato
  const compiti = [...s.compiti, ...(letti as Compito[])]
  if (compiti.length > MASSIMO_COMPITI) return `troppi compiti: al massimo ${MASSIMO_COMPITI} per sciame`
  const nomi = compiti.map(c => c.nome)
  const doppio = nomi.find((n, i) => nomi.indexOf(n) !== i)
  if (doppio !== undefined) return `compito ripetuto: "${doppio}"`
  const ignoto = compiti.flatMap(c => c.dopo).find(d => !nomi.includes(d))
  if (ignoto !== undefined) return `dipendenza sconosciuta: "${ignoto}"`
  const ciclo = trovaCiclo(compiti)
  if (ciclo !== undefined) return `dipendenze circolari attorno a "${ciclo}"`

  return { ...s, compiti, isAvvisato: false }
}

/** Sciame nuovo, senza nulla in corsa. */
export function creaSciame(a: { id: string; obiettivo: unknown; compiti: unknown; parallelo: unknown; oraMs: number; predefinito: number }): Sciame | string {
  if (typeof a.obiettivo !== 'string' || a.obiettivo.trim() === '') return 'manca l\'obiettivo'
  const p = a.parallelo === undefined ? a.predefinito : a.parallelo
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > MASSIMO_PARALLELO) return `parallelo deve essere un intero da 1 a ${MASSIMO_PARALLELO}`

  return conCompiti({ id: a.id, obiettivo: a.obiettivo.trim(), parallelo: p, compiti: [], creatoMs: a.oraMs, isAvvisato: false }, a.compiti)
}

function cambia(s: Sciame, nome: string, f: (c: Compito) => Compito): Sciame {
  return { ...s, compiti: s.compiti.map(c => (c.nome === nome ? f(c) : c)) }
}

/** I compiti ancora da assegnare ricevono l'esecutore scelto; chi lo ha gia (indicato o deciso prima) resta com'e. */
export function conScelte(s: Sciame, scelte: ReadonlyMap<string, SceltaEsecutore>): Sciame {
  return { ...s, compiti: s.compiti.map((c): Compito => {
    const scelta = c.motivoEsecutore === undefined ? scelte.get(c.nome) : undefined

    return scelta === undefined ? c : { ...c, esecutore: scelta.esecutore, motivoEsecutore: scelta.motivo }
  }) }
}

/** Il primo compito che indica un esecutore esterno spento in config, se c'e. */
export function compitoConSpento(compiti: readonly Compito[], accesi: readonly string[]): Compito | undefined {
  return compiti.find(c => c.esecutore !== 'claude' && c.motivoEsecutore === MOTIVO_INDICATO && !accesi.includes(c.esecutore))
}

/** Vero se l'esecutore esterno lo ha scelto la mod: se poi manca, il compito puo tornare a Claude. */
export const isEsternoSceltoDallaMod = (c: Compito): boolean =>
  c.esecutore !== 'claude' && c.motivoEsecutore !== undefined && c.motivoEsecutore !== MOTIVO_INDICATO

/** Quanti compiti non conclusi ha gia ogni esecutore esterno: il ripiego da al meno carico. */
export function caricoEsterni(s: Sciame): Map<string, number> {
  const carico = new Map<string, number>()
  for (const c of s.compiti) {
    if (c.esecutore !== 'claude' && c.motivoEsecutore !== undefined && (c.stato === 'attesa' || c.stato === 'corsa')) carico.set(c.esecutore, (carico.get(c.esecutore) ?? 0) + 1)
  }

  return carico
}

/** Cio che lo sciame ha gia prima dei compiti nuovi: il carico degli esterni e quanti compiti la mod ha assegnato, a chiunque e agli esterni. Per la quota di `mista`. */
export function giaAssegnati(s: Sciame): GiaAssegnati {
  const dallaMod = s.compiti.filter(c => c.motivoEsecutore !== undefined && c.motivoEsecutore !== MOTIVO_INDICATO)

  return { carico: caricoEsterni(s), compiti: dallaMod.length, esterni: dallaMod.filter(c => c.esecutore !== 'claude').length }
}

/** Un compito che la mod aveva dato a una CLI che non c'e torna a Claude; un lancio andato a vuoto non conta come tentativo. */
export function conRipiegoClaude(s: Sciame, nome: string, motivo: string): Sciame {
  return cambia(s, nome, c => ({
    ...c,
    esecutore: 'claude',
    motivoEsecutore: motivo,
    stato: 'attesa',
    tentativi: Math.max(0, c.tentativi - (c.stato === 'corsa' ? 1 : 0)),
    modello: undefined,
    sforzo: undefined,
    lancioMs: undefined,
  }))
}

export const conLancio = (s: Sciame, nome: string, dati: Partial<Compito>): Sciame =>
  cambia(s, nome, c => ({ ...c, ...dati, stato: 'corsa', tentativi: c.tentativi + 1 }))

export const conDati = (s: Sciame, nome: string, dati: Partial<Compito>): Sciame =>
  cambia(s, nome, c => ({ ...c, ...dati }))

/** Chi fallisce torna in attesa finche ha tentativi; poi resta fallito e i suoi dipendenti si bloccano. */
export function conEsito(s: Sciame, nome: string, e: { isOk: boolean; esito: string; fileEsito?: string }): Sciame {
  return bloccaDipendenti(cambia(s, nome, c => {
    const dati = { esito: e.esito, ...(e.fileEsito === undefined ? {} : { fileEsito: e.fileEsito }) }
    if (e.isOk) return { ...c, ...dati, stato: 'fatto' }

    return { ...c, ...dati, stato: c.tentativi < MASSIMO_TENTATIVI ? 'attesa' : 'fallito' }
  }))
}

function bloccaDipendenti(s: Sciame): Sciame {
  const fermi = new Set(['fallito', 'bloccato', 'annullato'])
  let attuale = s
  let isCambiato = true
  while (isCambiato) {
    const senza = new Set(attuale.compiti.filter(c => fermi.has(c.stato)).map(c => c.nome))
    const prossimo = { ...attuale, compiti: attuale.compiti.map((c): Compito => (c.stato === 'attesa' && c.dopo.some(d => senza.has(d)) ? { ...c, stato: 'bloccato', esito: 'dipende da un compito non riuscito' } : c)) }
    isCambiato = prossimo.compiti.some((c, i) => c.stato !== attuale.compiti[i]?.stato)
    attuale = prossimo
  }

  return attuale
}

/** Un compito fermo in attesa di un comando che non ha ripreso: da controllare. Niente nuovo tentativo, i dipendenti si bloccano. */
export function conFermo(s: Sciame, nome: string, esito: string): Sciame {
  return bloccaDipendenti(cambia(s, nome, c => ({ ...c, esito, stato: 'fallito' })))
}

/** Chi aspetta non parte piu; chi corre finisce il suo. */
export function ferma(s: Sciame): Sciame {
  return { ...s, compiti: s.compiti.map((c): Compito => (c.stato === 'attesa' ? { ...c, stato: 'annullato' } : c)) }
}

/** I compiti da lanciare ora: dipendenze fatte, entro il parallelo. */
export function daLanciare(s: Sciame): Compito[] {
  const fatti = new Set(s.compiti.filter(c => c.stato === 'fatto').map(c => c.nome))
  const inCorsa = s.compiti.filter(c => c.stato === 'corsa').length
  const pronti = s.compiti.filter(c => c.stato === 'attesa' && c.dopo.every(d => fatti.has(d)))

  return pronti.slice(0, Math.max(0, s.parallelo - inCorsa))
}

export const isFinito = (s: Sciame): boolean => s.compiti.every(c => c.stato !== 'attesa' && c.stato !== 'corsa')

/** Un agente che chiude il turno con un suo comando ancora in corso puo essere dato per concluso. */
export const REGOLA_PRIMO_PIANO = 'Lancia i comandi lunghi in primo piano e non chiudere il turno finche non hai finito e committato: se chiudi con un comando ancora in corso il tuo compito puo essere considerato concluso.'

/** Il testo di un compito: il lavoro, lo sciame intorno e cio che hanno trovato i suoi predecessori. */
export function promptLavoratore(s: Sciame, c: Compito): string {
  const io = indirizzo(s, c)
  const compagni = s.compiti.filter(x => x.nome !== c.nome).map(x => `${indirizzo(s, x)} (${x.stato})`)
  const prima = c.dopo.flatMap(d => {
    const p = s.compiti.find(x => x.nome === d)

    return p === undefined ? [] : [`- ${p.nome}: ${p.esito ?? 'fatto'}${p.fileEsito === undefined ? '' : ` (per intero: ${p.fileEsito})`}`]
  })
  const nuovoGiro = c.tentativi > 0 ? [`Il tentativo precedente non e riuscito: ${c.esito ?? 'senza dettagli'}. Parti da li.`, ''] : []

  return [
    ...nuovoGiro,
    c.prompt.trimEnd(),
    '',
    ...(prima.length === 0 ? [] : ['Esiti dei compiti da cui dipendi:', ...prima, '']),
    `Lavori nello sciame ${s.id}, obiettivo: ${s.obiettivo}. Il tuo indirizzo e ${io}.`,
    ...(c.scrive ? [`Il tuo worktree e gia pronto: ${c.cartella ?? 'la cartella in cui parti'}, ramo sciame/${s.id}/${c.nome}. Lavora e fai commit solo li, non crearne altri e non toccare il ramo principale. Scrivi il nome del ramo nel rapporto.`] : []),
    ...(compagni.length === 0 ? [] : [`Compagni: ${compagni.join(', ')}. Se ti serve qualcosa da uno di loro chiediglielo invece di rifarlo.`]),
    REGOLA_PRIMO_PIANO,
    c.esecutore === 'claude'
      ? 'Tool della regia, da caricare con ToolSearch se servono: mcp__regia__posta_invia (a un compagno o a "principale"), mcp__regia__sciame_stato, mcp__regia__sciame_aggiungi (lavoro emerso che non e tuo).'
      : 'Per i compagni usa la CLI della posta descritta sotto.',
  ].join('\n')
}

const SEGNI: Readonly<Record<StatoCompito, string>> = { attesa: '○', corsa: '●', fatto: '✓', fallito: '✗', bloccato: '⊘', annullato: '■' }

function rigaCompito(c: Compito, massimo: number): string {
  const chi = c.motivoEsecutore === undefined ? c.esecutore : `${c.esecutore} · ${c.motivoEsecutore}`
  const dati = [chi, c.modello, c.sforzo, c.tentativi > 1 ? `tentativo ${c.tentativi}` : undefined].filter(Boolean).join(', ')
  const attesa = c.stato === 'corsa' && c.attesaMs !== undefined ? ', in attesa di un suo comando' : ''
  const esito = c.esito === undefined ? '' : `: ${c.esito.replace(/\s+/g, ' ').slice(0, massimo)}`
  const file = c.fileEsito === undefined ? '' : ` [${c.fileEsito}]`

  return `${SEGNI[c.stato]} ${c.nome} (${dati}${attesa})${esito}${file}`
}

/** Chi ha scelto l'esecutore, in una parola, per le righe strette del pane: `indicato`, `mod`, `ripiego`. */
export const chiHaScelto = (motivo: string): string => (motivo.startsWith('scelto dalla mod') ? 'mod' : motivo.split(':')[0]?.trim() ?? motivo)

/** La lavagna per il modello o per `/regia swarm`: poche righe. */
export function descrivi(s: Sciame, massimo = 160): string {
  const conta = (st: StatoCompito) => s.compiti.filter(c => c.stato === st).length

  return [
    `Sciame ${s.id} — ${s.obiettivo}: ${conta('fatto')} fatti, ${conta('corsa')} in corsa, ${conta('attesa')} in attesa, ${conta('fallito')} falliti, ${conta('bloccato')} bloccati.`,
    ...s.compiti.map(c => rigaCompito(c, massimo)),
  ].join('\n')
}

/** Il messaggio che sveglia la principale quando tutto e finito. */
export function avvisoFine(s: Sciame): string {
  return [
    descrivi(s, 500),
    '',
    'Lo sciame e finito. Controlla gli esiti (i rapporti interi sono nei file tra parentesi), fai unire i rami dei compiti riusciti da un delegato, che poi toglie i loro worktree in .worktrees/, e riferisci alla persona; decidi tu se rilanciare i falliti.',
  ].join('\n')
}
