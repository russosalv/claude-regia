// Letture dal mondo esterno. Ogni fonte e isolata: se fallisce restituisce un
// avviso in italiano, mai un'eccezione, e le altre fonti continuano.

import type { AgentInfo, EngineInterface } from 'claude-code'

import type { LetturaLog } from './model'
import { cartellaLavoro, messaggioErrore, parseEseguiLog, parsePs, ultimoSegmento } from './parsers'
import type { ProcessoCodex } from './parsers'
import { LOG_CODEX_REGIA, configPredefinita, parseConfig, validaRegistro } from './registro'
import type { ConfigRegia, VoceRegistro } from './registro'
import { ricordiDaMemoria } from './agenti'
import { CHIAVE_AGENTI } from './memoria-agenti'
import { CHIAVE_SCIAMI } from './sciame'
import type { RicordoAgente } from './agenti'

export type Lettura<T> = { dati?: T; avvisi: string[] }

const MASSIMO_ESITI_CONTROLLATI = 80

async function provando<T>(
  etichetta: string,
  lavoro: () => Promise<Lettura<T>>,
): Promise<Lettura<T>> {
  try {
    return await lavoro()
  } catch (errore) {
    return { avvisi: [`${etichetta}: ${messaggioErrore(errore)}`] }
  }
}

function leggiJson(testo: string, etichetta: string): unknown {
  try {
    return JSON.parse(testo)
  } catch (errore) {
    throw new Error(`${etichetta} non e un JSON valido (${messaggioErrore(errore)})`)
  }
}

export function leggiHome($: EngineInterface): Promise<string | undefined> {
  return $.env.get('HOME')
}

export function leggiAgenti($: EngineInterface): Promise<Lettura<AgentInfo[]>> {
  return provando('subagenti Claude', async () => ({
    dati: await $.agent.list(),
    avvisi: [],
  }))
}

export function leggiProcessi(
  $: EngineInterface,
): Promise<Lettura<ProcessoCodex[]>> {
  return provando('processi codex (ps)', async () => {
    const esito = await $.process.run(['ps', '-ww', '-eo', 'pid,etime,args'], {
      timeoutMs: 10_000,
    })
    if (esito.exitCode !== 0) {
      throw new Error(`ps e terminato con codice ${esito.exitCode}: ${esito.stderr.trim()}`)
    }

    return { dati: parsePs(esito.stdout), avvisi: [] }
  })
}

async function nomiConEsito(
  $: EngineInterface,
  percorso: string,
  nomi: readonly string[],
): Promise<Set<string>> {
  const ultimi = [...new Set(nomi)].slice(-MASSIMO_ESITI_CONTROLLATI)
  const presenti = await Promise.all(
    ultimi.map(async nome =>
      (await $.fs.exists(`${cartellaLavoro(percorso, nome)}/${nome}.esito.md`)) ? nome : undefined,
    ),
  )

  return new Set(presenti.filter((n): n is string => n !== undefined))
}

export function leggiLog(
  $: EngineInterface,
  percorso: string,
  home: string,
): Promise<Lettura<LetturaLog>> {
  const nome = percorso.startsWith(home) ? `~${percorso.slice(home.length)}` : percorso

  return provando(`log codex ${nome}`, async () => {
    if (!(await $.fs.exists(percorso))) {
      // Il log di codex_avvia nasce col primo lancio: finche manca non e un problema.
      const isRegia = percorso.endsWith(`/${LOG_CODEX_REGIA}`)
      return { avvisi: isRegia ? [] : [`log codex non trovato: ${nome}`] }
    }
    const { voci, ignorate } = parseEseguiLog(await $.fs.read(percorso))
    const esiti = await nomiConEsito($, percorso, voci.map(v => v.nome))
    const avvisi =
      ignorate > 0 ? [`log codex ${nome}: ${ignorate} righe non riconosciute`] : []

    return { dati: { percorso, voci, esiti }, avvisi }
  })
}

export type DatiRegistro = { lavori: VoceRegistro[]; isPresente: boolean }

export function leggiRegistro(
  $: EngineInterface,
  home: string,
): Promise<Lettura<DatiRegistro>> {
  const percorso = `${home}/.claude/regia/registro.json`

  return provando<DatiRegistro>('registro', async () => {
    if (!(await $.fs.exists(percorso))) {
      return { dati: { lavori: [], isPresente: false }, avvisi: [] }
    }
    const radice = leggiJson(await $.fs.read(percorso), 'registro.json')
    const { lavori, scartate, errore } = validaRegistro(radice)
    if (errore !== undefined) throw new Error(`registro.json non valido: ${errore}`)
    const avvisi =
      scartate > 0 ? [`registro: ${scartate} voci non valide saltate`] : []

    return { dati: { lavori, isPresente: true }, avvisi }
  })
}

export function leggiConfig(
  $: EngineInterface,
  home: string,
): Promise<{ dati: ConfigRegia; avvisi: string[] }> {
  const percorso = `${home}/.claude/regia/config.json`
  const predefinita = configPredefinita(home)

  return provando<ConfigRegia>('config', async () => {
    if (!(await $.fs.exists(percorso))) return { dati: predefinita, avvisi: [] }
    const { config, avvisi } = parseConfig(
      leggiJson(await $.fs.read(percorso), 'config.json'),
      home,
    )

    return { dati: config, avvisi }
  }).then(lettura => ({ ...lettura, dati: lettura.dati ?? predefinita }))
}

const VARIABILE_SESSIONE = 'CLAUDE_CODE_SESSION_ID'

/** Id della sessione in cui gira la mod (il nome del file di trascrizione). */
export function leggiSessioneId($: EngineInterface): Promise<Lettura<string>> {
  return provando<string>('id di sessione', async () => ({
    dati: await $.session.id(),
    avvisi: [],
  }))
}

/**
 * Pid, tra quelli dati, il cui ambiente porta l'id della sessione. La Bash di
 * Claude esporta `CLAUDE_CODE_SESSION_ID` e ogni figlio la eredita, anche se
 * poi viene riadottato da init (nohup, setsid): per questo si legge
 * `/proc/<pid>/environ` e non si risale la catena dei padri.
 */
export function leggiPidDellaSessione(
  $: EngineInterface,
  pid: readonly number[],
  sessioneId: string,
): Promise<Lettura<Set<number>>> {
  return provando<Set<number>>('attribuzione dei processi codex', async () => {
    if (pid.length === 0) return { dati: new Set(), avvisi: [] }
    const esito = await $.process.run(
      ['grep', '-az', '-H', '-o', `^${VARIABILE_SESSIONE}=.*`, ...pid.map(p => `/proc/${p}/environ`)],
      { timeoutMs: 10_000 },
    )
    // grep: 0 trovato, 1 nessuno, 2 anche file illeggibili (processi finiti o altrui).
    if (esito.exitCode > 2) {
      throw new Error(`grep e terminato con codice ${esito.exitCode}`)
    }
    // macOS non ha /proc (grep 2 senza uscita): l'ambiente dei propri processi si legge con `ps eww`.
    if (esito.exitCode === 2 && esito.stdout === '') {
      const ps = await $.process.run(['ps', 'eww', '-o', 'pid=,command=', '-p', pid.join(',')], { timeoutMs: 10_000 })
      // ps: 1 se qualche pid non c'e piu.
      if (ps.exitCode > 1) throw new Error(`ps e terminato con codice ${ps.exitCode}`)

      return { dati: pidConSessioneDaPs(ps.stdout, sessioneId), avvisi: [] }
    }

    return { dati: pidConSessione(esito.stdout, sessioneId), avvisi: [] }
  })
}

/** Legge l'uscita di `grep -az -H`: `/proc/<pid>/environ:VAR=<id>` separati da NUL. */
export function pidConSessione(uscita: string, sessioneId: string): Set<number> {
  const pid = uscita
    .split('\0')
    .map(voce => /^\/proc\/(\d+)\/environ:[A-Z_]+=(.*)$/.exec(voce.trim()))
    .filter(m => m !== null && m[2] === sessioneId)
    .map(m => Number(m?.[1]))

  return new Set(pid)
}

/** Legge l'uscita di `ps eww -o pid=,command=` (macOS): pid in testa, ambiente in coda al comando. */
export function pidConSessioneDaPs(uscita: string, sessioneId: string): Set<number> {
  const pid = uscita
    .split('\n')
    .map(riga => /^\s*(\d+)\s(.*)$/.exec(riga))
    .filter(m => m !== null && m[2].split(/\s+/).includes(`${VARIABILE_SESSIONE}=${sessioneId}`))
    .map(m => Number(m?.[1]))

  return new Set(pid)
}

const CHIAVE_MEMORIA = 'regia.sessione.'
const SCADENZA_MEMORIA_MS = 30 * 24 * 3600 * 1000

function nomiDaMemoria(grezzo: unknown): string[] {
  const nomi = (grezzo as { nomi?: unknown } | undefined)?.nomi

  return Array.isArray(nomi) ? nomi.filter((n): n is string => typeof n === 'string') : []
}

/** Cio che la mod ricorda di una sessione: lavori Codex e subagenti conclusi. */
export type Memoria = { nomi: string[]; agenti: RicordoAgente[] }

export function leggiMemoria(
  $: EngineInterface,
  sessioneId: string,
): Promise<Lettura<Memoria>> {
  return provando<Memoria>('memoria della sessione', async () => {
    const grezzo = await $.store.get(`${CHIAVE_MEMORIA}${sessioneId}`)

    return { dati: { nomi: nomiDaMemoria(grezzo), agenti: ricordiDaMemoria(grezzo) }, avvisi: [] }
  })
}

export async function scriviMemoria(
  $: EngineInterface,
  sessioneId: string,
  memoria: Memoria,
  oraMs: number,
): Promise<string[]> {
  try {
    await $.store.set(`${CHIAVE_MEMORIA}${sessioneId}`, { ...memoria, aggiornatoMs: oraMs })

    return []
  } catch (errore) {
    return [`memoria della sessione: ${messaggioErrore(errore)}`]
  }
}

/** Toglie dallo store le memorie (lavori e agenti) di sessioni ferme da oltre 30 giorni. */
export async function potaMemorie($: EngineInterface, oraMs: number): Promise<string[]> {
  try {
    const chiavi = (await $.store.keys()).filter(k => k.startsWith(CHIAVE_MEMORIA) || k.startsWith(CHIAVE_AGENTI) || k.startsWith(CHIAVE_SCIAMI))
    await Promise.all(
      chiavi.map(async chiave => {
        const voce = (await $.store.get(chiave)) as { aggiornatoMs?: unknown } | { creatoMs?: unknown }[] | undefined
        const data = Array.isArray(voce) ? voce.at(-1)?.creatoMs : voce?.aggiornatoMs
        const ultimo = typeof data === 'number' ? data : 0
        if (oraMs - ultimo > SCADENZA_MEMORIA_MS) await $.store.delete(chiave)
      }),
    )

    return []
  } catch (errore) {
    return [`memoria delle sessioni: ${messaggioErrore(errore)}`]
  }
}

/** Le ultime `righe` righe di un file di log, con `tail` (il file puo essere grande). */
export function leggiCoda($: EngineInterface, percorso: string, righe: number): Promise<Lettura<string>> {
  return provando('log', async () => {
    if (!(await $.fs.exists(percorso))) throw new Error(`non trovato: ${percorso}`)
    const esito = await $.process.run(['tail', '-n', String(righe), percorso], { timeoutMs: 5_000 })
    if (esito.exitCode !== 0) throw new Error(`tail e terminato con codice ${esito.exitCode}`)

    return { dati: esito.stdout, avvisi: [] }
  })
}
