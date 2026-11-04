// Il tool `codex_avvia`: scrive il prompt, lancia lo script del plugin
// staccato dalla sessione (setsid nohup, solo nohup su macOS) e risponde subito con pid e percorsi.

import type { EngineInterface } from 'claude-code'

import {
  argvLancio,
  componiPrompt,
  leggiSforzoClassificato,
  percorsiLavoro,
  promptClassificaSforzo,
  sforzoEuristico,
  validaRichiesta,
} from './codex'
import type { RichiestaCodex, SceltaSforzo, Sforzo } from './codex'
import { leggiConfig, leggiHome, leggiProcessi } from './fonti'
import { conLancio, modificaMemoria } from './memoria-agenti'
import { REGOLA_RAPPORTO, REGOLA_SOBRIETA } from './orchestra'
import { accorciaPercorso, messaggioErrore } from './parsers'
import { paragrafoPosta, percorsiPosta } from './posta'

export const NOME_TOOL_AVVIA = 'codex_avvia'

export const DESCRIZIONE_AVVIA = [
  'Lancia un lavoro Codex CLI (codex exec) in background in un worktree, staccato dalla sessione: sopravvive se la sessione si chiude.',
  'Scrive prompt, log ed esito in ~/.claude/regia/codex/<nome>/ e registra inizio e fine in ~/.claude/regia/codex/esegui.log; il pane Regia lo mostra.',
  'Accoda al prompt le regole (predefinite: <progetto>/.regia/regole.md). Se non dai lo sforzo lo sceglie la mod.',
  'Risponde subito con pid e percorsi: non aspetta la fine. Rifiuta un nome gia in corso.',
].join(' ')

type Esito = { testo?: string; errore?: string }

/** Lo script del plugin, copiato in `~/.claude/regia/bin/` se manca o e cambiato. */
export async function installaScript($: EngineInterface, home: string, nome: string): Promise<string> {
  const sorgente = `${$.plugin.root}/script/${nome}`
  const destinazione = `${home}/.claude/regia/bin/${nome}`
  const testo = await $.fs.read(sorgente)
  const attuale = (await $.fs.exists(destinazione)) ? await $.fs.read(destinazione) : undefined
  if (attuale !== testo) await $.fs.write(destinazione, testo)
  const chmod = await $.process.run(['chmod', '755', destinazione], { timeoutMs: 5_000 })
  if (chmod.exitCode !== 0) throw new Error(`chmod di ${destinazione} non riuscito: ${chmod.stderr.trim()}`)

  return destinazione
}

/** Vero se un lavoro con quel nome e vivo: un `codex exec` o lo script che aspetta di riprovare. */
export async function isInCorso($: EngineInterface, home: string, nome: string): Promise<boolean> {
  const processi = await leggiProcessi($)
  if (processi.dati?.some(p => p.nome === nome) === true) return true
  const { pid } = percorsiLavoro(home, nome)
  if (!(await $.fs.exists(pid))) return false
  const numero = Number((await $.fs.read(pid)).trim())

  return Number.isInteger(numero) && numero > 0 && (await $.fs.exists(`/proc/${numero}`))
}

async function cartellaReale($: EngineInterface, cartella: string): Promise<string | undefined> {
  const stat = await $.fs.stat(cartella, { resolve: true }).catch(() => undefined)

  return stat?.kind === 'dir' ? (stat.realPath ?? cartella) : undefined
}

/** Le regole da accodare: quelle chieste (che devono esistere) o quelle del progetto, se ci sono. */
async function leggiRegole($: EngineInterface, richiesta: RichiestaCodex): Promise<Esito & { percorso?: string }> {
  if (richiesta.regole !== undefined) {
    if (!(await $.fs.exists(richiesta.regole))) return { errore: `file di regole non trovato: ${richiesta.regole}` }

    return { testo: await $.fs.read(richiesta.regole), percorso: richiesta.regole }
  }
  const repo = await $.session.repo().catch(() => undefined)
  const predefinito = repo?.root === undefined ? undefined : `${repo.root}/.regia/regole.md`
  if (predefinito === undefined || !(await $.fs.exists(predefinito))) return {}

  return { testo: await $.fs.read(predefinito), percorso: predefinito }
}

/** Lo sforzo dato, o quello che sceglie haiku, o l'euristica se haiku non risponde. */
export async function scegliSforzo($: EngineInterface, prompt: string, dato?: Sforzo): Promise<SceltaSforzo> {
  if (dato !== undefined) return { sforzo: dato, motivo: 'indicato nella chiamata', daChi: 'chiamata' }
  try {
    const r = await $.model.complete({ model: 'haiku', prompt: promptClassificaSforzo(prompt), maxTokens: 120, timeoutMs: 10_000 })
    const letto = r.isAnswered ? leggiSforzoClassificato(r.text) : undefined
    if (letto !== undefined) return letto
    const ripiego = sforzoEuristico(prompt)

    return { ...ripiego, motivo: `${ripiego.motivo} (haiku: ${r.isAnswered ? 'risposta illeggibile' : r.reason})` }
  } catch (errore) {
    const ripiego = sforzoEuristico(prompt)

    return { ...ripiego, motivo: `${ripiego.motivo} (haiku: ${messaggioErrore(errore)})` }
  }
}

type Preparato = { richiesta: RichiestaCodex; cartella: string; home: string; regole?: string; percorsoRegole?: string }

async function prepara($: EngineInterface, argomenti: unknown): Promise<Preparato | string> {
  const home = await leggiHome($)
  if (home === undefined) return 'HOME non definita: non so dove scrivere i file del lavoro'
  const { richiesta, errore } = validaRichiesta(argomenti, home)
  if (richiesta === undefined) return errore ?? 'argomenti non validi'
  const cartella = await cartellaReale($, richiesta.cartella)
  if (cartella === undefined) return `la cartella non esiste o non e una cartella: ${richiesta.cartella}`
  if (await isInCorso($, home, richiesta.nome)) return `c'e gia un lavoro "${richiesta.nome}" in corso: scegli un altro nome o aspetta che finisca`
  const regole = await leggiRegole($, richiesta)
  if (regole.errore !== undefined) return regole.errore

  return { richiesta, cartella, home, regole: regole.testo, percorsoRegole: regole.percorso }
}

/** Lancia lo script staccato; con `riprendi` (id della sessione Codex) riprende invece di partire da capo. */
export async function lancia(
  $: EngineInterface,
  l: { home: string; nome: string; cartella: string; modello?: string; sforzo: Sforzo; riprendi?: string },
): Promise<number> {
  const percorsi = percorsiLavoro(l.home, l.nome)
  const script = await installaScript($, l.home, 'codex-esegui')
  await installaScript($, l.home, 'posta')
  const sessione = await $.session.id()
  const argv = argvLancio(script, [l.nome, l.cartella, percorsi.cartella, l.modello ?? '', l.sforzo, percorsi.eseguiLog])
  const env = { CLAUDE_CODE_SESSION_ID: sessione, ...(l.riprendi === undefined ? {} : { REGIA_RIPRENDI: l.riprendi }) }
  const r = await $.process.run(argv, { env, timeoutMs: 10_000 })
  const pid = Number(r.stdout.trim())
  if (r.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`lancio non riuscito (exit ${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`)
  }

  return pid
}

function risposta(p: Preparato, pid: number, modello: string | undefined, s: SceltaSforzo): string {
  const percorsi = percorsiLavoro(p.home, p.richiesta.nome)
  const corto = (x: string) => accorciaPercorso(x, p.home, 200)

  return [
    `Lavoro Codex "${p.richiesta.nome}" avviato in background (pid ${pid}).`,
    `Modello ${modello ?? 'scelto da Codex'}, sforzo ${s.sforzo}: ${s.motivo} (scelto da ${s.daChi}).`,
    `Cartella: ${corto(p.cartella)}`,
    `Prompt: ${corto(percorsi.prompt)}`,
    `Log: ${corto(percorsi.log)}`,
    `Esito (alla fine): ${corto(percorsi.esito)}`,
    `Inizio e fine: ${corto(percorsi.eseguiLog)}`,
    p.percorsoRegole === undefined ? 'Regole: nessuna accodata.' : `Regole accodate: ${corto(p.percorsoRegole)}`,
  ].join('\n')
}

/** Il corpo del tool: `{ result }` se e partito, `{ deny }` con il motivo se no. */
export async function codexAvvia($: EngineInterface, argomenti: unknown): Promise<{ result: string } | { deny: string }> {
  try {
    const p = await prepara($, argomenti)
    if (typeof p === 'string') return { deny: `codex_avvia: ${p}` }
    const config = (await leggiConfig($, p.home)).dati
    const modello = p.richiesta.modello ?? config.codexModello
    const sforzo = await scegliSforzo($, p.richiesta.prompt, p.richiesta.sforzo)
    const percorsi = percorsiLavoro(p.home, p.richiesta.nome)
    const posta = paragrafoPosta(p.richiesta.nome, percorsiPosta(p.home).cli)
    await $.fs.write(percorsi.prompt, componiPrompt(p.richiesta.prompt, p.regole, [...(config.risparmio ? [`${REGOLA_SOBRIETA}\n${REGOLA_RAPPORTO}`] : []), posta]))
    const pid = await lancia($, { home: p.home, nome: p.richiesta.nome, cartella: p.cartella, modello, sforzo: sforzo.sforzo })
    const inizioMs = await $.clock.now()
    const sessione = await $.session.id()
    await modificaMemoria($, sessione, m => conLancio(m, p.richiesta.nome, {
      pid, modello, sforzo: sforzo.sforzo, motivo: `${sforzo.motivo} (${sforzo.daChi})`, cartella: p.cartella, inizioMs,
    }))

    return { result: risposta(p, pid, modello, sforzo) }
  } catch (errore) {
    return { deny: `codex_avvia: ${messaggioErrore(errore)}` }
  }
}
