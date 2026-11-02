// `/regia doctor`: che cosa e attivo adesso, in questa sessione, e che cosa manca.

import type { EngineInterface } from 'claude-code'

import { leggiConfig, leggiHome } from './fonti'
import { isPonytailAttivo } from './orchestra'
import { messaggioErrore } from './parsers'
import type { ConfigRegia, ModoOrchestra } from './registro'
import { contaSciamiAttivi } from './sciame-motore'

export type DatiDoctor = {
  versione?: string
  radice: string
  config: ConfigRegia
  isConfigPresente: boolean
  percorsoConfig: string
  avvisi: readonly string[]
  haSuperficie: boolean
  haAgent: boolean
  isPonytail: boolean
  sciamiAttivi: number
  repo?: string
  /** La prima riga di `--version`; `undefined` se il comando non c'e. */
  codex?: string
  python?: string
}

const SPIEGA_MODO: Readonly<Record<ModoOrchestra, string>> = {
  stretta: 'la principale delega, e le sue scritture sui file del progetto vengono rifiutate',
  guida: 'la principale e invitata a delegare, senza rifiuti',
  off: 'la principale lavora come vuole',
}

/** Il modo nel riepilogo di `/regia`, in una riga. */
export function rigaModi(c: Pick<ConfigRegia, 'orchestra' | 'instradamento' | 'risparmio'>): string {
  const accesa = (v: boolean) => (v ? 'on' : 'off')

  return `Orchestra ${c.orchestra} · modelli ${accesa(c.instradamento)} · risparmio ${accesa(c.risparmio)} — /regia doctor per i dettagli`
}

function rigaOrchestra(d: DatiDoctor): string {
  const { orchestra } = d.config
  const base = `Orchestra: ${orchestra.toUpperCase()} — ${SPIEGA_MODO[orchestra]}.`
  if (orchestra === 'off') return base
  if (!d.haSuperficie) return `${base} NON si applica qui: sessione senza superficie (claude -p o SDK).`
  if (!d.haAgent) return `${base} NON si applica qui: il tool Agent non e disponibile.`

  return `${base} Attiva in questa sessione.`
}

/** Puro: dai dati raccolti al testo. */
export function testoDoctor(d: DatiDoctor): string {
  const c = d.config

  return [
    `Regia ${d.versione ?? '(versione illeggibile)'} — ${d.radice}`,
    '',
    rigaOrchestra(d),
    `Modello e sforzo per compito: ${c.instradamento ? 'ACCESI — li sceglie haiku guardando il compito' : 'SPENTI — decide il motore'}${Object.keys(c.modelli).length > 0 ? `; fissati in config: ${Object.keys(c.modelli).join(', ')}` : ''}.`,
    `Risparmio: ${c.risparmio ? 'ACCESO' : 'SPENTO'} — ${d.isPonytail ? 'Ponytail attivo' : 'Ponytail non attivo'}${c.risparmio ? (d.isPonytail ? ', la mod aggiunge il rapporto breve' : ', la mod aggiunge sobrieta e rapporto breve (/regia ponytail on per installarlo)') : ''}.`,
    `Sciami: ${d.sciamiAttivi} in corso, parallelo ${c.sciameParallelo}. ${d.repo === undefined ? 'Nessun repository: i compiti che scrivono verranno rifiutati.' : `Repository: ${d.repo}.`}`,
    `Codex: ${d.codex === undefined ? 'NON trovato — codex_avvia e i compiti Codex non partiranno' : `${d.codex}, modello ${c.codexModello ?? 'deciso da Codex'}`}.`,
    `Posta dai Codex: ${d.python === undefined ? 'python3 NON trovato — la CLI posta non funziona' : d.python}.`,
    `Config: ${d.isConfigPresente ? d.percorsoConfig : `nessun file, valori predefiniti (${d.percorsoConfig})`}.`,
    ...d.avvisi.map(a => `Attenzione: ${a}`),
    '',
    'Si cambia con /regia orchestra stretta|guida|off, /regia modelli on|off, /regia risparmio on|off.',
  ].join('\n')
}

/** La prima riga di `<comando> --version`; un comando che manca non e un errore. */
async function versioneDi($: EngineInterface, comando: string): Promise<string | undefined> {
  try {
    const r = await $.process.run([comando, '--version'], { timeoutMs: 5_000 })

    return r.exitCode === 0 ? r.stdout.trim().split('\n')[0] : undefined
  } catch {
    return undefined
  }
}

export async function versioneMod($: EngineInterface): Promise<string | undefined> {
  try {
    const letto = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }

    return typeof letto.version === 'string' ? letto.version : undefined
  } catch {
    return undefined
  }
}

/** Il testo del comando. Non lancia: un errore diventa il testo. */
export async function comandoDoctor($: EngineInterface): Promise<string> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia doctor: HOME non definita, non trovo la config.'
    const percorsoConfig = `${home}/.claude/regia/config.json`
    const [versione, config, isConfigPresente, superfici, strumenti, isPonytail, sciamiAttivi, repo, codex, python] = await Promise.all([
      versioneMod($),
      leggiConfig($, home),
      $.fs.exists(percorsoConfig),
      $.session.surfaces(),
      $.tool.list(),
      isPonytailAttivo($),
      contaSciamiAttivi($),
      $.session.repo().catch(() => undefined),
      versioneDi($, 'codex'),
      versioneDi($, 'python3'),
    ])

    return testoDoctor({
      versione,
      radice: $.plugin.root,
      config: config.dati,
      isConfigPresente,
      percorsoConfig,
      avvisi: config.avvisi,
      haSuperficie: superfici.length > 0,
      haAgent: strumenti.some(t => t.name === 'Agent'),
      isPonytail,
      sciamiAttivi,
      repo: repo?.root,
      codex,
      python,
    })
  } catch (errore) {
    return `regia doctor: ${messaggioErrore(errore)}`
  }
}
