// Lo sciame, la parte che parla col motore: lancia i compiti pronti, segue chi
// corre (Claude da `turn.complete`, Codex dal suo log), rilancia un gradino
// sopra chi fallisce e alla fine sveglia la principale. La lavagna sta in
// `$.store`: sopravvive a un ricaricamento della mod.

import type { EngineInterface, Timer } from 'claude-code'

import { codexAvvia, isInCorso } from './codex-avvia'
import { percorsiLavoro } from './codex'
import type { Sforzo } from './codex'
import { leggiConfig, leggiHome } from './fonti'
import { gradinoSu } from './instradamento'
import { ricordaScelta, ricordaSforzo, scegli } from './modelli'
import { conRisparmio } from './orchestra'
import { leggiMemoriaAgenti } from './memoria-agenti'
import { messaggioErrore, parseEseguiLog } from './parsers'
import { CHIAVE_SCIAMI, avvisoFine, conCompiti, conDati, conEsito, conLancio, creaSciame, daLanciare, descrivi, ferma, indirizzo, isFinito, promptLavoratore } from './sciame'
import type { Compito, Sciame } from './sciame'

const MASSIMO_SCIAMI = 5
const GIRO_MS = 5_000
/** Un agente sparito dalla lista prima di questo tempo puo non esserci ancora. */
const TOLLERANZA_LISTA_MS = 30_000
const ESITO_BREVE = 1_200

type Risposta = { result: string } | { deny: string }

const SCHEMA_COMPITI = {
  type: 'array',
  description: 'I compiti. nome: breve e unico. prompt: autosufficiente. esecutore: claude (predefinito) o codex. tipo: tipo di agente Claude. scrive: true se cambia file (avra un worktree suo). dopo: nomi dei compiti da cui dipende. Modello e sforzo li decide la mod sul compito.',
  items: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      prompt: { type: 'string' },
      esecutore: { type: 'string', enum: ['claude', 'codex'] },
      tipo: { type: 'string' },
      scrive: { type: 'boolean' },
      dopo: { type: 'array', items: { type: 'string' } },
    },
    required: ['nome', 'prompt'],
    additionalProperties: false,
  },
} as const

export const STRUMENTI_SCIAME = [
  {
    name: 'sciame_avvia',
    description: 'Lancia uno sciame di agenti Claude e Codex su una lavagna di compiti con dipendenze: parte chi e pronto, entro il parallelo; chi fallisce riprova una volta un gradino sopra; gli agenti si parlano con la posta e possono aggiungere compiti. Risponde subito; alla fine sveglia la principale con il riepilogo: non controllarlo.',
    inputSchema: {
      type: 'object',
      properties: {
        obiettivo: { type: 'string', description: 'A che cosa serve, in una riga: lo leggono tutti gli agenti.' },
        compiti: SCHEMA_COMPITI,
        parallelo: { type: 'integer', description: 'Quanti insieme, da 1 a 16; se manca, dalla config (4).' },
      },
      required: ['obiettivo', 'compiti'],
      additionalProperties: false,
    },
  },
  {
    name: 'sciame_stato',
    description: 'La lavagna di uno sciame di questa sessione (o di tutti): stato, modello, sforzo ed esito di ogni compito.',
    inputSchema: { type: 'object', properties: { sciame: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'sciame_aggiungi',
    description: 'Aggiunge compiti a uno sciame in corso: per il lavoro emerso strada facendo che non e di chi lo ha trovato.',
    inputSchema: {
      type: 'object',
      properties: { sciame: { type: 'string' }, compiti: SCHEMA_COMPITI },
      required: ['sciame', 'compiti'],
      additionalProperties: false,
    },
  },
  {
    name: 'sciame_ferma',
    description: 'Ferma uno sciame: i compiti in attesa non partono piu, chi corre finisce il suo.',
    inputSchema: { type: 'object', properties: { sciame: { type: 'string' } }, required: ['sciame'], additionalProperties: false },
  },
] as const

const isSciame = (v: unknown): v is Sciame => typeof v === 'object' && v !== null && typeof (v as Sciame).id === 'string' && Array.isArray((v as Sciame).compiti)

async function leggi($: EngineInterface, sessione: string): Promise<Sciame[]> {
  const grezzo = await $.store.get(`${CHIAVE_SCIAMI}${sessione}`)

  return Array.isArray(grezzo) ? grezzo.filter(isSciame) : []
}

// Una modifica alla volta: tool, fine di un turno e timer non si pestano i piedi.
let coda: Promise<unknown> = Promise.resolve()

function inFila<T>(lavoro: () => Promise<T>): Promise<T> {
  const fatto = coda.then(lavoro, lavoro)
  coda = fatto.catch(() => undefined)

  return fatto
}

async function scrivi($: EngineInterface, sessione: string, sciami: readonly Sciame[]): Promise<void> {
  await $.store.set(`${CHIAVE_SCIAMI}${sessione}`, sciami.slice(-MASSIMO_SCIAMI))
}

const CARTELLA_WORKTREE = '.worktrees'

/** La cartella dei worktree resta fuori da git senza toccare il `.gitignore` del progetto. */
async function escludiCartella($: EngineInterface, radice: string): Promise<void> {
  const r = await $.process.run(['git', '-C', radice, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], { timeoutMs: 10_000 })
  const file = r.stdout.trim()
  if (r.exitCode !== 0 || file === '') return
  const attuale = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
  if (attuale.split('\n').includes(`${CARTELLA_WORKTREE}/`)) return
  await $.fs.write(file, `${attuale}${attuale === '' || attuale.endsWith('\n') ? '' : '\n'}${CARTELLA_WORKTREE}/\n`)
}

/**
 * Il worktree di un compito che scrive; se c'e gia (nuovo tentativo), quello.
 * Dentro il repository: un agente in background ha i permessi sulla sua cartella.
 */
async function preparaWorktree($: EngineInterface, s: Sciame, c: Compito): Promise<string> {
  const repo = await $.session.repo()
  if (repo?.root === undefined) throw new Error('questo compito scrive ma la sessione non e in un repository git')
  const cartella = `${repo.root}/${CARTELLA_WORKTREE}/${indirizzo(s, c)}`
  if (await $.fs.exists(cartella)) return cartella
  await escludiCartella($, repo.root)
  const r = await $.process.run(['git', '-C', repo.root, 'worktree', 'add', '-b', `sciame/${s.id}/${c.nome}`, cartella, 'HEAD'], { timeoutMs: 60_000 })
  if (r.exitCode !== 0) throw new Error(`git worktree add non riuscito: ${r.stderr.trim()}`)

  return cartella
}

/**
 * Il tool Agent non si puo chiamare da una mod: `$.agent.spawn`, che non prende
 * lo sforzo. Lo sforzo si applica allora su `turn.step` (`ricordaSforzo`).
 */
async function lanciaClaude($: EngineInterface, s: Sciame, c: Compito): Promise<Partial<Compito>> {
  const nome = indirizzo(s, c)
  const descrizione = `${s.id}: ${c.nome}`.slice(0, 60)
  const tipo = c.tipo ?? 'general-purpose'
  const cartella = c.scrive ? await preparaWorktree($, s, c) : undefined
  const prompt = promptLavoratore(s, { ...c, ...(cartella === undefined ? {} : { cartella }) })
  const su = c.tentativi > 0 ? gradinoSu(c) : undefined
  const scelta = await scegli($, { tipo, descrizione, prompt, model: su?.modello, effort: su?.sforzo, cwd: cartella })
  const provaSforzo = su?.sforzo ?? scelta.sforzo
  if (provaSforzo !== undefined) ricordaSforzo(nome, provaSforzo)
  ricordaScelta(nome, su === undefined ? scelta : { ...scelta, modello: su.modello, sforzo: su.sforzo, motivo: 'un gradino sopra: il tentativo prima e fallito', provenienza: 'regia' })
  const modello = su?.modello ?? scelta.modello
  const esito = await $.agent.spawn({
    prompt: await conRisparmio($, prompt),
    description: descrizione,
    subagentType: tipo,
    name: nome,
    ...(modello === undefined ? {} : { model: modello }),
    ...(cartella === undefined ? {} : { cwd: cartella }),
  })
  if (esito.deny !== undefined) throw new Error(esito.deny)
  const agenteId = esito.agentId ?? (await $.agent.list()).filter(a => a.name === nome).at(-1)?.id
  if (agenteId === undefined) throw new Error('il motore non ha dato un agente')

  return {
    agenteId,
    modello: esito.model,
    ...(provaSforzo === undefined ? {} : { sforzo: provaSforzo }),
    ...(cartella === undefined ? {} : { cartella }),
  }
}

async function lanciaCodex($: EngineInterface, home: string, s: Sciame, c: Compito): Promise<Partial<Compito>> {
  const repo = await $.session.repo().catch(() => undefined)
  const cartella = c.scrive ? await preparaWorktree($, s, c) : repo?.root ?? (await $.session.cwd())
  const su = c.tentativi > 0 ? gradinoSu(c) : undefined
  const sforzo = su === undefined ? undefined : (su.sforzo === 'xhigh' ? 'high' : su.sforzo) as Sforzo
  const esito = await codexAvvia($, {
    nome: indirizzo(s, c),
    cartella,
    prompt: promptLavoratore(s, { ...c, cartella }),
    ...(sforzo === undefined ? {} : { sforzo }),
  })
  if ('deny' in esito) throw new Error(esito.deny)
  const letto = /sforzo (low|medium|high)/.exec(esito.result)?.[1]

  return { cartella, ...(letto === undefined ? {} : { sforzo: letto }) }
}

/** Lancia i pronti. Un lancio che fallisce vale come un tentativo fallito. */
async function lanciaPronti($: EngineInterface, home: string, iniziale: Sciame): Promise<Sciame> {
  let s = iniziale
  // Una passata sola: chi fallisce il lancio riprova al prossimo giro.
  for (const c of daLanciare(s)) {
    const oraMs = await $.clock.now()
    try {
      const dati = c.esecutore === 'claude' ? await lanciaClaude($, s, c) : await lanciaCodex($, home, s, c)
      s = conLancio(s, c.nome, { ...dati, lancioMs: oraMs })
    } catch (errore) {
      s = conEsito(conLancio(s, c.nome, { lancioMs: oraMs }), c.nome, { isOk: false, esito: `lancio non riuscito: ${messaggioErrore(errore)}` })
    }
  }

  return s
}

async function salvaEsito($: EngineInterface, home: string, s: Sciame, c: Compito, testo: string): Promise<string> {
  const file = `${home}/.claude/regia/sciami/${s.id}/${c.nome}.md`
  await $.fs.write(file, `${testo}\n`)

  return file
}

// Le fini sentite da `turn.complete`, finche il giro non le applica.
const finiti = new Map<string, { isOk: boolean; testo: string }>()

/** Hook di `turn.complete` di un subagente: se e di uno sciame, avanza. */
export async function notaFine($: EngineInterface, agenteId: string, motivo: string, testo: string): Promise<void> {
  finiti.set(agenteId, { isOk: motivo === 'answer', testo })
  await giro($)
}

/** Esito di un compito Codex finito, dal suo log: `undefined` se e ancora vivo. */
async function esitoCodex($: EngineInterface, home: string, s: Sciame, c: Compito): Promise<{ isOk: boolean; testo: string } | undefined> {
  const nome = indirizzo(s, c)
  if (await isInCorso($, home, nome)) return undefined
  const p = percorsiLavoro(home, nome)
  const log = (await $.fs.exists(p.eseguiLog)) ? parseEseguiLog(await $.fs.read(p.eseguiLog)).voci : []
  const voce = [...log].reverse().find(v => v.nome === nome)
  // Il processo e partito ma lo script non ha ancora scritto la sua riga.
  if (voce === undefined || !voce.isConclusa) {
    const dopoMs = (await $.clock.now()) - (c.lancioMs ?? 0)

    return dopoMs < TOLLERANZA_LISTA_MS ? undefined : { isOk: false, testo: 'interrotto: nessun processo vivo e nessuna riga di fine nel log' }
  }
  const risposta = (await $.fs.exists(p.esito)) ? (await $.fs.read(p.esito)).trim() : ''
  const isOk = voce.exitCode === 0

  return { isOk, testo: risposta || `exit ${voce.exitCode ?? '?'}, ${voce.commit ?? 0} commit` }
}

/** Esito di un compito Claude: dalla fine sentita, o dalla lista se la mod l'ha persa. */
async function esitoClaude($: EngineInterface, c: Compito): Promise<{ isOk: boolean; testo: string } | undefined> {
  if (c.agenteId === undefined) return undefined
  const sentita = finiti.get(c.agenteId)
  if (sentita !== undefined) return sentita
  const voce = (await $.agent.list()).find(a => a.id === c.agenteId)
  if (voce?.status === 'failed' || voce?.status === 'killed') return { isOk: false, testo: `agente ${voce.status}` }
  if (voce?.status === 'completed') return { isOk: true, testo: 'completato (rapporto non catturato: la mod e stata ricaricata)' }
  if (voce !== undefined) return undefined
  const dopoMs = (await $.clock.now()) - (c.lancioMs ?? 0)

  return dopoMs < TOLLERANZA_LISTA_MS ? undefined : { isOk: false, testo: 'interrotto: l\'agente non c\'e piu' }
}

/** Aggiorna modello e sforzo dalla memoria degli agenti, per la lavagna e il gradino sopra. */
async function conInfoVere($: EngineInterface, sessione: string, s: Sciame): Promise<Sciame> {
  const { agenti } = (await leggiMemoriaAgenti($, sessione)).dati

  return s.compiti.reduce((acc, c) => {
    const info = c.agenteId === undefined ? undefined : agenti[c.agenteId]

    return info === undefined ? acc : conDati(acc, c.nome, {
      ...(info.modello === undefined ? {} : { modello: info.modello }),
      ...(info.sforzo === undefined ? {} : { sforzo: info.sforzo }),
    })
  }, s)
}

async function avanzaUno($: EngineInterface, home: string, sessione: string, iniziale: Sciame): Promise<Sciame> {
  let s = await conInfoVere($, sessione, iniziale)
  for (const c of s.compiti.filter(x => x.stato === 'corsa')) {
    const fine = c.esecutore === 'claude' ? await esitoClaude($, c) : await esitoCodex($, home, s, c)
    if (fine === undefined) continue
    const fileEsito = await salvaEsito($, home, s, c, fine.testo)
    s = conEsito(s, c.nome, { isOk: fine.isOk, esito: fine.testo.slice(0, ESITO_BREVE), fileEsito })
    if (c.agenteId !== undefined) finiti.delete(c.agenteId)
  }

  return lanciaPronti($, home, s)
}

async function avvisa($: EngineInterface, s: Sciame): Promise<void> {
  const testo = avvisoFine(s)
  $.ui.toast(`Sciame ${s.id} finito`, { timeoutMs: 8_000 })
  try {
    // Senza superficie nessuno aspetta la sveglia: il modello legge la riga al prossimo giro.
    if ((await $.session.surfaces()).length > 0) void $.prompt.submit({ text: testo }).catch(() => undefined)
    else await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: testo }] } })
  } catch (errore) {
    $.ui.toast(`regia: sciame ${s.id}: ${messaggioErrore(errore)}`)
  }
}

/** Un passo di tutti gli sciami attivi della sessione. Non lancia. */
export function giro($: EngineInterface): Promise<void> {
  return inFila(async () => {
    try {
      const [sessione, home] = await Promise.all([$.session.id(), leggiHome($)])
      if (home === undefined) return
      const prima = await leggi($, sessione)
      if (prima.every(s => s.isAvvisato)) return
      const dopo: Sciame[] = []
      for (const s of prima) dopo.push(s.isAvvisato ? s : await avanzaUno($, home, sessione, s))
      const daAvvisare = dopo.filter(s => !s.isAvvisato && isFinito(s))
      const finale = dopo.map(s => (daAvvisare.includes(s) ? { ...s, isAvvisato: true } : s))
      if (JSON.stringify(finale) !== JSON.stringify(prima)) await scrivi($, sessione, finale)
      for (const s of daAvvisare) await avvisa($, s)
    } catch (errore) {
      $.ui.toast(`regia: sciame: ${messaggioErrore(errore)}`)
    }
  })
}

let battito: Timer | undefined

export function avviaSciami($: EngineInterface): void {
  if (battito !== undefined) return
  battito = $.clock.every(GIRO_MS, () => giro($))
}

export function fermaSciami(): void {
  battito?.cancel()
  battito = undefined
}

const trovato = (sciami: readonly Sciame[], id: unknown): Sciame | undefined => sciami.find(s => s.id === id)

export async function sciameAvvia($: EngineInterface, grezzi: unknown): Promise<Risposta> {
  const a = (grezzi ?? {}) as { obiettivo?: unknown; compiti?: unknown; parallelo?: unknown }
  const home = await leggiHome($)
  if (home === undefined) return { deny: 'sciame_avvia: HOME non definita' }
  const [config, oraMs, sessione] = await Promise.all([leggiConfig($, home), $.clock.now(), $.session.id()])
  const s = creaSciame({ id: `s${oraMs.toString(36).slice(-5)}`, obiettivo: a.obiettivo, compiti: a.compiti, parallelo: a.parallelo, oraMs, predefinito: config.dati.sciameParallelo })
  if (typeof s === 'string') return { deny: `sciame_avvia: ${s}` }
  const repo = await $.session.repo().catch(() => undefined)
  if (repo?.root === undefined && s.compiti.some(c => c.scrive)) return { deny: 'sciame_avvia: i compiti che scrivono lavorano in un worktree, ma la sessione non e in un repository git' }
  await inFila(async () => scrivi($, sessione, [...(await leggi($, sessione)), s]))
  await giro($)
  const ora = trovato(await leggi($, sessione), s.id) ?? s

  return { result: `${descrivi(ora)}\nNon controllarlo: alla fine ti arriva il riepilogo. Nel frattempo puoi fare altro.` }
}

export async function sciameStato($: EngineInterface, grezzi: unknown): Promise<Risposta> {
  const { sciame } = (grezzi ?? {}) as { sciame?: unknown }
  const sciami = await leggi($, await $.session.id())
  const scelti = sciame === undefined ? sciami : sciami.filter(s => s.id === sciame)
  if (scelti.length === 0) return { result: sciame === undefined ? 'Nessuno sciame in questa sessione.' : `Sciame ${String(sciame)} non trovato.` }

  return { result: scelti.map(s => descrivi(s)).join('\n\n') }
}

/** Cambia uno sciame sotto la coda, poi fa un passo. */
async function suSciame(
  $: EngineInterface,
  id: unknown,
  cambia: (s: Sciame) => Sciame | string,
): Promise<Sciame | string> {
  const sessione = await $.session.id()
  const esito = await inFila(async (): Promise<Sciame | string> => {
    const sciami = await leggi($, sessione)
    const s = trovato(sciami, id)
    if (s === undefined) return `sciame ${String(id)} non trovato`
    const nuovo = cambia(s)
    if (typeof nuovo !== 'string') await scrivi($, sessione, sciami.map(x => (x.id === s.id ? nuovo : x)))

    return nuovo
  })
  if (typeof esito !== 'string') await giro($)

  return esito
}

export async function sciameAggiungi($: EngineInterface, grezzi: unknown): Promise<Risposta> {
  const a = (grezzi ?? {}) as { sciame?: unknown; compiti?: unknown }
  const s = await suSciame($, a.sciame, x => conCompiti(x, a.compiti))

  return typeof s === 'string' ? { deny: `sciame_aggiungi: ${s}` } : { result: descrivi(s) }
}

export async function sciameFerma($: EngineInterface, grezzi: unknown): Promise<Risposta> {
  const a = (grezzi ?? {}) as { sciame?: unknown }
  const s = await suSciame($, a.sciame, ferma)

  return typeof s === 'string' ? { deny: `sciame_ferma: ${s}` } : { result: descrivi(s) }
}

/** Gli sciami della sessione non ancora finiti. */
export async function contaSciamiAttivi($: EngineInterface): Promise<number> {
  return (await leggi($, await $.session.id())).filter(s => !s.isAvvisato).length
}

/** I compiti in attesa, per la scaletta del pane. */
export async function compitiInAttesa($: EngineInterface, sessione: string): Promise<{ sciame: string; compito: Compito }[]> {
  return (await leggi($, sessione)).filter(s => !s.isAvvisato).flatMap(s =>
    s.compiti.filter(c => c.stato === 'attesa' || c.stato === 'bloccato').map(compito => ({ sciame: s.id, compito })),
  )
}
