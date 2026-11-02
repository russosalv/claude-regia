// Lo sciame, la parte pura: una lavagna di compiti con dipendenze, chi puo
// partire ora, che cosa succede quando uno finisce e il testo per ciascuno.

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
  esecutore: 'claude' | 'codex'
  /** Tipo di agente Claude; se manca, `general-purpose`. */
  tipo?: string
  /** Vero se cambia dei file: lavora in un worktree suo. */
  scrive: boolean
  dopo: string[]
  stato: StatoCompito
  tentativi: number
  agenteId?: string
  lancioMs?: number
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

/** Il nome con cui un compito gira ed e raggiungibile in posta. */
export const indirizzo = (s: Pick<Sciame, 'id'>, c: Pick<Compito, 'nome'>): string => `${s.id}-${c.nome}`

function leggiCompito(g: Grezzo): Compito | string {
  const nome = typeof g.nome === 'string' ? g.nome.trim() : ''
  if (!RE_NOME.test(nome)) return `nome di compito non valido: "${nome}" (lettere, cifre, - e _, al piu 40)`
  if (typeof g.prompt !== 'string' || g.prompt.trim() === '') return `il compito "${nome}" non ha un prompt`
  const isListaDopo = g.dopo === undefined || (Array.isArray(g.dopo) && g.dopo.every(d => typeof d === 'string'))
  if (!isListaDopo) return `"dopo" del compito "${nome}" deve essere una lista di nomi`

  return {
    nome,
    prompt: g.prompt,
    esecutore: g.esecutore === 'codex' ? 'codex' : 'claude',
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
    c.esecutore === 'claude'
      ? 'Tool della regia, da caricare con ToolSearch se servono: mcp__regia__posta_invia (a un compagno o a "principale"), mcp__regia__sciame_stato, mcp__regia__sciame_aggiungi (lavoro emerso che non e tuo).'
      : 'Per i compagni usa la CLI della posta descritta sotto.',
  ].join('\n')
}

const SEGNI: Readonly<Record<StatoCompito, string>> = { attesa: '○', corsa: '●', fatto: '✓', fallito: '✗', bloccato: '⊘', annullato: '■' }

function rigaCompito(c: Compito, massimo: number): string {
  const dati = [c.esecutore, c.modello, c.sforzo, c.tentativi > 1 ? `tentativo ${c.tentativi}` : undefined].filter(Boolean).join(', ')
  const esito = c.esito === undefined ? '' : `: ${c.esito.replace(/\s+/g, ' ').slice(0, massimo)}`
  const file = c.fileEsito === undefined ? '' : ` [${c.fileEsito}]`

  return `${SEGNI[c.stato]} ${c.nome} (${dati})${esito}${file}`
}

/** La lavagna per il modello o per `/regia sciame`: poche righe. */
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
