// Il tool `codex_avvia`: scrive il prompt, lancia lo script del plugin
// staccato dalla sessione (setsid nohup, solo nohup su macOS) e risponde subito con pid e percorsi.

import type { EngineInterface } from 'claude-code'

import {
  ESECUTORI_CLI,
  NOME_CLI,
  argvLancio,
  componiPrompt,
  permessoQwen,
  leggiSforzoClassificato,
  messaggioSpento,
  percorsiLavoro,
  promptClassificaSforzo,
  sforzoEuristico,
  validaRichiesta,
} from './codex'
import type { EsecutoreCli, RichiestaCodex, SceltaSforzo, Sforzo } from './codex'
import { leggiConfig, leggiHome, leggiProcessi } from './fonti'
import { conLancio, modificaMemoria } from './memoria-agenti'
import { REGOLA_RAPPORTO, REGOLA_SOBRIETA } from './orchestra'
import { accorciaPercorso, messaggioErrore } from './parsers'
import { paragrafoPosta, percorsiPosta } from './posta'

export const NOME_TOOL_AVVIA = 'codex_avvia'

/** I tre tool diretti servono a chi nomina l'esecutore: altrimenti chi lavora lo decide la squadra impostata. */
const PER_CHI_LO_CHIEDE = 'Usalo quando la persona chiede proprio questo esecutore; altrimenti il compito va a un subagente (Agent) o in uno sciame senza `esecutore`, e chi lo fa lo decide la mod secondo la squadra impostata (/regia team). Rifiuta un esecutore spento in config (/regia executors).'

export const DESCRIZIONE_AVVIA = [
  'Lancia un lavoro Codex CLI (codex exec) in background in un worktree, staccato dalla sessione: sopravvive se la sessione si chiude.',
  'Scrive prompt, log ed esito in ~/.claude/regia/codex/<nome>/ e registra inizio e fine in ~/.claude/regia/codex/esegui.log; il pane Regia lo mostra.',
  'Accoda al prompt le regole (predefinite: <progetto>/.regia/regole.md). Se non dai lo sforzo lo sceglie la mod.',
  'Risponde subito con pid e percorsi: non aspetta la fine. Rifiuta un nome gia in corso.',
  PER_CHI_LO_CHIEDE,
].join(' ')

export const NOME_TOOL_QWEN_AVVIA = 'qwen_avvia'

export const DESCRIZIONE_QWEN_AVVIA = [
  'Lancia un lavoro Qwen Code (qwen -p) in background in una cartella, staccato dalla sessione: sopravvive se la sessione si chiude. Gemello di codex_avvia.',
  'Scrive prompt, log ed esito in ~/.claude/regia/qwen/<nome>/ e registra inizio e fine in ~/.claude/regia/qwen/esegui.log; il pane Regia lo mostra come i Codex.',
  'Con scrive=true (predefinito) Qwen puo cambiare file e lanciare comandi (permesso auto); con scrive=false solo leggere (permesso default).',
  'Accoda al prompt le regole (predefinite: <progetto>/.regia/regole.md). Risponde subito con pid e percorsi. Rifiuta un nome gia in corso.',
  PER_CHI_LO_CHIEDE,
].join(' ')

export const NOME_TOOL_COPILOT_AVVIA = 'copilot_avvia'

export const DESCRIZIONE_COPILOT_AVVIA = [
  'Lancia un lavoro GitHub Copilot CLI (copilot, prompt da stdin) in background in una cartella, staccato dalla sessione: sopravvive se la sessione si chiude. Gemello di codex_avvia.',
  'Scrive prompt, log ed esito in ~/.claude/regia/copilot/<nome>/ e registra inizio e fine in ~/.claude/regia/copilot/esegui.log; il pane Regia lo mostra come i Codex.',
  'Con scrive=true (predefinito) Copilot puo cambiare file e lanciare comandi (--allow-all-tools --allow-all-paths); con scrive=false solo leggere (--deny-tool=write, nessun permesso in piu).',
  'Accoda al prompt le regole (predefinite: <progetto>/.regia/regole.md). Risponde subito con pid e percorsi. Rifiuta un nome gia in corso.',
  PER_CHI_LO_CHIEDE,
].join(' ')

const TOOL_AVVIA: Readonly<Record<EsecutoreCli, string>> = { codex: NOME_TOOL_AVVIA, qwen: NOME_TOOL_QWEN_AVVIA, copilot: NOME_TOOL_COPILOT_AVVIA }

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

/** Vero se un lavoro con quel nome e vivo (Codex, Qwen o Copilot): il processo, o lo script che aspetta di riprovare. */
export async function isInCorso($: EngineInterface, home: string, nome: string): Promise<boolean> {
  const processi = await leggiProcessi($)
  if (processi.dati?.some(p => p.nome === nome) === true) return true
  for (const esecutore of ESECUTORI_CLI) {
    const { pid } = percorsiLavoro(home, nome, esecutore)
    if (!(await $.fs.exists(pid))) continue
    const numero = Number((await $.fs.read(pid)).trim())
    if (Number.isInteger(numero) && numero > 0 && (await $.fs.exists(`/proc/${numero}`))) return true
  }

  return false
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

/**
 * Lancia lo script staccato; con `riprendi` (id della sessione della CLI) riprende invece di partire da capo.
 * `permesso` e solo di Qwen e Copilot (`auto` o `default`); `sforzo` vuoto lascia decidere alla CLI.
 */
export async function lancia(
  $: EngineInterface,
  l: { home: string; nome: string; cartella: string; modello?: string; sforzo: Sforzo | ''; riprendi?: string; esecutore?: EsecutoreCli; permesso?: 'auto' | 'default' },
): Promise<number> {
  const esecutore = l.esecutore ?? 'codex'
  const percorsi = percorsiLavoro(l.home, l.nome, esecutore)
  const script = await installaScript($, l.home, `${esecutore}-esegui`)
  await installaScript($, l.home, 'posta')
  const sessione = await $.session.id()
  const argv = argvLancio(script, [
    l.nome, l.cartella, percorsi.cartella, l.modello ?? '', l.sforzo, percorsi.eseguiLog,
    ...(esecutore === 'codex' ? [] : [l.permesso ?? 'auto']),
  ])
  const env = { CLAUDE_CODE_SESSION_ID: sessione, ...(l.riprendi === undefined ? {} : { REGIA_RIPRENDI: l.riprendi }) }
  const r = await $.process.run(argv, { env, timeoutMs: 10_000 })
  const pid = Number(r.stdout.trim())
  if (r.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`lancio non riuscito (exit ${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`)
  }

  return pid
}

type Scelta = Omit<SceltaSforzo, 'sforzo'> & { sforzo: Sforzo | '' }

function risposta(p: Preparato, pid: number, modello: string | undefined, s: Scelta, esecutore: EsecutoreCli): string {
  const percorsi = percorsiLavoro(p.home, p.richiesta.nome, esecutore)
  const corto = (x: string) => accorciaPercorso(x, p.home, 200)
  const cli = NOME_CLI[esecutore]
  const permesso = esecutore === 'codex' ? undefined : `Permesso ${permessoQwen(p.richiesta.scrive)} (${p.richiesta.scrive === false ? 'solo lettura' : 'puo scrivere e lanciare comandi'}).`

  return [
    `Lavoro ${cli} "${p.richiesta.nome}" avviato in background (pid ${pid}).`,
    s.sforzo === ''
      ? `Modello ${modello ?? `scelto da ${cli}`}, sforzo deciso da ${cli}.`
      : `Modello ${modello ?? `scelto da ${cli}`}, sforzo ${s.sforzo}: ${s.motivo} (scelto da ${s.daChi}).`,
    ...(permesso === undefined ? [] : [permesso]),
    `Cartella: ${corto(p.cartella)}`,
    `Prompt: ${corto(percorsi.prompt)}`,
    `Log: ${corto(percorsi.log)}`,
    `Esito (alla fine): ${corto(percorsi.esito)}`,
    `Inizio e fine: ${corto(percorsi.eseguiLog)}`,
    p.percorsoRegole === undefined ? 'Regole: nessuna accodata.' : `Regole accodate: ${corto(p.percorsoRegole)}`,
  ].join('\n')
}

/** Lo sforzo di Qwen e di Copilot: quello dato, o nessuno (decide la CLI): niente giudizio di haiku per un solo flag. */
function sforzoQwen(dato: Sforzo | undefined): Scelta {
  return dato === undefined
    ? { sforzo: '', motivo: 'non indicato', daChi: 'chiamata' }
    : { sforzo: dato, motivo: 'indicato nella chiamata', daChi: 'chiamata' }
}

/**
 * Il corpo del tool: `{ result }` se e partito, `{ deny }` con il motivo se no.
 * `esecutore` sceglie la CLI: `codex_avvia` (predefinito), `qwen_avvia` o `copilot_avvia`.
 */
export async function codexAvvia(
  $: EngineInterface,
  argomenti: unknown,
  esecutore: EsecutoreCli = 'codex',
): Promise<{ result: string } | { deny: string }> {
  const tool = TOOL_AVVIA[esecutore]
  try {
    const p = await prepara($, argomenti)
    if (typeof p === 'string') return { deny: `${tool}: ${p}` }
    const config = (await leggiConfig($, p.home)).dati
    if (!config.esecutori.includes(esecutore)) return { deny: `${tool}: ${messaggioSpento(esecutore)}` }
    const daConfig = esecutore === 'codex' ? config.codexModello : esecutore === 'copilot' ? config.copilotModello : undefined
    const modello = p.richiesta.modello ?? daConfig
    const sforzo: Scelta = esecutore === 'codex' ? await scegliSforzo($, p.richiesta.prompt, p.richiesta.sforzo) : sforzoQwen(p.richiesta.sforzo)
    const percorsi = percorsiLavoro(p.home, p.richiesta.nome, esecutore)
    const posta = paragrafoPosta(p.richiesta.nome, percorsiPosta(p.home).cli)
    await $.fs.write(percorsi.prompt, componiPrompt(p.richiesta.prompt, p.regole, [...(config.risparmio ? [`${REGOLA_SOBRIETA}\n${REGOLA_RAPPORTO}`] : []), posta]))
    const pid = await lancia($, {
      home: p.home, nome: p.richiesta.nome, cartella: p.cartella, modello, sforzo: sforzo.sforzo, esecutore,
      ...(esecutore === 'codex' ? {} : { permesso: permessoQwen(p.richiesta.scrive) }),
    })
    const inizioMs = await $.clock.now()
    const sessione = await $.session.id()
    await modificaMemoria($, sessione, m => conLancio(m, p.richiesta.nome, {
      pid, modello, sforzo: sforzo.sforzo, motivo: `${sforzo.motivo} (${sforzo.daChi})`, cartella: p.cartella, inizioMs,
    }))

    return { result: risposta(p, pid, modello, sforzo, esecutore) }
  } catch (errore) {
    return { deny: `${tool}: ${messaggioErrore(errore)}` }
  }
}
