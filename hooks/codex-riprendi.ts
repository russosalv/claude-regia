// Il tool `codex_riprendi`: un lavoro Codex finito riceve un nuovo messaggio
// con `codex exec resume <sessione>`, lanciato come `codex_avvia` (staccato,
// con le righe in esegui.log). La sessione Codex si legge dal suo log.

import type { EngineInterface } from 'claude-code'

import { isInCorso, lancia } from './codex-avvia'
import { SFORZI, componiPrompt, intestazioneLog, isNomeValido, percorsiLavoro } from './codex'
import type { Sforzo } from './codex'
import { leggiConfig, leggiHome } from './fonti'
import { conLancio, leggiMemoriaAgenti, modificaMemoria } from './memoria-agenti'
import { cartellaDi, messaggioErrore } from './parsers'
import { paragrafoPosta, percorsiPosta } from './posta'

export const NOME_TOOL_RIPRENDI = 'codex_riprendi'

export const DESCRIZIONE_RIPRENDI = [
  'Riprende un lavoro Codex gia finito (codex exec resume) mandandogli un nuovo messaggio: Codex continua la stessa sessione, con il suo contesto.',
  'Parte staccato come codex_avvia e risponde subito; il log del giro prima resta in <nome>.storico.log. Rifiuta un lavoro ancora in corso.',
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

/** Il log del lavoro: quello di codex_avvia, o quello accanto a uno dei log degli script. */
async function trovaLog($: EngineInterface, home: string, nome: string): Promise<string | undefined> {
  const { codexLogs } = (await leggiConfig($, home)).dati
  const candidati = [percorsiLavoro(home, nome).log, ...codexLogs.map(l => `${cartellaDi(l)}/${nome}.log`)]
  for (const percorso of candidati) {
    if (await $.fs.exists(percorso)) return percorso
  }

  return undefined
}

type Ripresa = { sessione: string; cartella: string; modello?: string; sforzo: Sforzo }

async function datiRipresa($: EngineInterface, home: string, nome: string): Promise<Ripresa | string> {
  const log = await trovaLog($, home, nome)
  if (log === undefined) return `non trovo il log del lavoro "${nome}"`
  const testa = intestazioneLog(await $.fs.read(log))
  const fileSessione = percorsiLavoro(home, nome).sessione
  const salvata = (await $.fs.exists(fileSessione)) ? (await $.fs.read(fileSessione)).trim() : undefined
  const sessione = salvata || testa.sessione
  if (sessione === undefined || !/^[0-9a-f-]{8,64}$/i.test(sessione)) return `nel log di "${nome}" non c'e l'id della sessione Codex`
  if (testa.cartella === undefined || !(await $.fs.exists(testa.cartella))) return `la cartella del lavoro "${nome}" non esiste piu`
  const lancio = (await leggiMemoriaAgenti($, await $.session.id())).dati.lanci[nome]
  const config = (await leggiConfig($, home)).dati
  const sforzo = SFORZI.find(s => s === (lancio?.sforzo ?? testa.sforzo)) ?? 'medium'

  return { sessione, cartella: testa.cartella, modello: lancio?.modello ?? testa.modello ?? config.codexModello, sforzo }
}

/** Il corpo del tool (e del tasto ↻ riprendi). */
export async function codexRiprendi($: EngineInterface, grezzi: unknown): Promise<{ result: string } | { deny: string }> {
  try {
    const argomenti = (typeof grezzi === 'object' && grezzi !== null ? grezzi : {}) as { nome?: unknown; messaggio?: unknown }
    const nome = typeof argomenti.nome === 'string' ? argomenti.nome.trim() : undefined
    const messaggio = typeof argomenti.messaggio === 'string' ? argomenti.messaggio : ''
    if (!isNomeValido(nome)) return { deny: 'codex_riprendi: nome non valido' }
    if (messaggio.trim() === '') return { deny: 'codex_riprendi: il messaggio e vuoto' }
    const home = await leggiHome($)
    if (home === undefined) return { deny: 'codex_riprendi: HOME non definita' }
    if (await isInCorso($, home, nome)) return { deny: `codex_riprendi: "${nome}" e ancora in corso: scrivigli con posta_invia` }
    const r = await datiRipresa($, home, nome)
    if (typeof r === 'string') return { deny: `codex_riprendi: ${r}` }
    const percorsi = percorsiLavoro(home, nome)
    await $.fs.write(percorsi.riprendi, componiPrompt(messaggio, undefined, [paragrafoPosta(nome, percorsiPosta(home).cli)]))
    const pid = await lancia($, { home, nome, cartella: r.cartella, modello: r.modello, sforzo: r.sforzo, riprendi: r.sessione })
    const inizioMs = await $.clock.now()
    await modificaMemoria($, await $.session.id(), m => conLancio(m, nome, {
      pid, modello: r.modello, sforzo: r.sforzo, motivo: 'ripresa', cartella: r.cartella, inizioMs,
    }))

    return { result: `Lavoro Codex "${nome}" ripreso (sessione ${r.sessione}, pid ${pid}, ${r.modello ?? 'modello di Codex'} ${r.sforzo}). Log: ${percorsi.log}; esito: ${percorsi.esito}.` }
  } catch (errore) {
    return { deny: `codex_riprendi: ${messaggioErrore(errore)}` }
  }
}
