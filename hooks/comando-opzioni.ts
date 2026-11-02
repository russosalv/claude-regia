// `/regia modelli|orchestra|risparmio [valore]`: mostra un'opzione e la cambia,
// scrivendola nella config. Vale subito: la config si rilegge a ogni uso.

import type { EngineInterface } from 'claude-code'

import { leggiConfig, leggiHome } from './fonti'
import { isPonytailAttivo } from './orchestra'
import { messaggioErrore } from './parsers'
import { MODI_ORCHESTRA } from './registro'
import type { ConfigRegia } from './registro'

type Opzione = { chiave: 'instradamento' | 'orchestra' | 'risparmio'; valori: Readonly<Record<string, boolean | string>> }

const INTERRUTTORE = { on: true, off: false }

const OPZIONI: Readonly<Record<string, Opzione>> = {
  modelli: { chiave: 'instradamento', valori: INTERRUTTORE },
  orchestra: { chiave: 'orchestra', valori: Object.fromEntries(MODI_ORCHESTRA.map(m => [m, m])) },
  risparmio: { chiave: 'risparmio', valori: INTERRUTTORE },
}

export type ArgomentiOpzione = { nome: string; valore?: boolean | string; isValoreSbagliato?: boolean }

/** `orchestra`, `orchestra guida`...; `undefined` se la prima parola non e un'opzione. */
export function leggiArgomentiOpzione(args: string): ArgomentiOpzione | undefined {
  const [nome, valore, ...resto] = args.trim().toLowerCase().split(/\s+/)
  const opzione = nome === undefined ? undefined : OPZIONI[nome]
  if (nome === undefined || opzione === undefined) return undefined
  if (valore === undefined) return { nome }
  const letto = opzione.valori[valore]
  if (letto === undefined || resto.length > 0) return { nome, isValoreSbagliato: true }

  return { nome, valore: letto }
}

/** La config con una chiave cambiata e il resto com'era. */
export async function scriviChiave($: EngineInterface, home: string, chiave: string, valore: boolean | string): Promise<void> {
  const percorso = `${home}/.claude/regia/config.json`
  let radice: Record<string, unknown> = {}
  if (await $.fs.exists(percorso)) {
    const letto: unknown = JSON.parse(await $.fs.read(percorso))
    if (typeof letto !== 'object' || letto === null || Array.isArray(letto)) {
      throw new Error('config.json non e un oggetto: lo lascio com\'e')
    }
    radice = letto as Record<string, unknown>
  }
  await $.fs.write(percorso, `${JSON.stringify({ ...radice, [chiave]: valore }, null, 2)}\n`)
}

function descrivi(nome: string, c: ConfigRegia, isPonytail: boolean): string {
  if (nome === 'modelli') {
    const fissi = Object.entries(c.modelli).map(([tipo, modello]) => `  ${tipo} → ${modello} (config)`)

    return [
      `Modello e sforzo decisi per compito: ${c.instradamento ? 'ACCESO' : 'SPENTO'}.`,
      'A ogni chiamata ad Agent haiku guarda il compito e sceglie; cio che la chiamata o la definizione dell\'agente dicono resta. Mai i fork.',
      ...fissi,
      'Si cambia con /regia modelli on|off; un tipo si fissa in ~/.claude/regia/config.json, "modelli": { "tipo": "modello" }.',
    ].join('\n')
  }
  if (nome === 'orchestra') {
    return [
      `La principale: ${c.orchestra.toUpperCase()}.`,
      'stretta: coordina e delega, e le sue scritture sui file del progetto vengono rifiutate. guida: la stessa regola, senza rifiuti. off: lavora come vuole.',
      'Si cambia con /regia orchestra stretta|guida|off.',
    ].join('\n')
  }

  return [
    `Risparmio nei prompt dei delegati: ${c.risparmio ? 'ACCESO' : 'SPENTO'}.`,
    isPonytail
      ? 'Ponytail e attivo e porta la sua regola ai subagenti: la mod aggiunge solo il rapporto finale breve.'
      : 'Ponytail non e attivo: la mod aggiunge una regola di sobrieta sua e il rapporto finale breve. Per installarlo: /regia ponytail on.',
    'Si cambia con /regia risparmio on|off.',
  ].join('\n')
}

/** Il testo di risposta del comando. Non lancia: un errore diventa il testo. */
export async function comandoOpzione($: EngineInterface, a: ArgomentiOpzione): Promise<string> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia: HOME non definita, non trovo la config.'
    const opzione = OPZIONI[a.nome]
    if (opzione === undefined) return `regia: opzione sconosciuta: ${a.nome}`
    if (a.isValoreSbagliato === true) return `regia: valori di ${a.nome}: ${Object.keys(opzione.valori).join(', ')}.`
    if (a.valore !== undefined) await scriviChiave($, home, opzione.chiave, a.valore)
    const { dati, avvisi } = await leggiConfig($, home)

    return [descrivi(a.nome, dati, await isPonytailAttivo($)), ...avvisi.map(x => `Attenzione: ${x}`)].join('\n')
  } catch (errore) {
    return `regia: non riesco a cambiare ${a.nome} (${messaggioErrore(errore)}).`
  }
}
