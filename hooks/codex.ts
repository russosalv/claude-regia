// `codex_avvia`, la parte pura: validazione degli argomenti, scelta
// euristica dello sforzo, testo del prompt e riga di comando del lancio.

import { espandiTilde } from './parsers'

export const SFORZI = ['low', 'medium', 'high'] as const
export type Sforzo = (typeof SFORZI)[number]

/** Argomenti del tool come li manda il modello, gia controllati. */
export type RichiestaCodex = {
  nome: string
  cartella: string
  prompt: string
  regole?: string
  sforzo?: Sforzo
  modello?: string
}

export type SceltaSforzo = { sforzo: Sforzo; motivo: string; daChi: 'chiamata' | 'classificazione' | 'euristica' }

const RE_NOME = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const RE_MODELLO = /^[\w.:-]{1,80}$/
const MASSIMO_PROMPT = 200_000

export const SCHEMA_CODEX_AVVIA = {
  type: 'object',
  properties: {
    nome: { type: 'string', description: 'Nome breve del lavoro (lettere, cifre, . _ -), unico tra quelli in corso.' },
    cartella: { type: 'string', description: 'Worktree in cui Codex lavora: percorso assoluto (o con ~) di una cartella esistente.' },
    prompt: { type: 'string', description: 'Il compito per Codex, completo.' },
    regole: { type: 'string', description: 'File di regole da accodare al prompt; predefinito <progetto>/.regia/regole.md se esiste.' },
    sforzo: { type: 'string', enum: [...SFORZI], description: 'Sforzo di ragionamento; se manca lo sceglie la mod.' },
    modello: { type: 'string', description: 'Modello Codex; se manca, quello della config della mod o di Codex stesso.' },
  },
  required: ['nome', 'cartella', 'prompt'],
  additionalProperties: false,
} as const

function testo(o: Record<string, unknown>, campo: string): string | undefined {
  const v = o[campo]

  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** Un nome di lavoro accettabile come nome di file: niente percorsi. */
export function isNomeValido(nome: string | undefined): nome is string {
  return nome !== undefined && RE_NOME.test(nome) && !nome.includes('..')
}

/** Dall'intestazione del log di `codex exec`: sessione, cartella, modello e sforzo. */
export function intestazioneLog(testo: string): { sessione?: string; cartella?: string; modello?: string; sforzo?: string } {
  const campo = (nome: string) => new RegExp(`^${nome}:\\s*(\\S.*?)\\s*$`, 'm').exec(testo.slice(0, 4000))?.[1]
  const sforzo = campo('reasoning effort')

  return {
    sessione: campo('session id'),
    cartella: campo('workdir'),
    modello: campo('model'),
    sforzo: SFORZI.find(s => s === sforzo),
  }
}

/** Controlla la forma degli argomenti; la cartella si verifica poi sul disco. */
export function validaRichiesta(grezzo: unknown, home: string): { richiesta?: RichiestaCodex; errore?: string } {
  const o = (typeof grezzo === 'object' && grezzo !== null ? grezzo : {}) as Record<string, unknown>
  const nome = testo(o, 'nome')
  const cartella = testo(o, 'cartella')
  const prompt = typeof o.prompt === 'string' ? o.prompt : ''
  const sforzo = testo(o, 'sforzo')
  const modello = testo(o, 'modello')
  if (!isNomeValido(nome)) {
    return { errore: 'nome non valido: usa solo lettere, cifre, punto, trattino e trattino basso (massimo 64), senza ".." e senza "/"' }
  }
  if (cartella === undefined) return { errore: 'manca la cartella del worktree' }
  const assoluta = espandiTilde(cartella, home)
  if (!assoluta.startsWith('/')) return { errore: `la cartella deve essere un percorso assoluto: ${cartella}` }
  if (prompt.trim() === '') return { errore: 'il prompt e vuoto' }
  if (prompt.length > MASSIMO_PROMPT) return { errore: `il prompt supera ${MASSIMO_PROMPT} caratteri` }
  if (sforzo !== undefined && !SFORZI.includes(sforzo as Sforzo)) return { errore: `sforzo non valido: ${sforzo} (low, medium o high)` }
  if (modello !== undefined && !RE_MODELLO.test(modello)) return { errore: `modello non valido: ${modello}` }
  const regole = testo(o, 'regole')

  return {
    richiesta: {
      nome,
      cartella: assoluta,
      prompt,
      ...(regole === undefined ? {} : { regole: espandiTilde(regole, home) }),
      ...(sforzo === undefined ? {} : { sforzo: sforzo as Sforzo }),
      ...(modello === undefined ? {} : { modello }),
    },
  }
}

const SEGNI_ALTI = /\b(architettur|progett|indag|investig|analisi|audit|migra|refactor|riprogett|diagnos|perch[eé] non|causa)/i
const SEGNI_BASSI = /\b(rispondi solo|rinomina|correggi (il )?refuso|typo|aggiorna (la )?versione|bump|formatta|solo lettura|non modificare)/i

/** Ripiego senza modello: parole chiave e lunghezza del prompt. */
export function sforzoEuristico(prompt: string): SceltaSforzo {
  const lunghezza = prompt.length
  if (SEGNI_ALTI.test(prompt) || lunghezza > 6000) {
    return { sforzo: 'high', motivo: lunghezza > 6000 ? 'prompt lungo (molti passi o file)' : 'parla di progetto, indagine o analisi', daChi: 'euristica' }
  }
  if (SEGNI_BASSI.test(prompt) || lunghezza < 400) {
    return { sforzo: 'low', motivo: lunghezza < 400 ? 'compito breve' : 'compito meccanico', daChi: 'euristica' }
  }

  return { sforzo: 'medium', motivo: 'sviluppo normale', daChi: 'euristica' }
}

/** Il prompt per haiku: JSON con sforzo e motivo. */
export function promptClassificaSforzo(prompt: string): string {
  return [
    'Classifica lo sforzo di ragionamento che serve a un agente di programmazione per questo compito.',
    '- low: meccanico o piccolo (rinominare, una modifica di poche righe, rispondere a una domanda semplice).',
    '- medium: sviluppo normale (una funzionalita o una correzione con i suoi test).',
    '- high: architettura, indagini su guasti, analisi, lavori che toccano molti file.',
    'Rispondi SOLO con JSON su una riga: {"sforzo":"low|medium|high","motivo":"al massimo 12 parole in italiano"}',
    '',
    'Compito:',
    prompt.slice(0, 6000),
  ].join('\n')
}

/** La risposta di haiku, o `undefined` se non e leggibile. */
export function leggiSforzoClassificato(risposta: string): SceltaSforzo | undefined {
  const json = /\{[\s\S]*\}/.exec(risposta)?.[0]
  let dati: unknown
  try {
    dati = json === undefined ? undefined : JSON.parse(json)
  } catch {
    dati = undefined
  }
  const o = (dati ?? {}) as { sforzo?: unknown; motivo?: unknown }
  const sforzo = SFORZI.find(s => s === o.sforzo) ?? SFORZI.find(s => new RegExp(`\\b${s}\\b`, 'i').test(risposta))
  if (sforzo === undefined) return undefined
  const motivo = typeof o.motivo === 'string' && o.motivo.trim() !== '' ? o.motivo.trim().slice(0, 120) : 'classificato da haiku'

  return { sforzo, motivo, daChi: 'classificazione' }
}

/** Il testo che riceve Codex: il compito, le regole, e (se c'e) il paragrafo sulla posta. */
export function componiPrompt(prompt: string, regole: string | undefined, coda: readonly string[] = []): string {
  const parti = [prompt.trimEnd(), regole?.trim(), ...coda.map(c => c.trim())].filter(
    (p): p is string => p !== undefined && p !== '',
  )

  return `${parti.join('\n\n')}\n`
}

/** Dove la mod tiene i file di un lavoro. */
export function percorsiLavoro(home: string, nome: string) {
  const radice = `${home}/.claude/regia/codex`
  const cartella = `${radice}/${nome}`

  return {
    radice,
    cartella,
    prompt: `${cartella}/${nome}.prompt.md`,
    log: `${cartella}/${nome}.log`,
    esito: `${cartella}/${nome}.esito.md`,
    pid: `${cartella}/${nome}.pid`,
    riprendi: `${cartella}/${nome}.riprendi.md`,
    sessione: `${cartella}/${nome}.sessione`,
    eseguiLog: `${radice}/esegui.log`,
  }
}

/**
 * La riga di comando del lancio: `setsid nohup` in background da una bash
 * che stampa il pid e torna subito. `setsid` non e capogruppo qui, quindi
 * esegue sul posto, come `nohup`: il pid stampato e quello dello script.
 */
export function argvLancio(script: string, argomenti: readonly string[]): string[] {
  return [
    'bash',
    '-c',
    'setsid nohup bash "$0" "$@" >/dev/null 2>&1 </dev/null & echo $!',
    script,
    ...argomenti,
  ]
}
