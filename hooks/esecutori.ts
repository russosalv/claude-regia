// Gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot): quali sono accesi in config,
// quali CLI rispondono su questo PC, la squadra (`/regia team`) e chi fa un compito
// di sciame che non lo dice. Le regole della scelta stanno in `instradamento.ts`.

import type { EngineInterface } from 'claude-code'

import { COMANDO_CLI, ESECUTORI_CLI } from './codex'
import type { EsecutoreCli } from './codex'
import { leggiConfig, leggiHome } from './fonti'
import { assegnaEsecutori, daChiedere, postiEsterni, promptEsecutori } from './instradamento'
import type { CompitoDaAssegnare, GiaAssegnati, RegolaSquadra, SceltaEsecutore } from './instradamento'
import { chiediHaiku } from './modelli'
import { messaggioErrore } from './parsers'
import { NOME_SQUADRA } from './registro'
import type { ConfigRegia, Squadra } from './registro'

/** Per ogni CLI la prima riga di `--version`; `undefined` se il comando non c'e. */
export type StatoCli = Readonly<Partial<Record<EsecutoreCli, string>>>

export type StatoEsecutore = { nome: EsecutoreCli; isAcceso: boolean; cli?: string; isUsabile: boolean }

/** Puro: usabile e chi e acceso in config e ha la CLI che risponde. */
export function statoEsecutori(accesi: readonly EsecutoreCli[], cli: StatoCli): StatoEsecutore[] {
  return ESECUTORI_CLI.map(nome => {
    const isAcceso = accesi.includes(nome)
    const versione = cli[nome]

    return { nome, isAcceso, ...(versione === undefined ? {} : { cli: versione }), isUsabile: isAcceso && versione !== undefined }
  })
}

export const soloUsabili = (stati: readonly StatoEsecutore[]): EsecutoreCli[] => stati.filter(s => s.isUsabile).map(s => s.nome)

const percheNo = (s: StatoEsecutore): string =>
  [s.isAcceso ? undefined : 'spento in config', s.cli === undefined ? 'CLI non trovata' : undefined].filter(Boolean).join(', ')

/** La riga di `/regia doctor`: chi e usabile e, per gli altri, perche no. */
export function rigaEsecutori(stati: readonly StatoEsecutore[]): string {
  const usabili = soloUsabili(stati)
  const altri = stati.filter(s => !s.isUsabile).map(s => `${s.nome} no (${percheNo(s)})`)
  const si = usabili.length === 0 ? 'nessuno usabile, negli sciami lavora solo Claude' : `usabili ${usabili.join(', ')}`

  return `Esecutori: ${[si, ...(altri.length === 0 ? [] : [altri.join(', ')])].join('; ')} — /regia executors.`
}

/** Il testo di `/regia executors`. */
export function testoEsecutori(stati: readonly StatoEsecutore[]): string {
  const usabili = soloUsabili(stati)

  return [
    `Esecutori esterni usabili ora: ${usabili.length === 0 ? 'nessuno, negli sciami lavora solo Claude' : usabili.join(', ')}.`,
    ...stati.map(s => `  ${s.nome}: ${s.isAcceso ? 'acceso' : 'spento in config'} · ${s.cli === undefined ? 'CLI non trovata' : `CLI trovata${s.cli === '' ? '' : ` (${s.cli})`}`}`),
    'In uno sciame un compito senza `esecutore` lo riceve dalla mod, secondo la squadra impostata (/regia team): Claude oppure uno degli usabili. Uno spento viene rifiutato anche se indicato o chiamato con il suo tool.',
    'Si cambia con /regia executors codex|qwen|copilot|qoder on|off ("esecutori" in ~/.claude/regia/config.json). /regia codex|qwen on|off riguarda invece il plugin per Claude Code.',
  ].join('\n')
}

type ConfigSquadra = Pick<ConfigRegia, 'squadra' | 'squadraQuota'>

/** La squadra come la scrivono `/regia` e `/regia doctor`: la quota vale solo in `mista`. */
export const nomeSquadra = (c: ConfigSquadra): string => `${NOME_SQUADRA[c.squadra]}${c.squadra === 'mista' ? ` ${c.squadraQuota}%` : ''}`

const SPIEGA_SQUADRA: Readonly<Record<Squadra, (quota: number) => string>> = {
  claude: () => 'Sviluppa solo Claude, come subagenti (Agent) e come compiti di sciame: un compito senza `esecutore` va sempre a Claude. Gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) lavorano solo se li nomini: `esecutore` in un compito di sciame, oppure codex_avvia, qoder_avvia, qwen_avvia, copilot_avvia.',
  mista: quota => `Claude e la squadra di sviluppo, come subagenti (Agent) e come compiti di sciame; gli esecutori esterni sono rinforzi. In uno sciame la mod tiene su Claude lo sviluppo che chiede di capire il progetto e da agli esterni cio che gli si addice (lavoro meccanico o in blocco, documentazione, test, revisioni indipendenti, seconde implementazioni, compiti isolati e ben specificati): al massimo il ${quota}% dei compiti che assegna lei in uno sciame.`,
  esterni: () => 'In uno sciame i compiti autosufficienti senza `esecutore` vanno agli esecutori esterni, senza tetto; a Claude resta cio che e legato alla sessione (i suoi tool e server MCP, le skill, i tipi di agente, cio che si e detto).',
}

const SQUADRA_IN_BREVE: Readonly<Record<Squadra, string>> = {
  claude: 'sviluppa solo Claude, gli esterni lavorano solo se li nomini',
  mista: 'sviluppa Claude, gli esterni prendono i compiti di sciame che gli si addicono, entro la quota',
  esterni: 'i compiti autosufficienti di uno sciame vanno agli esterni, senza tetto',
}

/** La riga di `/regia doctor`. */
export function rigaSquadra(c: ConfigSquadra): string {
  return `Squadra: ${NOME_SQUADRA[c.squadra].toUpperCase()}${c.squadra === 'mista' ? `, quota esterni ${c.squadraQuota}%` : ''} — ${SQUADRA_IN_BREVE[c.squadra]} (/regia team).`
}

/** Il testo di `/regia team`. Puro. */
export function testoSquadra(c: ConfigSquadra): string {
  return [
    `Squadra: ${NOME_SQUADRA[c.squadra].toUpperCase()}. Quota degli esterni: ${c.squadraQuota}%${c.squadra === 'mista' ? '' : ' (vale solo con mixed)'}.`,
    SPIEGA_SQUADRA[c.squadra](c.squadraQuota),
    'Si cambia con /regia team claude|mixed|external; la quota con /regia team <numero da 0 a 100> ("squadra" e "squadraQuota" in ~/.claude/regia/config.json). Quali esterni sono usabili: /regia executors.',
  ].join('\n')
}

/** La prima riga di `<comando> --version`; un comando che manca non e un errore. */
export async function versioneDi($: EngineInterface, comando: string): Promise<string | undefined> {
  try {
    const r = await $.process.run([comando, '--version'], { timeoutMs: 5_000 })

    return r.exitCode === 0 ? r.stdout.trim().split('\n')[0] : undefined
  } catch {
    return undefined
  }
}

/** `codex-esegui` e `copilot-esegui` cercano la CLI anche nell'ultimo nvm: "c'e" deve voler dire "lo script la trova". */
const ANCHE_IN_NVM: readonly EsecutoreCli[] = ['codex', 'copilot']

const numeri = (versione: string): number[] => (versione.match(/\d+/g) ?? []).map(Number)

/** Dalla piu recente, come `sort -V -r`. */
function piuRecentePrima(a: string, b: string): number {
  const [x, y] = [numeri(a), numeri(b)]
  const i = x.findIndex((n, k) => n !== (y[k] ?? -1))

  return i < 0 ? y.length - x.length : (y[i] ?? -1) - (x[i] ?? -1)
}

async function trovaInNvm($: EngineInterface, home: string, comando: string): Promise<string | undefined> {
  try {
    const radice = `${home}/.nvm/versions/node`
    const versioni = (await $.fs.list(radice)).map(v => v.name).sort(piuRecentePrima)
    for (const v of versioni) {
      if (await $.fs.exists(`${radice}/${v}/bin/${comando}`)) return `in ~/.nvm/versions/node/${v}/bin, fuori dal PATH`
    }
  } catch {
    // Senza nvm non c'e nulla da cercare.
  }

  return undefined
}

async function cliDi($: EngineInterface, home: string | undefined, esecutore: EsecutoreCli): Promise<string | undefined> {
  const versione = await versioneDi($, COMANDO_CLI[esecutore])
  if (versione !== undefined || home === undefined || !ANCHE_IN_NVM.includes(esecutore)) return versione

  return trovaInNvm($, home, COMANDO_CLI[esecutore])
}

/** Quanto vale una risposta delle CLI: uno sciame non le interroga a ogni giro. */
const VALIDITA_CLI_MS = 5 * 60_000
let ricordo: { oraMs: number; cli: StatoCli } | undefined

/** Le tre CLI, come le vede `/regia doctor`. `isFresca`: senza usare la risposta ricordata. */
export async function leggiCli($: EngineInterface, isFresca = false): Promise<StatoCli> {
  const oraMs = await $.clock.now()
  if (!isFresca && ricordo !== undefined && oraMs - ricordo.oraMs < VALIDITA_CLI_MS) return ricordo.cli
  const home = await leggiHome($)
  const versioni = await Promise.all(ESECUTORI_CLI.map(e => cliDi($, home, e)))
  const cli = Object.fromEntries(ESECUTORI_CLI.flatMap((e, i) => (versioni[i] === undefined ? [] : [[e, versioni[i]]]))) as StatoCli
  ricordo = { oraMs, cli }

  return cli
}

/** Una CLI data per presente non ha risposto: alla prossima domanda si guarda di nuovo. */
export function dimenticaCli(): void {
  ricordo = undefined
}

/** Gli esecutori esterni usabili adesso: accesi in config e con la CLI che risponde. */
export async function esecutoriUsabili($: EngineInterface, home: string): Promise<EsecutoreCli[]> {
  const accesi = (await leggiConfig($, home)).dati.esecutori

  return accesi.length === 0 ? [] : soloUsabili(statoEsecutori(accesi, await leggiCli($)))
}

const ATTESA_SCELTA_MS = 15_000

/**
 * Chi fa i compiti di uno sciame che non lo dicono, secondo la squadra impostata: i vincoli, poi haiku
 * una volta sola per tutti, poi il ripiego. Con squadra `claude` non si guarda quali CLI ci sono
 * e non si chiede nulla: tutto a Claude. Non lancia: un guasto lascia i compiti a Claude.
 * `gia`: cio che lo sciame ha gia (`sciame_aggiungi`). `nota`: una riga per chi ha lanciato, se haiku non ha risposto.
 */
export async function scegliEsecutori(
  $: EngineInterface,
  home: string,
  compiti: readonly CompitoDaAssegnare[],
  gia: GiaAssegnati,
): Promise<{ scelte: Map<string, SceltaEsecutore>; nota?: string }> {
  if (compiti.length === 0) return { scelte: new Map() }
  try {
    const { squadra, squadraQuota } = (await leggiConfig($, home)).dati
    const regola: RegolaSquadra = { squadra, quota: squadraQuota }
    const usabili = squadra === 'claude' ? [] : await esecutoriUsabili($, home)
    const chiesti = daChiedere(compiti, usabili, regola, gia)
    const perPrompt = squadra === 'mista' ? { squadra, tetto: postiEsterni(compiti.length, regola, gia, true) } : { squadra: 'esterni' as const }
    const risposta = chiesti.length === 0 ? undefined : await chiediHaiku($, promptEsecutori(chiesti, usabili, perPrompt), 40 + 20 * chiesti.length, ATTESA_SCELTA_MS)
    const scelte = assegnaEsecutori(compiti, usabili, risposta?.testo, regola, gia)

    return risposta?.errore === undefined ? { scelte } : { scelte, nota: `Esecutori assegnati per ripiego: haiku non ha risposto (${risposta.errore}).` }
  } catch (errore) {
    const motivo = 'ripiego: scelta non riuscita'

    return { scelte: new Map(compiti.map(c => [c.nome, { esecutore: 'claude' as const, motivo }])), nota: `Esecutori non scelti (${messaggioErrore(errore)}): i compiti restano a Claude.` }
  }
}
