// Modello e sforzo dei subagenti Claude, decisi compito per compito: puro.
// Nessuna tabella per tipo di agente: a ogni chiamata si guarda il compito vero.
// Cio che la chiamata, la definizione dell'agente o la config fissano resta com'e.
// In fondo, allo stesso modo, l'esecutore dei compiti di uno sciame che non lo indicano,
// secondo la squadra impostata (`/regia team`): solo Claude, Claude con gli esterni entro una quota, o gli esterni.

import { SFORZI, sforzoEuristico } from './codex'
import type { EsecutoreCli, Sforzo } from './codex'
import type { Squadra } from './registro'

/** Chi ha deciso il modello di un subagente. */
export type Provenienza = 'regia' | 'esplicito' | 'ereditato'

export type SceltaModello = {
  /** Il modello da imporre; `undefined` lascia decidere al motore. */
  modello?: string
  /** Lo sforzo da imporre; `undefined` lascia decidere al motore. */
  sforzo?: string
  motivo: string
  provenienza: Provenienza
}

/** Una scelta gia fatta, oppure «chiedi alla classificazione» con cio che resta fisso. */
export type Decisione =
  | { tipo: 'scelta'; scelta: SceltaModello }
  | { tipo: 'classifica'; modelloFisso?: string; sforzoFisso?: string; isModelloLasciato: boolean }

export const MODELLI_VALIDI = ['haiku', 'sonnet', 'opus'] as const
export type ModelloBreve = (typeof MODELLI_VALIDI)[number]
export const RIPIEGO: ModelloBreve = 'sonnet'

/** Valori della config che vogliono dire «non toccare questo tipo». */
const LASCIA = new Set(['inherit', 'eredita', 'nessuno'])

/** Cio che una chiamata del tool Agent dice da se. */
export type ChiamataAgente = { tipo: string; model?: string; effort?: string }

/** Il modello che la config fissa per un tipo, anche senza prefisso del plugin. */
export function modelloDaConfig(tipo: string, modelli: Readonly<Record<string, string>>): string | undefined {
  const breve = tipo.includes(':') ? tipo.slice(tipo.lastIndexOf(':') + 1) : tipo

  return modelli[tipo] ?? modelli[breve]
}

/** Che fare di una chiamata. `definizione` e il frontmatter del file dell'agente, se ne ha uno. */
export function decidi(
  c: ChiamataAgente,
  opzioni: { instradamento: boolean; modelli: Readonly<Record<string, string>>; definizione?: { modello?: string; sforzo?: string } },
): Decisione {
  const scelta = (motivo: string, provenienza: Provenienza): Decisione => ({ tipo: 'scelta', scelta: { motivo, provenienza } })
  if (c.tipo === 'fork') return scelta('fork: eredita modello e sforzo della sessione', 'ereditato')
  const dati = [c.model, c.effort].filter(Boolean).join(', ')
  if (!opzioni.instradamento) return dati === '' ? scelta('scelta automatica spenta', 'ereditato') : scelta(`indicato nella chiamata (${dati})`, 'esplicito')
  const daConfig = modelloDaConfig(c.tipo, opzioni.modelli)
  const isModelloLasciato = daConfig !== undefined && LASCIA.has(daConfig)
  const modelloFisso = c.model || opzioni.definizione?.modello || (isModelloLasciato ? undefined : daConfig)
  const sforzoFisso = c.effort || opzioni.definizione?.sforzo
  if ((modelloFisso !== undefined || isModelloLasciato) && sforzoFisso !== undefined) {
    return scelta(`gia deciso (${[modelloFisso, sforzoFisso].filter(Boolean).join(', ')})`, 'esplicito')
  }

  return { tipo: 'classifica', modelloFisso, sforzoFisso, isModelloLasciato }
}

/** Il prompt per haiku: una riga di JSON, sul compito e nient'altro. */
export function promptClassifica(descrizione: string, prompt: string): string {
  return [
    'Scegli modello e sforzo per un subagente di programmazione, guardando SOLO questo compito. Spendi il minimo che basta a farlo bene.',
    'modello: haiku (cercare, leggere, elencare, riassumere, modifiche meccaniche); sonnet (scrivere o correggere codice, test, documentazione); opus (progettare, revisioni o audit difficili, guasti che nessuno capisce).',
    'sforzo: low (meccanico, poche righe, percorso ovvio); medium (sviluppo normale); high (molti file, ragionamento vero, costo alto se sbaglia).',
    'Rispondi SOLO con JSON su una riga: {"modello":"...","sforzo":"...","motivo":"al massimo 10 parole in italiano"}',
    '',
    `Descrizione: ${descrizione.slice(0, 200)}`,
    'Compito:',
    prompt.slice(0, 4000),
  ].join('\n')
}

export type Classificazione = { modello?: ModelloBreve; sforzo?: Sforzo; motivo?: string }

/** Cio che si legge della risposta: ogni campo sbagliato resta vuoto. */
export function leggiClassificazione(testo: string): Classificazione {
  const json = /\{[\s\S]*\}/.exec(testo)?.[0]
  let o: { modello?: unknown; sforzo?: unknown; motivo?: unknown } = {}
  try {
    o = (json === undefined ? {} : JSON.parse(json)) as typeof o
  } catch {
    // Si guarda il testo com'e, qui sotto.
  }
  const parola = /\b(haiku|sonnet|opus)\b/i.exec(testo)?.[1]?.toLowerCase()

  return {
    modello: MODELLI_VALIDI.find(m => m === o.modello) ?? MODELLI_VALIDI.find(m => m === parola),
    sforzo: SFORZI.find(s => s === o.sforzo) ?? SFORZI.find(s => new RegExp(`\\b${s}\\b`, 'i').test(testo)),
    motivo: typeof o.motivo === 'string' && o.motivo.trim() !== '' ? o.motivo.trim().slice(0, 100) : undefined,
  }
}

/** Dalla risposta di haiku (o dal suo fallimento) alla scelta, senza toccare cio che e fisso. */
export function sceltaClassificata(
  d: Extract<Decisione, { tipo: 'classifica' }>,
  prompt: string,
  risposta: { testo?: string; errore?: string },
): SceltaModello {
  const letta = risposta.testo === undefined ? {} : leggiClassificazione(risposta.testo)
  const isLetta = letta.modello !== undefined && letta.sforzo !== undefined
  const ripiego = sforzoEuristico(prompt)
  const perche = risposta.errore ?? 'risposta non riconosciuta'
  const modello = d.isModelloLasciato ? undefined : d.modelloFisso ?? letta.modello ?? RIPIEGO

  return {
    ...(modello === undefined ? {} : { modello }),
    sforzo: d.sforzoFisso ?? letta.sforzo ?? ripiego.sforzo,
    motivo: isLetta ? letta.motivo ?? 'dal compito' : `ripiego: ${ripiego.motivo} (haiku: ${perche})`,
    provenienza: 'regia',
  }
}

/** I campi `model:` ed `effort:` del frontmatter di un agente; `inherit` e vuoto non contano. */
export function definizioneDalFrontmatter(testo: string): { modello?: string; sforzo?: string } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(testo)?.[1] ?? ''
  const campo = (nome: string) => {
    const valore = new RegExp(`^${nome}:\\s*["']?([^"'\\s#]+)`, 'm').exec(fm)?.[1]

    return valore === undefined || LASCIA.has(valore.toLowerCase()) ? undefined : valore
  }

  return { modello: campo('model'), sforzo: campo('effort') }
}

const SCALA_SFORZO = ['low', 'medium', 'high', 'xhigh'] as const

/** Un gradino sopra: chi ha fallito riprova con piu testa, non con la stessa. */
export function gradinoSu(s: { modello?: string; sforzo?: string }): { modello: ModelloBreve; sforzo: string } {
  const m = (s.modello ?? '').toLowerCase()
  const modello: ModelloBreve = m.includes('opus') || m.includes('sonnet') ? 'opus' : m.includes('haiku') ? 'sonnet' : 'opus'
  const i = SCALA_SFORZO.findIndex(x => x === s.sforzo)

  return { modello, sforzo: i < 0 ? 'high' : (SCALA_SFORZO[Math.min(i + 1, SCALA_SFORZO.length - 1)] ?? 'high') }
}

/** Chi puo fare un compito di uno sciame: Claude o una CLI esterna. */
export type Esecutore = 'claude' | EsecutoreCli

/** Cio che di un compito serve per scegliere chi lo fa. */
export type CompitoDaAssegnare = { nome: string; prompt: string; scrive: boolean; tipo?: string }

export type SceltaEsecutore = { esecutore: Esecutore; motivo: string }

/** La squadra impostata: chi sviluppa e, in `mista`, la quota degli esterni in percento. */
export type RegolaSquadra = { squadra: Squadra; quota: number }

/** Cio che uno sciame ha gia quando gli si aggiungono compiti: il carico di ogni esterno e quanto la mod vi ha gia assegnato. */
export type GiaAssegnati = { carico: ReadonlyMap<string, number>; compiti: number; esterni: number }

export const NULLA_ASSEGNATO: GiaAssegnati = { carico: new Map(), compiti: 0, esterni: 0 }

/** Quanto del prompt di ogni compito vede haiku. */
export const CARATTERI_COMPITO = 600
/** Sotto questa lunghezza un prompt non si considera autosufficiente: nel ripiego resta a Claude. */
export const MINIMO_AUTOSUFFICIENTE = 200

export const MOTIVO_SQUADRA_CLAUDE = 'scelto dalla mod: squadra claude'
export const MOTIVO_DAL_COMPITO = 'scelto dalla mod: dal compito'
/** In `mista`: il compito era adatto a un esterno, ma i posti della quota erano finiti. */
export const MOTIVO_QUOTA = 'scelto dalla mod: quota esterni raggiunta'

/** I vincoli che decidono senza chiedere a nessuno; `undefined` se il compito resta da assegnare. */
export function vincoloEsecutore(c: Pick<CompitoDaAssegnare, 'tipo'>, usabili: readonly EsecutoreCli[], squadra: Squadra): SceltaEsecutore | undefined {
  if (squadra === 'claude') return { esecutore: 'claude', motivo: MOTIVO_SQUADRA_CLAUDE }
  if (c.tipo !== undefined) return { esecutore: 'claude', motivo: 'scelto dalla mod: tipo di agente Claude' }
  if (usabili.length === 0) return { esecutore: 'claude', motivo: 'scelto dalla mod: nessun esterno usabile' }

  return undefined
}

/**
 * In `mista`, quanti dei compiti che la mod assegna in uno sciame possono andare agli esterni:
 * la parte intera di n × quota / 100, ma almeno uno con due o piu compiti, quota sopra zero
 * e almeno un compito giudicato adatto a un esterno.
 */
export function tettoEsterni(n: number, quota: number, haAdatti: boolean): number {
  const tetto = Math.floor((n * quota) / 100)

  return tetto === 0 && n >= 2 && quota > 0 && haAdatti ? 1 : tetto
}

/**
 * I posti che restano agli esterni per i compiti nuovi. In `mista` il tetto si calcola su tutti i compiti
 * dello sciame assegnati dalla mod, quelli di prima e i `nuovi`, e si toglie chi e gia di un esterno;
 * `esterni` non ha tetto, `claude` non ha posti.
 */
export function postiEsterni(nuovi: number, s: RegolaSquadra, gia: GiaAssegnati, haAdatti: boolean): number {
  if (s.squadra !== 'mista') return s.squadra === 'claude' ? 0 : Number.POSITIVE_INFINITY

  return Math.max(0, tettoEsterni(gia.compiti + nuovi, s.quota, haAdatti) - gia.esterni)
}

/** Quanto dell'inizio di un prompt guarda il ripiego: e li che un compito dice che lavoro e. */
export const CARATTERI_INIZIO = 240
// Senza modello si guardano poche parole ovvie, in italiano e in inglese: documentazione, test, revisione, lavoro meccanico.
const RE_ADATTO = /\b(document\w*|docs?|readme|changelog|docstrings?|tests?|testing|testare|coverage|copertura|revision\w*|rivedi\w*|review\w*|audit\w*|rinomin\w*|renam\w*|formatt\w*|reformat\w*|lint\w*|refus[oi]|typos?|sostitui\w*|replac\w*|meccanic\w*|mechanical\w*|in blocco|bulk|traduc\w*|translat\w*|riassum\w*|summar\w*)\b/i
const RE_SECONDO = /\b(second[ao] (implementazione|parere|opinione)|second (implementation|opinion))\b/i
// Una parola di sviluppo nello stesso inizio vince: "implementa X e scrivi i test" e sviluppo.
const RE_SVILUPPO = /\b(implement\w*|svilupp\w*|develop\w*|progetta\w*|design\w*|refactor\w*|rifattorizz\w*|features?|funzionalit\w*)\b/i

/** Vero se l'inizio del prompt parla di documentazione, test, revisione, lavoro meccanico o di un secondo parere, e non di sviluppo. */
export function sembraLavoroPerEsterni(prompt: string): boolean {
  const inizio = prompt.trim().slice(0, CARATTERI_INIZIO)

  return RE_SECONDO.test(inizio) || (RE_ADATTO.test(inizio) && !RE_SVILUPPO.test(inizio))
}

/** Nel ripiego di `mista` va a un esterno solo chi sembra adatto: un compito che legge soltanto, o uno il cui prompt lo dice. */
export const isAdattoAEsterno = (c: Pick<CompitoDaAssegnare, 'prompt' | 'scrive'>): boolean => !c.scrive || sembraLavoroPerEsterni(c.prompt)

const A_CHE_SERVE: Readonly<Record<Esecutore, string>> = {
  claude: 'servono i tool, i server MCP, le skill o i tipi di agente di questa sessione; ricerche brevi; lavoro legato a cio che si e detto nella conversazione.',
  codex: 'implementazione autonoma di un compito ben specificato, debug, revisione del codice, audit.',
  qwen: 'modifiche meccaniche o in blocco, leggere e riassumere molto codice, documentazione, test; il piu economico.',
  copilot: 'implementazione autonoma di un compito ben specificato; un\'altra famiglia di modelli per una seconda implementazione o un secondo parere.',
}

/** In `mista` gli esterni ricevono solo questo. */
const CHE_COSA_RICEVE: Readonly<Record<EsecutoreCli, string>> = {
  codex: 'revisione indipendente, audit, debug, un\'implementazione isolata e ben specificata.',
  qwen: 'modifiche meccaniche o in blocco, leggere e riassumere molto codice, documentazione, test; il piu economico.',
  copilot: 'una seconda implementazione o un secondo parere da un\'altra famiglia di modelli, un\'implementazione isolata e ben specificata.',
}

/** Per quale squadra si scrive il prompt: con `claude` non si chiede nulla. `tetto`: quanti dei compiti chiesti possono andare agli esterni. */
export type SquadraDelPrompt = { squadra: 'esterni' } | { squadra: 'mista'; tetto: number }

/** Il prompt per haiku: tutti i compiti da assegnare in una volta, una riga di JSON in risposta. */
export function promptEsecutori(compiti: readonly CompitoDaAssegnare[], usabili: readonly EsecutoreCli[], s: SquadraDelPrompt): string {
  const esecutori: readonly Esecutore[] = ['claude', ...usabili]
  const tetto = s.squadra === 'mista' ? Math.min(s.tetto, compiti.length) : 0
  const regole = s.squadra === 'mista'
    ? [
        'claude e la squadra di sviluppo principale: tiene lo sviluppo che chiede di capire il progetto (funzionalita che toccano piu moduli, progettazione, cio che dipende dalla conversazione o dai tool, dai server MCP, dalle skill e dai tipi di agente di questa sessione). Nel dubbio, claude.',
        'Gli esecutori esterni ricevono solo cio che gli si addice:',
        ...usabili.map(e => `- ${e}: ${CHE_COSA_RICEVE[e]}`),
        `Al massimo ${tetto === 1 ? '1 compito' : `${tetto} compiti`} su ${compiti.length} agli esecutori esterni.`,
      ]
    : [
        'Esecutori:',
        ...esecutori.map(e => `- ${e}: ${A_CHE_SERVE[e]}`),
        'Distribuisci il lavoro: non dare tutto a claude quando un esecutore esterno puo farlo. I compiti autosufficienti vanno a un esecutore esterno.',
      ]

  return [
    'Assegna ogni compito di uno sciame di agenti di programmazione a un esecutore, guardando SOLO i compiti qui sotto.',
    ...regole,
    `Rispondi SOLO con JSON su una riga, una voce per compito: {"<nome del compito>":"<${esecutori.join('|')}>"}`,
    '',
    ...compiti.flatMap(c => [`Compito "${c.nome}" (${c.scrive ? 'scrive file' : 'legge soltanto'}):`, c.prompt.trim().slice(0, CARATTERI_COMPITO), '']),
  ].join('\n').trimEnd()
}

/** Cio che si legge della risposta: solo i compiti chiesti e solo claude o un esecutore usabile; il resto si ignora. */
export function leggiEsecutori(testo: string, nomi: readonly string[], usabili: readonly EsecutoreCli[]): Map<string, Esecutore> {
  const json = /\{[\s\S]*\}/.exec(testo)?.[0]
  let o: unknown
  try {
    o = json === undefined ? undefined : JSON.parse(json)
  } catch {
    o = undefined
  }
  const ammessi: readonly Esecutore[] = ['claude', ...usabili]
  const letti = new Map<string, Esecutore>()
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return letti
  for (const [nome, valore] of Object.entries(o)) {
    const esecutore = typeof valore === 'string' ? ammessi.find(e => e === valore.trim().toLowerCase()) : undefined
    if (nomi.includes(nome) && esecutore !== undefined) letti.set(nome, esecutore)
  }

  return letti
}

const ORDINE_SCRIVE: readonly EsecutoreCli[] = ['codex', 'copilot', 'qwen']
const ORDINE_LEGGE: readonly EsecutoreCli[] = ['qwen', 'codex', 'copilot']

/** L'esterno usabile con meno compiti; a pari carico il primo dell'ordine che conviene a chi scrive o a chi legge. */
function menoCarico(scrive: boolean, usabili: readonly EsecutoreCli[], conta: ReadonlyMap<string, number>): EsecutoreCli | undefined {
  const ordine = (scrive ? ORDINE_SCRIVE : ORDINE_LEGGE).filter(e => usabili.includes(e))
  const primo = ordine[0]

  // `reduce` tiene il primo fra i pari: l'ordine di preferenza rompe la parita.
  return primo === undefined ? undefined : ordine.reduce((meno, e) => ((conta.get(e) ?? 0) < (conta.get(meno) ?? 0) ? e : meno), primo)
}

/**
 * Ripiego senza modello: i compiti autosufficienti (prompt lungo) a rotazione sugli esterni usabili,
 * ogni volta al meno carico e, a pari carico, al primo dell'ordine che conviene a chi scrive o a chi legge.
 * I compiti brevi restano a Claude. `carico`: quanti compiti ha gia ciascuno.
 */
export function ripiegoEsecutori(
  compiti: readonly CompitoDaAssegnare[],
  usabili: readonly EsecutoreCli[],
  carico: ReadonlyMap<string, number> = new Map(),
): Map<string, SceltaEsecutore> {
  const conta = new Map(carico)
  const scelte = new Map<string, SceltaEsecutore>()
  for (const c of compiti) {
    const scelto = menoCarico(c.scrive, usabili, conta)
    if (scelto === undefined || c.prompt.trim().length < MINIMO_AUTOSUFFICIENTE) {
      scelte.set(c.nome, { esecutore: 'claude', motivo: `ripiego: ${scelto === undefined ? 'nessun esterno usabile' : 'compito breve'}` })
      continue
    }
    conta.set(scelto, (conta.get(scelto) ?? 0) + 1)
    scelte.set(c.nome, { esecutore: scelto, motivo: 'ripiego: a rotazione' })
  }

  return scelte
}

/** Un compito che haiku, o il ripiego, darebbe a un esterno. `proposto`: l'esecutore detto da haiku; senza, lo decide il carico. */
type Candidato = { compito: CompitoDaAssegnare; proposto?: EsecutoreCli }

/** Chi resta agli esterni quando i candidati superano il tetto: prima chi legge soltanto, poi cio che haiku ha dato a qwen (lavoro in blocco, documentazione, test), poi l'ordine della chiamata. */
const preferenza = (x: Candidato): number => (!x.compito.scrive ? 0 : x.proposto === 'qwen' ? 1 : 2)

/**
 * `mista`: Claude tiene tutto tranne i candidati che stanno nei `posti`. I candidati sono i compiti che haiku ha dato
 * a un esterno e, fra quelli che haiku non ha deciso, i soli che sembrano adatti (`isAdattoAEsterno`), sparsi al meno carico.
 */
function assegnaMista(
  liberi: readonly CompitoDaAssegnare[],
  usabili: readonly EsecutoreCli[],
  letti: ReadonlyMap<string, Esecutore>,
  posti: (haAdatti: boolean) => number,
  carico: ReadonlyMap<string, number>,
): Map<string, SceltaEsecutore> {
  const scelte = new Map<string, SceltaEsecutore>()
  const candidati: Candidato[] = []
  for (const c of liberi) {
    const letto = letti.get(c.nome)
    if (letto === 'claude') scelte.set(c.nome, { esecutore: 'claude', motivo: MOTIVO_DAL_COMPITO })
    else if (letto !== undefined) candidati.push({ compito: c, proposto: letto })
    else if (c.prompt.trim().length < MINIMO_AUTOSUFFICIENTE) scelte.set(c.nome, { esecutore: 'claude', motivo: 'ripiego: compito breve' })
    else if (isAdattoAEsterno(c)) candidati.push({ compito: c })
    else scelte.set(c.nome, { esecutore: 'claude', motivo: 'ripiego: sviluppo, resta a Claude' })
  }
  // `sort` e stabile: a pari preferenza resta l'ordine della chiamata.
  const tenuti = new Set([...candidati].sort((a, b) => preferenza(a) - preferenza(b)).slice(0, posti(candidati.length > 0)).map(x => x.compito.nome))
  const conta = new Map(carico)
  // Prima chi ha l'esecutore da haiku: il ripiego conta anche loro.
  for (const { compito, proposto } of candidati) {
    if (proposto === undefined) continue
    if (tenuti.has(compito.nome)) conta.set(proposto, (conta.get(proposto) ?? 0) + 1)
    scelte.set(compito.nome, tenuti.has(compito.nome) ? { esecutore: proposto, motivo: MOTIVO_DAL_COMPITO } : { esecutore: 'claude', motivo: MOTIVO_QUOTA })
  }
  for (const { compito, proposto } of candidati) {
    if (proposto !== undefined) continue
    const scelto = tenuti.has(compito.nome) ? menoCarico(compito.scrive, usabili, conta) : undefined
    if (scelto !== undefined) conta.set(scelto, (conta.get(scelto) ?? 0) + 1)
    scelte.set(compito.nome, scelto === undefined ? { esecutore: 'claude', motivo: 'ripiego: quota esterni raggiunta' } : { esecutore: scelto, motivo: 'ripiego: lavoro adatto a un esterno' })
  }

  return scelte
}

/** I compiti che nessun vincolo decide: quelli da chiedere ad haiku. In `mista`, nessuno se la quota non lascia posti. */
export function daChiedere<C extends CompitoDaAssegnare>(
  compiti: readonly C[],
  usabili: readonly EsecutoreCli[],
  squadra: RegolaSquadra,
  gia: GiaAssegnati = NULLA_ASSEGNATO,
): C[] {
  if (postiEsterni(compiti.length, squadra, gia, true) === 0) return []

  return compiti.filter(c => vincoloEsecutore(c, usabili, squadra.squadra) === undefined)
}

/**
 * L'esecutore di ogni compito che non lo indica: prima i vincoli, poi la risposta di haiku
 * (`undefined` se non ha risposto o non c'era nulla da chiedere), poi il ripiego per chi resta.
 * In `mista`, dopo haiku e dopo il ripiego, agli esterni resta al piu il tetto della quota.
 */
export function assegnaEsecutori(
  compiti: readonly CompitoDaAssegnare[],
  usabili: readonly EsecutoreCli[],
  risposta: string | undefined,
  squadra: RegolaSquadra,
  gia: GiaAssegnati = NULLA_ASSEGNATO,
): Map<string, SceltaEsecutore> {
  const scelte = new Map<string, SceltaEsecutore>()
  for (const c of compiti) {
    const vincolo = vincoloEsecutore(c, usabili, squadra.squadra)
    if (vincolo !== undefined) scelte.set(c.nome, vincolo)
  }
  const liberi = compiti.filter(c => !scelte.has(c.nome))
  const posti = (haAdatti: boolean) => postiEsterni(compiti.length, squadra, gia, haAdatti)
  if (posti(true) === 0) {
    for (const c of liberi) scelte.set(c.nome, { esecutore: 'claude', motivo: MOTIVO_QUOTA })

    return scelte
  }
  const letti = risposta === undefined ? new Map<string, Esecutore>() : leggiEsecutori(risposta, liberi.map(c => c.nome), usabili)
  if (squadra.squadra === 'mista') {
    for (const [nome, scelta] of assegnaMista(liberi, usabili, letti, posti, gia.carico)) scelte.set(nome, scelta)

    return scelte
  }
  const conta = new Map(gia.carico)
  for (const [nome, esecutore] of letti) {
    scelte.set(nome, { esecutore, motivo: MOTIVO_DAL_COMPITO })
    if (esecutore !== 'claude') conta.set(esecutore, (conta.get(esecutore) ?? 0) + 1)
  }
  const rimasti = liberi.filter(c => !letti.has(c.nome))
  for (const [nome, scelta] of ripiegoEsecutori(rimasti, usabili, conta)) scelte.set(nome, scelta)

  return scelte
}
