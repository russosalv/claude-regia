// Le dipendenze della mod: quando la mod e nuova o aggiornata, la prima sessione
// interattiva installa Ponytail e, se le loro CLI ci sono, i plugin di Codex e
// di Qwen per Claude Code, se mancano, una volta per versione. Dopo vivono di
// vita sua: la mod non lo aggiorna e, se viene tolto, non lo rimette fino alla
// versione successiva. Chi non li vuole ha `/regia ponytail|codex|qwen off`.
// Questi comandi riguardano solo i plugin: gli esecutori Codex, Qwen, Copilot e Qoder
// (sciame e `*_avvia`) si accendono e si spengono con `/regia executors`.

import type { EngineInterface } from 'claude-code'

import { scriviChiave } from './comando-opzioni'
import { versioneMod } from './doctor'
import { leggiConfig, leggiHome } from './fonti'
import { messaggioErrore } from './parsers'

/** Un plugin che la mod installa se manca. `cli`: solo se quel comando c'e sul PC. */
type Dipendenza = { nome: 'ponytail' | 'codex' | 'qwen'; chiave: 'ponytail' | 'pluginCodex' | 'pluginQwen'; marketplace: string; plugin: string; cli?: string; fatto: string }

const DIPENDENZE: readonly Dipendenza[] = [
  {
    nome: 'ponytail', chiave: 'ponytail', marketplace: 'DietrichGebert/ponytail', plugin: 'ponytail@ponytail',
    fatto: 'Ponytail installato: si carica dalla prossima sessione. /ponytail band off nasconde la sua barra, /regia ponytail off evita che la mod lo installi.',
  },
  {
    nome: 'codex', chiave: 'pluginCodex', marketplace: 'openai/codex-plugin-cc', plugin: 'codex@openai-codex', cli: 'codex',
    fatto: 'Plugin Codex (OpenAI) installato: si carica dalla prossima sessione. /regia codex off evita che la mod lo installi.',
  },
  {
    // Non esiste un plugin ufficiale di Qwen per Claude Code: questo e quello della comunita.
    nome: 'qwen', chiave: 'pluginQwen', marketplace: 'josephyaduvanshi/qwen-companion', plugin: 'qwen@qwen-companion', cli: 'qwen',
    fatto: 'Plugin Qwen (qwen-companion) installato: si carica dalla prossima sessione. /regia qwen off evita che la mod lo installi.',
  },
]
const ATTESA_MS = 120_000
/** In `$.store`: la versione della mod per cui le dipendenze sono gia a posto. */
export const CHIAVE_DIPENDENZE = 'regia.dipendenze'

/** `manca`: nessuna voce nelle impostazioni. `spento`: disabilitato a mano. */
export type StatoPonytail = 'attivo' | 'spento' | 'manca'

export function statoDaImpostazioni(attivi: Readonly<Record<string, unknown>>, nome = 'ponytail'): StatoPonytail {
  const voci = Object.entries(attivi).filter(([voce]) => voce.startsWith(`${nome}@`))
  if (voci.some(([, valore]) => valore === true)) return 'attivo'

  return voci.length > 0 ? 'spento' : 'manca'
}

async function leggiStato($: EngineInterface, nome: string): Promise<StatoPonytail> {
  const attivi = await $.settings.read({ key: 'enabledPlugins' }) as Record<string, unknown> | undefined

  return statoDaImpostazioni(attivi ?? {}, nome)
}

async function esegui($: EngineInterface, argv: readonly string[]): Promise<void> {
  const r = await $.process.run(['claude', 'plugin', ...argv], { timeoutMs: ATTESA_MS })
  if (r.exitCode !== 0) throw new Error(`claude plugin ${argv[0]} (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`)
}

async function installa($: EngineInterface, d: Dipendenza): Promise<void> {
  await esegui($, ['marketplace', 'add', d.marketplace])
  await esegui($, ['install', d.plugin])
}

/** Senza la sua CLI il plugin di Codex o di Qwen non serve. */
async function haCli($: EngineInterface, d: Dipendenza): Promise<boolean> {
  if (d.cli === undefined) return true

  return $.process.run([d.cli, '--version'], { timeoutMs: 5_000 }).then(r => r.exitCode === 0, () => false)
}

/** Da `session.start`. Non lancia e non blocca: un guasto si dice e la mod riprova alla sessione dopo. */
export async function installaDipendenze($: EngineInterface): Promise<void> {
  try {
    const home = await leggiHome($)
    const versione = (await versioneMod($)) ?? 'sconosciuta'
    if (home === undefined || (await $.store.get(CHIAVE_DIPENDENZE)) === versione) return
    const config = (await leggiConfig($, home)).dati
    let isRiuscito = true
    for (const d of DIPENDENZE) {
      try {
        if (!config[d.chiave] || (await leggiStato($, d.nome)) !== 'manca' || !(await haCli($, d))) continue
        await installa($, d)
        $.ui.toast(d.fatto, { timeoutMs: 10_000 })
      } catch (errore) {
        isRiuscito = false
        $.ui.toast(`regia: plugin ${d.nome} non installato (${messaggioErrore(errore)}). Riprovo alla prossima sessione.`, { timeoutMs: 10_000 })
      }
    }
    if (isRiuscito) await $.store.set(CHIAVE_DIPENDENZE, versione)
  } catch (errore) {
    $.ui.toast(`regia: dipendenze non controllate (${messaggioErrore(errore)}). Riprovo alla prossima sessione.`, { timeoutMs: 10_000 })
  }
}

export type ArgomentiPlugin = { nome?: Dipendenza['nome']; valore?: boolean }

/** `ponytail`, `codex on`, `qwen off`; `undefined` se non e questo comando. */
export function leggiArgomentiPonytail(args: string): ArgomentiPlugin | undefined {
  const [parola, valore, ...resto] = args.trim().toLowerCase().split(/\s+/)
  const nome = DIPENDENZE.find(d => d.nome === parola)?.nome
  if (nome === undefined || resto.length > 0) return undefined
  if (valore === undefined) return { nome }

  return valore === 'on' || valore === 'off' ? { nome, valore: valore === 'on' } : undefined
}

/** Il testo del comando. Non lancia: un errore diventa il testo. */
export async function comandoPonytail($: EngineInterface, a: ArgomentiPlugin): Promise<string> {
  const d = DIPENDENZE.find(x => x.nome === (a.nome ?? 'ponytail')) ?? DIPENDENZE[0]!
  const altrimenti = d.nome === 'ponytail' ? ' La mod continua con la sua regola.' : ''
  // `/regia codex|qwen` riguarda il plugin per Claude Code, non l'esecutore: lo si dice in ogni risposta.
  const esecutore = d.cli === undefined ? '' : `\nQuesto comando riguarda solo il plugin ${d.nome} per Claude Code. L'esecutore ${d.cli} (compiti di sciame, ${d.cli}_avvia) si accende e si spegne con /regia executors ${d.cli} on|off.`
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia: HOME non definita, non trovo la config.'
    if (a.valore === false) {
      await scriviChiave($, home, d.chiave, false)

      return `La mod non installera piu il plugin ${d.nome}. Se e gia installato resta: per toglierlo, claude plugin uninstall ${d.plugin}.${esecutore}`
    }
    if (a.valore === true) await scriviChiave($, home, d.chiave, true)
    const stato = await leggiStato($, d.nome)
    if (stato === 'attivo') return `Plugin ${d.nome} attivo (${d.plugin}): vive di vita sua, la mod non lo aggiorna.${esecutore}`
    if (stato === 'spento') return `Plugin ${d.nome} installato ma disabilitato a mano: la mod non lo tocca.${altrimenti}${esecutore}`
    if (!(await leggiConfig($, home)).dati[d.chiave]) return `Il plugin ${d.nome} non c'e e la mod non lo installa.${altrimenti} /regia ${d.nome} on lo installa.${esecutore}`
    if (!(await haCli($, d))) return `Il plugin ${d.nome} non si installa: la CLI ${d.cli} non c'e su questo PC.${esecutore}`
    await installa($, d)

    return `${d.fatto}${esecutore}`
  } catch (errore) {
    return `regia: plugin ${d.nome} non installato (${messaggioErrore(errore)}).${altrimenti}${esecutore}`
  }
}
