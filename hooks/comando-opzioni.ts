// `/regia models|orchestra|savings|wake [valore]`: mostra un'opzione e la cambia,
// scrivendola nella config. Vale subito: la config si rilegge a ogni uso.
// `/regia executors [codex|qwen|copilot on|off]`: lo stesso per gli esecutori esterni.

import type { EngineInterface } from 'claude-code'

import { ESECUTORI_CLI } from './codex'
import type { EsecutoreCli } from './codex'
import { leggiCli, statoEsecutori, testoEsecutori } from './esecutori'
import { leggiConfig, leggiHome } from './fonti'
import { isPonytailAttivo } from './orchestra'
import { messaggioErrore } from './parsers'
import { MODI_ORCHESTRA, NOME_MODO } from './registro'
import type { ConfigRegia } from './registro'

type Opzione = { chiave: 'instradamento' | 'orchestra' | 'risparmio' | 'sveglia'; valori: Readonly<Record<string, boolean | string>> }

const INTERRUTTORE = { on: true, off: false }

const OPZIONI: Readonly<Record<string, Opzione>> = {
  modelli: { chiave: 'instradamento', valori: INTERRUTTORE },
  orchestra: { chiave: 'orchestra', valori: Object.fromEntries(MODI_ORCHESTRA.flatMap(m => [[NOME_MODO[m], NOME_MODO[m]], [m, NOME_MODO[m]]])) },
  risparmio: { chiave: 'risparmio', valori: INTERRUTTORE },
  sveglia: { chiave: 'sveglia', valori: INTERRUTTORE },
}

/** I nomi inglesi dei comandi; quelli italiani restano validi. */
const INGLESI: Readonly<Record<string, string>> = { models: 'modelli', savings: 'risparmio', wake: 'sveglia' }

export type ArgomentiOpzione = { nome: string; valore?: boolean | string; isValoreSbagliato?: boolean }

/** `orchestra`, `orchestra guide`...; `undefined` se la prima parola non e un'opzione. */
export function leggiArgomentiOpzione(args: string): ArgomentiOpzione | undefined {
  const [parola, valore, ...resto] = args.trim().toLowerCase().split(/\s+/)
  const nome = parola === undefined ? undefined : INGLESI[parola] ?? parola
  const opzione = nome === undefined ? undefined : OPZIONI[nome]
  if (nome === undefined || opzione === undefined) return undefined
  if (valore === undefined) return { nome }
  const letto = opzione.valori[valore]
  if (letto === undefined || resto.length > 0) return { nome, isValoreSbagliato: true }

  return { nome, valore: letto }
}

/** La config con una chiave cambiata e il resto com'era. */
export async function scriviChiave($: EngineInterface, home: string, chiave: string, valore: boolean | number | string | readonly string[]): Promise<void> {
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
      'Si cambia con /regia models on|off; un tipo si fissa in ~/.claude/regia/config.json, "modelli": { "tipo": "modello" }.',
    ].join('\n')
  }
  if (nome === 'orchestra') {
    return [
      `La principale: ${NOME_MODO[c.orchestra].toUpperCase()}.`,
      'La regola dipende dalla modalita (/regia long|medium|quick). guide: la regola nel prompt. strict: in piu, in long le scritture della principale sui file del progetto vengono rifiutate. off: nessuna regola.',
      'Si cambia con /regia orchestra strict|guide|off.',
    ].join('\n')
  }

  if (nome === 'sveglia') {
    return [
      `Sorveglianza e sveglia: ${c.sveglia ? 'ACCESA' : 'SPENTA'}.`,
      `Ogni minuto: un agente senza segni di vita da ${c.stalloMinuti} min e fermo (un Codex si ferma, un subagente Claude si segnala alla principale). Se la principale e ferma e il piano in scaletta ha voci aperte, la regia la sveglia solo quando nessuno lavora (senza progressi le sveglie si diradano e dopo 5 smettono) o quando c'e una novita per lei (un compito finito o fallito, posta non letta): una sveglia sola, corta. Con gli agenti al lavoro e nulla di nuovo, un controllo dopo ${c.controlloMinuti.join(', ')} min (l'ultimo resta fisso).`,
      'Si cambia con /regia wake on|off; le soglie con "stalloMinuti" e "controlloMinuti" in ~/.claude/regia/config.json.',
    ].join('\n')
  }

  return [
    `Risparmio nei prompt dei delegati: ${c.risparmio ? 'ACCESO' : 'SPENTO'}.`,
    isPonytail
      ? 'Ponytail e attivo e porta la sua regola ai subagenti: la mod aggiunge solo il rapporto finale breve.'
      : 'Ponytail non e attivo: la mod aggiunge una regola di sobrieta sua e il rapporto finale breve. Per installarlo: /regia ponytail on.',
    'Si cambia con /regia savings on|off.',
  ].join('\n')
}

/** Il testo di risposta del comando. Non lancia: un errore diventa il testo. */
export async function comandoOpzione($: EngineInterface, a: ArgomentiOpzione): Promise<string> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia: HOME non definita, non trovo la config.'
    const opzione = OPZIONI[a.nome]
    if (opzione === undefined) return `regia: opzione sconosciuta: ${a.nome}`
    if (a.isValoreSbagliato === true) return `regia: valori di ${a.nome}: ${[...new Set(Object.values(opzione.valori))].map(v => (typeof v === 'boolean' ? (v ? 'on' : 'off') : v)).join(', ')}.`
    if (a.valore !== undefined) await scriviChiave($, home, opzione.chiave, a.valore)
    const { dati, avvisi } = await leggiConfig($, home)

    return [descrivi(a.nome, dati, await isPonytailAttivo($)), ...avvisi.map(x => `Attenzione: ${x}`)].join('\n')
  } catch (errore) {
    return `regia: non riesco a cambiare ${a.nome} (${messaggioErrore(errore)}).`
  }
}

export type ArgomentiEsecutori = { esecutore?: EsecutoreCli; valore?: boolean; isSbagliato?: boolean }

/** `executors`, `executors codex off`, `esecutori qwen on`; `undefined` se la prima parola non e questo comando. */
export function leggiArgomentiEsecutori(args: string): ArgomentiEsecutori | undefined {
  const [parola, nome, valore, ...resto] = args.trim().toLowerCase().split(/\s+/)
  if (parola !== 'executors' && parola !== 'esecutori') return undefined
  if (nome === undefined) return {}
  const esecutore = ESECUTORI_CLI.find(e => e === nome)
  if (esecutore === undefined || (valore !== 'on' && valore !== 'off') || resto.length > 0) return { isSbagliato: true }

  return { esecutore, valore: valore === 'on' }
}

/** Il testo di `/regia executors`: accende o spegne un esecutore e dice chi e usabile adesso. Non lancia. */
export async function comandoEsecutori($: EngineInterface, a: ArgomentiEsecutori): Promise<string> {
  try {
    const home = await leggiHome($)
    if (home === undefined) return 'regia: HOME non definita, non trovo la config.'
    if (a.isSbagliato === true) return `regia: /regia executors mostra gli esecutori; /regia executors ${ESECUTORI_CLI.join('|')} on|off ne accende o spegne uno.`
    const { esecutore, valore } = a
    if (esecutore !== undefined && valore !== undefined) {
      const accesi = (await leggiConfig($, home)).dati.esecutori
      await scriviChiave($, home, 'esecutori', ESECUTORI_CLI.filter(e => (e === esecutore ? valore : accesi.includes(e))))
    }
    const { dati, avvisi } = await leggiConfig($, home)

    // Senza la risposta ricordata: il comando dice che cosa c'e adesso.
    return [testoEsecutori(statoEsecutori(dati.esecutori, await leggiCli($, true))), ...avvisi.map(x => `Attenzione: ${x}`)].join('\n')
  } catch (errore) {
    return `regia: non riesco a cambiare gli esecutori (${messaggioErrore(errore)}).`
  }
}
