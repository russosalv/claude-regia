// Modello e sforzo dei subagenti Claude, decisi compito per compito: puro.
// Nessuna tabella per tipo di agente: a ogni chiamata si guarda il compito vero.
// Cio che la chiamata, la definizione dell'agente o la config fissano resta com'e.
// In fondo, allo stesso modo, l'esecutore dei compiti di uno sciame che non lo indicano.

import { SFORZI, sforzoEuristico } from './codex'
import type { EsecutoreCli, Sforzo } from './codex'

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

/** Quanto del prompt di ogni compito vede haiku. */
export const CARATTERI_COMPITO = 600
/** Sotto questa lunghezza un prompt non si considera autosufficiente: nel ripiego resta a Claude. */
export const MINIMO_AUTOSUFFICIENTE = 200

/** I vincoli che decidono senza chiedere a nessuno; `undefined` se il compito resta da assegnare. */
export function vincoloEsecutore(c: Pick<CompitoDaAssegnare, 'tipo'>, usabili: readonly EsecutoreCli[]): SceltaEsecutore | undefined {
  if (c.tipo !== undefined) return { esecutore: 'claude', motivo: 'scelto dalla mod: tipo di agente Claude' }
  if (usabili.length === 0) return { esecutore: 'claude', motivo: 'scelto dalla mod: nessun esterno usabile' }

  return undefined
}

const A_CHE_SERVE: Readonly<Record<Esecutore, string>> = {
  claude: 'servono i tool, i server MCP, le skill o i tipi di agente di questa sessione; ricerche brevi; lavoro legato a cio che si e detto nella conversazione.',
  codex: 'implementazione autonoma di un compito ben specificato, debug, revisione del codice, audit.',
  qwen: 'modifiche meccaniche o in blocco, leggere e riassumere molto codice, documentazione, test; il piu economico.',
  copilot: 'implementazione autonoma di un compito ben specificato; un\'altra famiglia di modelli per una seconda implementazione o un secondo parere.',
}

/** Il prompt per haiku: tutti i compiti da assegnare in una volta, una riga di JSON in risposta. */
export function promptEsecutori(compiti: readonly CompitoDaAssegnare[], usabili: readonly EsecutoreCli[]): string {
  const esecutori: readonly Esecutore[] = ['claude', ...usabili]

  return [
    'Assegna ogni compito di uno sciame di agenti di programmazione a un esecutore, guardando SOLO i compiti qui sotto.',
    'Esecutori:',
    ...esecutori.map(e => `- ${e}: ${A_CHE_SERVE[e]}`),
    'Distribuisci il lavoro: non dare tutto a claude quando un esecutore esterno puo farlo. I compiti autosufficienti vanno a un esecutore esterno.',
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
    const ordine = (c.scrive ? ORDINE_SCRIVE : ORDINE_LEGGE).filter(e => usabili.includes(e))
    const primo = ordine[0]
    if (primo === undefined || c.prompt.trim().length < MINIMO_AUTOSUFFICIENTE) {
      scelte.set(c.nome, { esecutore: 'claude', motivo: `ripiego: ${primo === undefined ? 'nessun esterno usabile' : 'compito breve'}` })
      continue
    }
    // `reduce` tiene il primo fra i pari: l'ordine di preferenza rompe la parita.
    const scelto = ordine.reduce((meno, e) => ((conta.get(e) ?? 0) < (conta.get(meno) ?? 0) ? e : meno), primo)
    conta.set(scelto, (conta.get(scelto) ?? 0) + 1)
    scelte.set(c.nome, { esecutore: scelto, motivo: 'ripiego: a rotazione' })
  }

  return scelte
}

/** I compiti che nessun vincolo decide: quelli da chiedere ad haiku. */
export function daChiedere<C extends CompitoDaAssegnare>(compiti: readonly C[], usabili: readonly EsecutoreCli[]): C[] {
  return compiti.filter(c => vincoloEsecutore(c, usabili) === undefined)
}

/**
 * L'esecutore di ogni compito che non lo indica: prima i vincoli, poi la risposta di haiku
 * (`undefined` se non ha risposto o non c'era nulla da chiedere), poi il ripiego per chi resta.
 */
export function assegnaEsecutori(
  compiti: readonly CompitoDaAssegnare[],
  usabili: readonly EsecutoreCli[],
  risposta: string | undefined,
  carico: ReadonlyMap<string, number> = new Map(),
): Map<string, SceltaEsecutore> {
  const scelte = new Map<string, SceltaEsecutore>()
  for (const c of compiti) {
    const vincolo = vincoloEsecutore(c, usabili)
    if (vincolo !== undefined) scelte.set(c.nome, vincolo)
  }
  const liberi = compiti.filter(c => !scelte.has(c.nome))
  const letti = risposta === undefined ? new Map<string, Esecutore>() : leggiEsecutori(risposta, liberi.map(c => c.nome), usabili)
  const conta = new Map(carico)
  for (const [nome, esecutore] of letti) {
    scelte.set(nome, { esecutore, motivo: 'scelto dalla mod: dal compito' })
    if (esecutore !== 'claude') conta.set(esecutore, (conta.get(esecutore) ?? 0) + 1)
  }
  const rimasti = liberi.filter(c => !letti.has(c.nome))
  for (const [nome, scelta] of ripiegoEsecutori(rimasti, usabili, conta)) scelte.set(nome, scelta)

  return scelte
}
