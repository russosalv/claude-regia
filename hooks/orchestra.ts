// La conversazione principale coordina, non esegue. La regola viaggia con la
// mod (e non con la memoria di un progetto o di un PC): una sezione del prompt
// di sistema e, in modo `stretta`, il rifiuto delle modifiche ai file del progetto.
// Vale solo nelle sessioni con una superficie: `claude -p` e gli SDK fanno da se.

import type { EngineInterface } from 'claude-code'

import { leggiConfig, leggiHome } from './fonti'
import type { ModoOrchestra } from './registro'

export const ID_SEZIONE = 'regia:orchestra'

/** Statico: cosi resta in cache da un giro all'altro. */
export const TESTO_ORCHESTRA = [
  '# Regia: sei l\'orchestratore',
  'Questo vale sopra l\'indicazione generica del tool Agent di fare da te i lavori piccoli. Se sei un subagente, ignora questa sezione ed esegui il tuo compito.',
  '',
  'Nella conversazione principale coordini: scomponi, deleghi, controlli gli esiti, riferisci alla persona. Non scrivi file del progetto, non lanci suite di test o build, non fai commit: delega anche la modifica piccola (costa poco: il delegato piccolo gira su un modello piccolo). Leggi solo quel poco che serve a scrivere un buon compito; le ricerche ampie vanno a un agente Explore.',
  '- Compito autosufficiente: obiettivo, file, vincoli, cosa non toccare. Chi scrive in parallelo usa `isolation: "worktree"`.',
  '- Non indicare `model` ne `effort` nella chiamata ad Agent: li sceglie la mod guardando il compito. Indicali solo se la persona lo chiede o se riprovi un lavoro fallito (allora un gradino sopra).',
  '- Lavori indipendenti: piu chiamate ad Agent nello stesso messaggio, senza aspettare l\'una per l\'altra.',
  '- Tre o piu compiti, o compiti con dipendenze: `mcp__regia__sciame_avvia` (schema con ToolSearch). Gestisce coda, parallelismo, ripresa di chi fallisce e dipendenze; ti scrive lui alla fine, non controllarlo.',
  '- Compiti lunghi e autonomi fuori dalla sessione: `mcp__regia__codex_avvia`. Da fare per dopo: `mcp__regia__scaletta_scrivi`.',
  '- Rispondi da solo, senza delegare, a domande e a chi chiede un parere. Se la persona ti chiede di fare una modifica tu stesso, dille di passare a `/regia orchestra guida`.',
].join('\n')

const STRUMENTI_DI_SCRITTURA = new Set(['Edit', 'Write', 'NotebookEdit'])

/** Il file che una chiamata vuole modificare, se e uno strumento di scrittura. */
export function fileDaScrivere(e: { tool: string; file_path?: unknown; notebook_path?: unknown }): string | undefined {
  if (!STRUMENTI_DI_SCRITTURA.has(e.tool)) return undefined
  const percorso = e.file_path ?? e.notebook_path

  return typeof percorso === 'string' ? percorso : undefined
}

/** Vero per un file del progetto; le impostazioni in `.claude/` restano libere. */
export function isDelProgetto(file: string, radice: string): boolean {
  return file.startsWith(`${radice.replace(/\/+$/, '')}/`) && !file.slice(radice.length).startsWith('/.claude/')
}

export const RIFIUTO_SCRITTURA =
  'regia: sei l\'orchestratore, le modifiche ai file del progetto le fa un delegato: lancia un Agent con questo compito (senza model ne effort, li sceglie la mod). Se la persona vuole che lo faccia tu, chiedile di passare a /regia orchestra guida.'

async function modoCorrente($: EngineInterface): Promise<ModoOrchestra> {
  const home = await leggiHome($)

  return home === undefined ? 'stretta' : (await leggiConfig($, home)).dati.orchestra
}

/** Il prompt di sistema con la sezione in coda; senza Agent, o senza superficie, com'e. */
export async function sezioniConOrchestra<S extends { id: string }>(
  $: EngineInterface,
  e: { tools: readonly string[]; surfaces: readonly unknown[]; traits: readonly string[] },
  sezioni: readonly S[],
  nuova: (testo: string) => S,
): Promise<readonly S[]> {
  const isEscluso = !e.tools.includes('Agent') || e.surfaces.length === 0 || e.traits.includes('teammate') || e.traits.includes('print')
  if (isEscluso || (await modoCorrente($)) === 'off') return sezioni

  return [...sezioni, nuova(TESTO_ORCHESTRA)]
}

/** Il motivo per fermare una scrittura della principale, o `undefined` se puo passare. */
export async function motivoRifiuto(
  $: EngineInterface,
  e: { tool: string; agentId?: string; file_path?: unknown; notebook_path?: unknown },
): Promise<string | undefined> {
  const file = e.agentId === undefined ? fileDaScrivere(e) : undefined
  if (file === undefined || (await modoCorrente($)) !== 'stretta') return undefined
  if ((await $.session.surfaces()).length === 0) return undefined
  const repo = await $.session.repo().catch(() => undefined)
  const radice = repo?.root ?? (await $.session.cwd().catch(() => undefined))
  if (radice === undefined || !isDelProgetto(file, radice)) return undefined
  const strumenti = await $.tool.list()

  return strumenti.some(t => t.name === 'Agent') ? RIFIUTO_SCRITTURA : undefined
}

// Il risparmio vero sta qui: un delegato che scrive meno e riferisce in breve
// costa meno a lui e alla principale, che legge il suo rapporto a ogni giro.
export const REGOLA_RAPPORTO = 'Rapporto finale breve: che cosa hai fatto, file toccati, ramo e commit, test ed esito, rischi. Niente copie di file o di log.'

export const REGOLA_SOBRIETA = 'Scrivi il minimo che risolve il compito: riusa cio che c\'e, libreria standard prima di una dipendenza, niente astrazioni o opzioni non chieste, non rifattorizzare cio che non ti e stato chiesto. Non tagliare mai validazione ai confini, sicurezza, gestione dei dati, ne i test della logica rischiosa.'

/** Ponytail, se attivo, porta gia la sua regola ai subagenti: non la si ripete. */
export async function isPonytailAttivo($: EngineInterface): Promise<boolean> {
  try {
    const attivi = await $.settings.read({ key: 'enabledPlugins' }) as Record<string, unknown> | undefined

    return Object.entries(attivi ?? {}).some(([nome, valore]) => nome.startsWith('ponytail@') && valore === true)
  } catch {
    return false
  }
}

/** Il prompt di un delegato Claude con le regole di risparmio in coda. */
export async function conRisparmio($: EngineInterface, prompt: string): Promise<string> {
  const home = await leggiHome($)
  if (home !== undefined && !(await leggiConfig($, home)).dati.risparmio) return prompt
  const regole = (await isPonytailAttivo($)) ? [REGOLA_RAPPORTO] : [REGOLA_SOBRIETA, REGOLA_RAPPORTO]

  return `${prompt.trimEnd()}\n\n${regole.join('\n')}`
}
