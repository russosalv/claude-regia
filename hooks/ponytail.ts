// Le dipendenze della mod: quando la mod e nuova o aggiornata, la prima sessione
// interattiva installa Ponytail se manca, una volta per versione. Dopo vive di
// vita sua: la mod non lo aggiorna e, se viene tolto, non lo rimette fino alla
// versione successiva. Chi non lo vuole ha `/regia ponytail off`.

import type { EngineInterface } from 'claude-code'

import { scriviChiave } from './comando-opzioni'
import { versioneMod } from './doctor'
import { leggiConfig, leggiHome } from './fonti'
import { messaggioErrore } from './parsers'

const MARKETPLACE = 'DietrichGebert/ponytail'
const PLUGIN = 'ponytail@ponytail'
const ATTESA_MS = 120_000
/** In `$.store`: la versione della mod per cui le dipendenze sono gia a posto. */
export const CHIAVE_DIPENDENZE = 'regia.dipendenze'

/** `manca`: nessuna voce nelle impostazioni. `spento`: disabilitato a mano. */
export type StatoPonytail = 'attivo' | 'spento' | 'manca'

export function statoDaImpostazioni(attivi: Readonly<Record<string, unknown>>): StatoPonytail {
  const voci = Object.entries(attivi).filter(([nome]) => nome.startsWith('ponytail@'))
  if (voci.some(([, valore]) => valore === true)) return 'attivo'

  return voci.length > 0 ? 'spento' : 'manca'
}

async function leggiStato($: EngineInterface): Promise<StatoPonytail> {
  const attivi = await $.settings.read({ key: 'enabledPlugins' }) as Record<string, unknown> | undefined

  return statoDaImpostazioni(attivi ?? {})
}

async function esegui($: EngineInterface, argv: readonly string[]): Promise<void> {
  const r = await $.process.run(['claude', 'plugin', ...argv], { timeoutMs: ATTESA_MS })
  if (r.exitCode !== 0) throw new Error(`claude plugin ${argv[0]} (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`)
}

async function installa($: EngineInterface): Promise<void> {
  await esegui($, ['marketplace', 'add', MARKETPLACE])
  await esegui($, ['install', PLUGIN])
}

const FATTO = 'Ponytail installato: si carica dalla prossima sessione. /ponytail band off nasconde la sua barra, /regia ponytail off evita che la mod lo installi.'

/** Da `session.start`. Non lancia e non blocca: un guasto si dice e la mod riprova alla sessione dopo. */
export async function installaDipendenze($: EngineInterface): Promise<void> {
  try {
    const home = await leggiHome($)
    const versione = (await versioneMod($)) ?? 'sconosciuta'
    if (home === undefined || (await $.store.get(CHIAVE_DIPENDENZE)) === versione) return
    if ((await leggiConfig($, home)).dati.ponytail && (await leggiStato($)) === 'manca') {
      await installa($)
      $.ui.toast(FATTO, { timeoutMs: 10_000 })
    }
    await $.store.set(CHIAVE_DIPENDENZE, versione)
  } catch (errore) {
    $.ui.toast(`regia: Ponytail non installato (${messaggioErrore(errore)}). Riprovo alla prossima sessione.`, { timeoutMs: 10_000 })
  }
}

/** `ponytail`, `ponytail on`, `ponytail off`; `undefined` se non e questo comando. */
export function leggiArgomentiPonytail(args: string): { valore?: boolean } | undefined {
  const [nome, valore, ...resto] = args.trim().toLowerCase().split(/\s+/)
  if (nome !== 'ponytail' || resto.length > 0) return undefined
  if (valore === undefined) return {}

  return valore === 'on' || valore === 'off' ? { valore: valore === 'on' } : undefined
}

/** Il testo del comando. Non lancia: un errore diventa il testo. */
export async function comandoPonytail($: EngineInterface, a: { valore?: boolean }): Promise<string> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia: HOME non definita, non trovo la config.'
    if (a.valore === false) {
      await scriviChiave($, home, 'ponytail', false)

      return `La mod non installera piu Ponytail. Se e gia installato resta: per toglierlo, claude plugin uninstall ${PLUGIN}.`
    }
    if (a.valore === true) await scriviChiave($, home, 'ponytail', true)
    const stato = await leggiStato($)
    const automatica = (await leggiConfig($, home)).dati.ponytail
    if (stato === 'attivo') return 'Ponytail attivo: vive di vita sua, la mod non lo aggiorna.'
    if (stato === 'spento') return 'Ponytail installato ma disabilitato a mano: la mod non lo tocca e usa la sua regola.'
    if (!automatica) return 'Ponytail non c\'e e la mod non lo installa: usa la sua regola. /regia ponytail on lo installa.'
    await installa($)

    return FATTO
  } catch (errore) {
    return `regia: Ponytail non installato (${messaggioErrore(errore)}). La mod continua con la sua regola.`
  }
}
