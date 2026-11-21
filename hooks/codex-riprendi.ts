// Il tool `codex_riprendi`: un lavoro Codex finito riceve un nuovo messaggio
// con `codex exec resume <sessione>`, lanciato come `codex_avvia` (staccato,
// con le righe in esegui.log). La sessione Codex si legge dal suo log.

import type { EngineInterface } from 'claude-code'

import { isInCorso, lancia } from './codex-avvia'
import { ESECUTORI_CLI, NOME_CLI, QODER_MODELLO_PREDEFINITO, SFORZI, componiPrompt, intestazioneLog, isNomeValido, percorsiLavoro } from './codex'
import type { EsecutoreCli, Sforzo } from './codex'
import { leggiConfig, leggiHome } from './fonti'
import { conLancio, leggiMemoriaAgenti, modificaMemoria } from './memoria-agenti'
import { cartellaDi, messaggioErrore } from './parsers'
import { paragrafoPosta, percorsiPosta } from './posta'

export const NOME_TOOL_RIPRENDI = 'codex_riprendi'

export const DESCRIZIONE_RIPRENDI = [
  'Riprende un lavoro Codex gia finito (codex exec resume) mandandogli un nuovo messaggio: Codex continua la stessa sessione, con il suo contesto.',
  'Parte staccato come codex_avvia e risponde subito; il log del giro prima resta in <nome>.storico.log. Rifiuta un lavoro ancora in corso.',
].join(' ')

export const NOME_TOOL_QWEN_RIPRENDI = 'qwen_riprendi'

export const DESCRIZIONE_QWEN_RIPRENDI = [
  'Riprende un lavoro Qwen gia finito (qwen --resume) mandandogli un nuovo messaggio: Qwen continua la stessa sessione, con il suo contesto.',
  'Parte staccato come qwen_avvia, con lo stesso permesso del primo giro, e risponde subito. Rifiuta un lavoro ancora in corso.',
].join(' ')

export const NOME_TOOL_QODER_RIPRENDI = 'qoder_riprendi'

export const DESCRIZIONE_QODER_RIPRENDI = [
  'Riprende un lavoro Qoder gia finito (qodercli --resume <id>) mandandogli un nuovo messaggio: Qoder continua la stessa sessione, con il suo contesto.',
  'Parte staccato come qoder_avvia, con lo stesso permesso del primo giro, e risponde subito. Rifiuta un lavoro ancora in corso.',
].join(' ')

export const NOME_TOOL_COPILOT_RIPRENDI = 'copilot_riprendi'

export const DESCRIZIONE_COPILOT_RIPRENDI = [
  'Riprende un lavoro Copilot gia finito (copilot --resume=<id>) mandandogli un nuovo messaggio: Copilot continua la stessa sessione, con il suo contesto.',
  'Parte staccato come copilot_avvia, con lo stesso permesso del primo giro, e risponde subito. Rifiuta un lavoro ancora in corso.',
].join(' ')

export const SCHEMA_RIPRENDI = {
  type: 'object',
  properties: {
    nome: { type: 'string', description: 'Il nome del lavoro Codex, come nel pane.' },
    messaggio: { type: 'string', description: 'Il nuovo messaggio per Codex.' },
  },
  required: ['nome', 'messaggio'],
  additionalProperties: false,
} as const

/** Il log del lavoro e di quale CLI e: quello di codex_avvia, qwen_avvia, copilot_avvia o qoder_avvia, o quello accanto a uno dei log degli script. */
async function trovaLog($: EngineInterface, home: string, nome: string): Promise<{ log: string; esecutore: EsecutoreCli } | undefined> {
  const { codexLogs } = (await leggiConfig($, home)).dati
  const candidati = [
    ...ESECUTORI_CLI.map(esecutore => ({ log: percorsiLavoro(home, nome, esecutore).log, esecutore })),
    ...codexLogs.map(l => ({ log: `${cartellaDi(l)}/${nome}.log`, esecutore: 'codex' as const })),
  ]
  for (const c of candidati) {
    if (await $.fs.exists(c.log)) return c
  }

  return undefined
}

type Ripresa = { sessione: string; cartella: string; modello?: string; sforzo: Sforzo | ''; esecutore: EsecutoreCli; permesso?: 'auto' | 'default' }

async function leggiSeEsiste($: EngineInterface, percorso: string): Promise<string | undefined> {
  return (await $.fs.exists(percorso)) ? (await $.fs.read(percorso)).trim() : undefined
}

/** Qwen, Copilot e Qoder non hanno un'intestazione nel log: sessione, cartella e permesso li ha scritti lo script accanto al log. */
async function datiRipresaQwen($: EngineInterface, home: string, nome: string, esecutore: Exclude<EsecutoreCli, 'codex'>): Promise<Ripresa | string> {
  const p = percorsiLavoro(home, nome, esecutore)
  const sessione = await leggiSeEsiste($, p.sessione)
  if (sessione === undefined || !/^[0-9a-f-]{8,64}$/i.test(sessione)) return `non trovo l'id della sessione ${NOME_CLI[esecutore]} di "${nome}"`
  const cartella = await leggiSeEsiste($, p.cartellaLavoro)
  if (cartella === undefined || !(await $.fs.exists(cartella))) return `la cartella del lavoro "${nome}" non esiste piu`
  const lancio = (await leggiMemoriaAgenti($, await $.session.id())).dati.lanci[nome]
  const permesso = (await leggiSeEsiste($, p.permesso)) === 'default' ? 'default' : 'auto'
  const sforzo = SFORZI.find(s => s === lancio?.sforzo) ?? ''

  // Senza la memoria dei lanci (altra sessione) Qoder riprende con il suo modello predefinito, non con `Auto` (la scelta automatica di Qoder).
  const modello = lancio?.modello ?? (esecutore === 'qoder' ? (await leggiConfig($, home)).dati.qoderModello ?? QODER_MODELLO_PREDEFINITO : undefined)

  return { sessione, cartella, modello, sforzo, esecutore, permesso }
}

async function datiRipresa($: EngineInterface, home: string, nome: string): Promise<Ripresa | string> {
  const trovato = await trovaLog($, home, nome)
  if (trovato === undefined) return `non trovo il log del lavoro "${nome}"`
  if (trovato.esecutore !== 'codex') return datiRipresaQwen($, home, nome, trovato.esecutore)
  const { log } = trovato
  const testa = intestazioneLog(await $.fs.read(log))
  const fileSessione = percorsiLavoro(home, nome).sessione
  const salvata = (await $.fs.exists(fileSessione)) ? (await $.fs.read(fileSessione)).trim() : undefined
  const sessione = salvata || testa.sessione
  if (sessione === undefined || !/^[0-9a-f-]{8,64}$/i.test(sessione)) return `nel log di "${nome}" non c'e l'id della sessione Codex`
  if (testa.cartella === undefined || !(await $.fs.exists(testa.cartella))) return `la cartella del lavoro "${nome}" non esiste piu`
  const lancio = (await leggiMemoriaAgenti($, await $.session.id())).dati.lanci[nome]
  const config = (await leggiConfig($, home)).dati
  const sforzo = SFORZI.find(s => s === (lancio?.sforzo ?? testa.sforzo)) ?? 'medium'

  return { sessione, cartella: testa.cartella, modello: lancio?.modello ?? testa.modello ?? config.codexModello, sforzo, esecutore: 'codex' }
}

/** Il corpo dei tool `codex_riprendi`, `qwen_riprendi`, `copilot_riprendi` e `qoder_riprendi` (e del tasto ↻ riprendi): la CLI la dice il log del lavoro. */
export async function codexRiprendi($: EngineInterface, grezzi: unknown, tool = NOME_TOOL_RIPRENDI): Promise<{ result: string } | { deny: string }> {
  try {
    const argomenti = (typeof grezzi === 'object' && grezzi !== null ? grezzi : {}) as { nome?: unknown; messaggio?: unknown }
    const nome = typeof argomenti.nome === 'string' ? argomenti.nome.trim() : undefined
    const messaggio = typeof argomenti.messaggio === 'string' ? argomenti.messaggio : ''
    if (!isNomeValido(nome)) return { deny: `${tool}: nome non valido` }
    if (messaggio.trim() === '') return { deny: `${tool}: il messaggio e vuoto` }
    const home = await leggiHome($)
    if (home === undefined) return { deny: `${tool}: HOME non definita` }
    if (await isInCorso($, home, nome)) return { deny: `${tool}: "${nome}" e ancora in corso: scrivigli con posta_invia` }
    const r = await datiRipresa($, home, nome)
    if (typeof r === 'string') return { deny: `${tool}: ${r}` }
    const percorsi = percorsiLavoro(home, nome, r.esecutore)
    await $.fs.write(percorsi.riprendi, componiPrompt(messaggio, undefined, [paragrafoPosta(nome, percorsiPosta(home).cli)]))
    const pid = await lancia($, { home, nome, cartella: r.cartella, modello: r.modello, sforzo: r.sforzo, riprendi: r.sessione, esecutore: r.esecutore, permesso: r.permesso })
    const inizioMs = await $.clock.now()
    await modificaMemoria($, await $.session.id(), m => conLancio(m, nome, {
      pid, modello: r.modello, sforzo: r.sforzo, motivo: 'ripresa', cartella: r.cartella, inizioMs,
    }))

    const cli = NOME_CLI[r.esecutore]

    return { result: `Lavoro ${cli} "${nome}" ripreso (sessione ${r.sessione}, pid ${pid}, ${r.modello ?? `modello di ${cli}`} ${r.sforzo}). Log: ${percorsi.log}; esito: ${percorsi.esito}.` }
  } catch (errore) {
    return { deny: `${tool}: ${messaggioErrore(errore)}` }
  }
}
