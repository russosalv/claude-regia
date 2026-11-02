// Parser puri: nessun accesso a `$`, nessun effetto. Tutto il resto della mod
// ne dipende, quindi sono testati a parte (parsers.test.ts).

export type ProcessoCodex = {
  pid: number
  durataSec: number
  nome: string
  modello?: string
  effort?: string
  cartella?: string
  output?: string
}

export type VoceLog = {
  nome: string
  /** `HH:MM`, come scritto nel log. */
  inizio?: string
  fine?: string
  durataSec?: number
  exitCode?: number
  commit?: number
  tentativi: number
  isConclusa: boolean
  /** Un nuovo `inizio` con lo stesso nome ha preso il suo posto. */
  isSostituita: boolean
}

const SUFFISSO_ESITO = '.esito.md'
export function messaggioErrore(errore: unknown): string {
  return errore instanceof Error ? errore.message : String(errore)
}

export function ultimoSegmento(percorso: string): string {
  const pulito = percorso.replace(/\/+$/, '')

  return pulito.slice(pulito.lastIndexOf('/') + 1)
}

export function cartellaDi(percorso: string): string {
  const posizione = percorso.lastIndexOf('/')

  return posizione <= 0 ? '/' : percorso.slice(0, posizione)
}

/**
 * Dove stanno `<nome>.log` ed `.esito.md` di un lavoro: accanto al log degli
 * script, o in una cartella per lavoro per quelli lanciati da `codex_avvia`
 * (`~/.claude/regia/codex/<nome>/`).
 */
export function cartellaLavoro(percorsoLog: string, nome: string): string {
  const cartella = cartellaDi(percorsoLog)

  return cartella.endsWith('/.claude/regia/codex') ? `${cartella}/${nome}` : cartella
}

export function espandiTilde(percorso: string, home: string): string {
  if (percorso === '~') return home
  if (percorso.startsWith('~/')) return `${home}${percorso.slice(1)}`

  return percorso
}

/** `~` al posto della home e, se ancora lungo, solo gli ultimi due segmenti. */
export function accorciaPercorso(
  percorso: string,
  home: string,
  massimo = 34,
): string {
  const conTilde =
    home !== '' && (percorso === home || percorso.startsWith(`${home}/`))
      ? `~${percorso.slice(home.length)}`
      : percorso
  if (conTilde.length <= massimo) return conTilde

  const segmenti = conTilde.split('/').filter(s => s !== '')
  const ultimiDue = `…/${segmenti.slice(-2).join('/')}`
  if (ultimiDue.length <= massimo) return ultimiDue

  return `…/${segmenti.slice(-1).join('/')}`
}

/** Durata compatta: `<1m`, `21m`, `1h04`, `2g`. Niente secondi. */
export function formattaDurata(secondi: number): string {
  const s = Math.max(0, Math.round(secondi))
  if (s < 60) return '<1m'
  const minuti = Math.floor(s / 60)
  if (minuti < 60) return `${minuti}m`
  const ore = Math.floor(minuti / 60)
  if (ore < 24) return `${ore}h${String(minuti % 60).padStart(2, '0')}`

  return `${Math.floor(ore / 24)}g`
}

/** `gpt-6-astra` diventa `astra`, `gpt-5.5` diventa `5.5`, `claude-haiku-4-5-2025…` diventa `haiku 4.5`. */
export function abbreviaModello(modello: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:\b|-)/.exec(modello)
  if (claude !== null) return `${claude[1]} ${claude[2]}${claude[3] === undefined ? '' : `.${claude[3]}`}`
  const senzaMarca = modello.replace(/^gpt-/, '')
  const m = /^\d+(?:\.\d+)?-(.+)$/.exec(senzaMarca)

  return m?.[1] ?? senzaMarca
}

/** Token compatti: `850`, `12k`, `1.4M`. */
export function formattaToken(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Esito corto per l'ultima colonna: toglie `exit 0` e le parentesi. */
export function esitoBreve(esito: string | undefined): string {
  if (esito === undefined) return ''
  const parti = esito
    .replace(/\s*\([^)]*\)/g, '')
    .split(' · ')
    .filter(p => p !== '' && p !== 'exit 0')

  return parti.length === 0 ? 'ok' : parti.join(' · ')
}

/** `[[gg-]hh:]mm:ss` di `ps -o etime` in secondi. */
export function parseEtime(testo: string): number | undefined {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(testo.trim())
  if (m === null) return undefined
  const [, giorni, ore, minuti, secondi] = m

  return (
    Number(giorni ?? 0) * 86400 +
    Number(ore ?? 0) * 3600 +
    Number(minuti) * 60 +
    Number(secondi)
  )
}

/** Divide una riga di comando come farebbe la shell, senza espansioni. */
export function tokenizza(riga: string): string[] {
  const token: string[] = []
  let corrente = ''
  let isAperto = false
  let virgolette: string | undefined

  for (const c of riga) {
    if (virgolette !== undefined) {
      if (c === virgolette) virgolette = undefined
      else corrente += c
    } else if (c === '"' || c === "'") {
      virgolette = c
      isAperto = true
    } else if (/\s/.test(c)) {
      if (isAperto) token.push(corrente)
      corrente = ''
      isAperto = false
    } else {
      corrente += c
      isAperto = true
    }
  }
  if (isAperto) token.push(corrente)

  return token
}

const OPZIONI_CON_VALORE = new Set([
  '-m', '--model', '-C', '--cd', '-o', '--output-last-message', '-c',
  '--config', '-p', '--profile', '-s', '--sandbox', '-i', '--image',
  '--color', '--output-schema',
])

type OpzioniCodex = { modello?: string; cartella?: string; output?: string; effort?: string }

function leggiOpzioni(argomenti: readonly string[]): OpzioniCodex {
  let opzioni: OpzioniCodex = {}
  for (let i = 0; i < argomenti.length; i += 1) {
    const grezzo = argomenti[i] ?? ''
    const uguale = grezzo.startsWith('--') ? grezzo.indexOf('=') : -1
    const nome = uguale > 0 ? grezzo.slice(0, uguale) : grezzo
    if (!OPZIONI_CON_VALORE.has(nome)) continue
    const valore = uguale > 0 ? grezzo.slice(uguale + 1) : argomenti[(i += 1)]
    if (valore === undefined) continue
    opzioni = applicaOpzione(opzioni, nome, valore)
  }

  return opzioni
}

function applicaOpzione(
  opzioni: OpzioniCodex,
  nome: string,
  valore: string,
): OpzioniCodex {
  if (nome === '-m' || nome === '--model') return { ...opzioni, modello: valore }
  if (nome === '-C' || nome === '--cd') return { ...opzioni, cartella: valore }
  if (nome === '-o' || nome === '--output-last-message') {
    return { ...opzioni, output: valore }
  }
  if (nome === '-c' || nome === '--config') {
    const m = /^model_reasoning_effort\s*=\s*["']?([^"'\s]+)["']?$/.exec(valore)
    if (m?.[1] !== undefined) return { ...opzioni, effort: m[1] }
  }

  return opzioni
}

/** Nome del lavoro: basename di `-o` senza `.esito.md`, poi della cartella. */
export function nomeLavoro(
  output: string | undefined,
  cartella: string | undefined,
  pid: number,
): string {
  if (output !== undefined && output !== '') {
    const base = ultimoSegmento(output)
    return base.endsWith(SUFFISSO_ESITO)
      ? base.slice(0, -SUFFISSO_ESITO.length)
      : base.replace(/\.[^.]+$/, '')
  }
  if (cartella !== undefined && cartella !== '') return ultimoSegmento(cartella)

  return `codex-${pid}`
}

function leggiRigaPs(riga: string): ProcessoCodex | undefined {
  const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(riga)
  if (m === null) return undefined
  const durataSec = parseEtime(m[2] ?? '')
  const token = tokenizza(m[3] ?? '')
  const posizione = token.findIndex(
    (t, i) => t === 'exec' && /(^|\/)codex(\.js)?$/.test(token[i - 1] ?? ''),
  )
  if (durataSec === undefined || posizione < 0) return undefined
  if (/(^|\/)e?grep$/.test(token[0] ?? '')) return undefined

  const pid = Number(m[1])
  const opzioni = leggiOpzioni(token.slice(posizione + 1))

  return {
    pid,
    durataSec,
    nome: nomeLavoro(opzioni.output, opzioni.cartella, pid),
    ...opzioni,
  }
}

/**
 * Processi `codex exec` da `ps -eo pid,etime,args`. Il launcher npm lancia un
 * binario figlio con gli stessi argomenti: righe con lo stesso `-o` (o la
 * stessa cartella) valgono un lavoro solo, quella col pid piu basso.
 */
export function parsePs(uscita: string): ProcessoCodex[] {
  const trovati = uscita
    .split('\n')
    .map(leggiRigaPs)
    .filter((p): p is ProcessoCodex => p !== undefined)
    .sort((a, b) => a.pid - b.pid)
  const viste = new Set<string>()

  return trovati.filter(p => {
    const chiave = p.output ?? p.cartella ?? `pid:${p.pid}`
    if (viste.has(chiave)) return false
    viste.add(chiave)

    return true
  })
}

function minutiDelGiorno(orario: string): number {
  const [ore, minuti] = orario.split(':')

  return Number(ore) * 60 + Number(minuti)
}

function durataTra(inizio: string, fine: string): number {
  return ((minutiDelGiorno(fine) - minutiDelGiorno(inizio) + 1440) % 1440) * 60
}

// I nomi dei lavori possono contenere spazi ("arch-decision visure r2").
const RE_INIZIO = /^(\d{1,2}:\d{2})\s+inizio\s+(.+?)\s*$/
const RE_FINE = /^(\d{1,2}:\d{2})\s+fine\s+(.+?)(?:\s*\(([^()]*)\))?\s*$/
const RE_RIPROVO = /^(\d{1,2}:\d{2})\s+(.+?),?\s+riprovo\s*\((\d+)\)\s*$/
// Annotazioni a mano ("18:29 TUTTO FINITO"): legittime, non sono eventi di lavoro.
const RE_ANNOTAZIONE = /^\d{1,2}:\d{2}\s+\S/

function numeroDa(dettagli: string | undefined, parola: string) {
  const m = new RegExp(`${parola}\\s+(-?\\d+)`).exec(dettagli ?? '')

  return m?.[1] === undefined ? undefined : Number(m[1])
}

function sostituisci<T>(lista: readonly T[], indice: number, nuovo: T): T[] {
  return lista.map((voce, i) => (i === indice ? nuovo : voce))
}

type StatoLog = {
  voci: readonly VoceLog[]
  aperte: ReadonlyMap<string, number>
  ignorate: number
}

function conInizio(stato: StatoLog, nome: string, ora: string): StatoLog {
  const precedente = stato.aperte.get(nome)
  const base =
    precedente === undefined
      ? stato.voci
      : sostituisci(stato.voci, precedente, {
          ...(stato.voci[precedente] as VoceLog),
          isSostituita: true,
        })
  const nuova: VoceLog = {
    nome, inizio: ora, tentativi: 0, isConclusa: false, isSostituita: false,
  }

  return {
    ...stato,
    voci: [...base, nuova],
    aperte: new Map(stato.aperte).set(nome, base.length),
  }
}

function conFine(stato: StatoLog, nome: string, ora: string, dettagli?: string): StatoLog {
  const indice = stato.aperte.get(nome)
  const aperta = indice === undefined ? undefined : stato.voci[indice]
  const chiusa: VoceLog = {
    ...(aperta ?? { nome, tentativi: 0, isSostituita: false }),
    fine: ora,
    isConclusa: true,
    exitCode: numeroDa(dettagli, 'exit'),
    commit: numeroDa(dettagli, 'commit'),
    durataSec:
      aperta?.inizio === undefined ? undefined : durataTra(aperta.inizio, ora),
  }
  const aperte = new Map(stato.aperte)
  aperte.delete(nome)

  return indice === undefined
    ? { ...stato, voci: [...stato.voci, chiusa], aperte }
    : { ...stato, voci: sostituisci(stato.voci, indice, chiusa), aperte }
}

function conRiprovo(stato: StatoLog, nome: string, tentativi: number): StatoLog {
  const indice =
    stato.aperte.get(nome) ??
    stato.voci.map(v => v.nome).lastIndexOf(nome)
  const voce = indice < 0 ? undefined : stato.voci[indice]
  if (voce === undefined) return { ...stato, ignorate: stato.ignorate + 1 }

  return { ...stato, voci: sostituisci(stato.voci, indice, { ...voce, tentativi }) }
}

function applicaRiga(stato: StatoLog, riga: string): StatoLog {
  const inizio = RE_INIZIO.exec(riga)
  if (inizio !== null) return conInizio(stato, inizio[2] ?? '', inizio[1] ?? '')
  const fine = RE_FINE.exec(riga)
  if (fine !== null) return conFine(stato, fine[2] ?? '', fine[1] ?? '', fine[3])
  const riprovo = RE_RIPROVO.exec(riga)
  if (riprovo !== null) {
    return conRiprovo(stato, riprovo[2] ?? '', Number(riprovo[3]))
  }

  // Un'annotazione con l'ora non è un errore; una riga senza ora lo è.
  return RE_ANNOTAZIONE.test(riga) ? stato : { ...stato, ignorate: stato.ignorate + 1 }
}

/** Voci in ordine di log (la piu vecchia per prima) e righe non riconosciute. */
export function parseEseguiLog(testo: string): { voci: VoceLog[]; ignorate: number } {
  const finale = testo
    .split('\n')
    .map(riga => riga.trim())
    .filter(riga => riga !== '')
    .reduce(applicaRiga, { voci: [], aperte: new Map(), ignorate: 0 } as StatoLog)

  return { voci: [...finale.voci], ignorate: finale.ignorate }
}

