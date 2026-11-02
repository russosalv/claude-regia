// I tool che la mod offre al modello (principale e subagenti) e il recapito
// periodico della posta.

import type { EngineInterface, Timer } from 'claude-code'

import { DESCRIZIONE_AVVIA, NOME_TOOL_AVVIA, installaScript } from './codex-avvia'
import { SCHEMA_CODEX_AVVIA } from './codex'
import { DESCRIZIONE_RIPRENDI, NOME_TOOL_RIPRENDI, SCHEMA_RIPRENDI } from './codex-riprendi'
import { leggiHome } from './fonti'
import { messaggioErrore } from './parsers'
import { DESCRIZIONE_SCALETTA, SCHEMA_SCALETTA } from './scaletta'
import { STRUMENTI_SCIAME } from './sciame-motore'
import { DESCRIZIONE_INVIA, DESCRIZIONE_LEGGI, SCHEMA_INVIA, SCHEMA_LEGGI, recapita } from './posta-azioni'

const STRUMENTI = [
  { name: NOME_TOOL_AVVIA, description: DESCRIZIONE_AVVIA, inputSchema: SCHEMA_CODEX_AVVIA },
  { name: NOME_TOOL_RIPRENDI, description: DESCRIZIONE_RIPRENDI, inputSchema: SCHEMA_RIPRENDI },
  { name: 'posta_invia', description: DESCRIZIONE_INVIA, inputSchema: SCHEMA_INVIA },
  { name: 'posta_leggi', description: DESCRIZIONE_LEGGI, inputSchema: SCHEMA_LEGGI },
  { name: 'scaletta_scrivi', description: DESCRIZIONE_SCALETTA, inputSchema: SCHEMA_SCALETTA },
  ...STRUMENTI_SCIAME,
] as const

/**
 * Registra i tool, differiti: la mod e globale e i loro schemi non devono pesare
 * su ogni richiesta di ogni sessione. Se il motore ne rifiuta uno il cruscotto
 * funziona lo stesso.
 */
export async function registraStrumenti($: EngineInterface): Promise<void> {
  for (const s of STRUMENTI) {
    try {
      await $.tool.register({ ...s, isDeferred: true })
    } catch (errore) {
      $.ui.toast(`regia: tool ${s.name} non registrato (${messaggioErrore(errore)})`)
    }
  }
}

/** Copia (o aggiorna) la CLI `posta` in `~/.claude/regia/bin/`, dove Codex la trova. */
export async function installaPosta($: EngineInterface): Promise<void> {
  try {
    const home = await leggiHome($)
    if (home !== undefined) await installaScript($, home, 'posta')
  } catch (errore) {
    $.ui.toast(`regia: CLI posta non installata (${messaggioErrore(errore)})`)
  }
}

const RECAPITO_MS = 5_000
let postino: Timer | undefined

/** Ogni 5 secondi consegna ai Claude della sessione i messaggi lasciati da Codex. */
export function avviaPostino($: EngineInterface, dopo: () => void): void {
  if (postino !== undefined) return
  postino = $.clock.every(RECAPITO_MS, async () => {
    if ((await recapita($)) > 0) dopo()
  })
}

export function fermaPostino(): void {
  postino?.cancel()
  postino = undefined
}
