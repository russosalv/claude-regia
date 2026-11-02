// Modello e sforzo dei subagenti Claude, decisi compito per compito: puro.
// Nessuna tabella per tipo di agente: a ogni chiamata si guarda il compito vero.
// Cio che la chiamata, la definizione dell'agente o la config fissano resta com'e.

import { SFORZI, sforzoEuristico } from './codex'
import type { Sforzo } from './codex'

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
