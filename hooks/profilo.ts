// Le modalita di lavoro della sessione (`/regia long|medium|quick`) e la
// presenza della persona (`/regia away|here`, o un telefono collegato), che
// decide se le notifiche partono. Vivono in `$.store` per sessione: valgono
// anche dopo un ricaricamento o una ripresa della sessione.

import type { EngineInterface } from 'claude-code'

import { CHIAVE_PROFILO, leggiConfig, leggiHome } from './fonti'
import { messaggioErrore } from './parsers'

export const PROFILI = ['long', 'medio', 'quick'] as const
export type Profilo = (typeof PROFILI)[number]
/** Il nome con cui i comandi chiamano una modalita. I nomi italiani restano validi. */
export const NOME_PROFILO: Readonly<Record<Profilo, string>> = { long: 'long', medio: 'medium', quick: 'quick' }
const INGLESI: Readonly<Record<string, string>> = { medium: 'medio', away: 'via', here: 'qui' }

export type StatoProfilo = {
  profilo: Profilo
  /** La persona ha detto di non essere al PC (`/regia away`). */
  isVia: boolean
  /** Il modello della principale prima di `quick`, da rimettere all'uscita. */
  modelloPrima?: string
  aggiornatoMs: number
}

export const PROFILO_PREDEFINITO: StatoProfilo = { profilo: 'medio', isVia: false, aggiornatoMs: 0 }

export function statoDaStore(grezzo: unknown): StatoProfilo {
  if (typeof grezzo !== 'object' || grezzo === null) return PROFILO_PREDEFINITO
  const o = grezzo as Record<string, unknown>
  const profilo = PROFILI.find(p => p === o.profilo) ?? PROFILO_PREDEFINITO.profilo

  return {
    profilo,
    isVia: o.isVia === true,
    ...(typeof o.modelloPrima === 'string' ? { modelloPrima: o.modelloPrima } : {}),
    aggiornatoMs: typeof o.aggiornatoMs === 'number' ? o.aggiornatoMs : 0,
  }
}

export async function leggiProfilo($: EngineInterface): Promise<StatoProfilo> {
  try {
    return statoDaStore(await $.store.get(`${CHIAVE_PROFILO}${await $.session.id()}`))
  } catch {
    return PROFILO_PREDEFINITO
  }
}

async function scriviProfilo($: EngineInterface, stato: Omit<StatoProfilo, 'aggiornatoMs'>): Promise<void> {
  await $.store.set(`${CHIAVE_PROFILO}${await $.session.id()}`, { ...stato, aggiornatoMs: await $.clock.now() })
}

/** Vero se la persona non e al PC: l'ha detto, o la sessione e aperta anche sul telefono. */
export async function isAssente($: EngineInterface): Promise<boolean> {
  if ((await leggiProfilo($)).isVia) return true
  const superfici = await $.session.surfaces().catch(() => [] as string[])

  return superfici.some(s => s !== 'terminal')
}

/** Una notifica sul telefono o sul PC, solo se la persona non e davanti alla sessione. */
export async function notifica($: EngineInterface, testo: string, chiave?: string): Promise<void> {
  try {
    if (!(await isAssente($))) return
    await $.ui.notify(testo, { title: 'regia', ...(chiave === undefined ? {} : { key: chiave }) })
  } catch {
    // Nessun canale di notifica: resta il pane.
  }
}

export type ArgomentiProfilo = { nome: Profilo | 'via' | 'qui'; obiettivo: string }

/** `long`, `quick fai X`, `via`...; `undefined` se la prima parola non e una modalita. */
export function leggiArgomentiProfilo(args: string): ArgomentiProfilo | undefined {
  const testo = args.trim()
  const [prima = ''] = testo.split(/\s+/)
  const parola = prima.toLowerCase()
  const nome = [...PROFILI, 'via', 'qui'].find(n => n === (INGLESI[parola] ?? parola)) as ArgomentiProfilo['nome'] | undefined

  return nome === undefined ? undefined : { nome, obiettivo: testo.slice(prima.length).trim() }
}

const SPIEGA: Readonly<Record<Profilo, string>> = {
  long: 'LONG, sviluppi lunghi: la principale orchestra e fa le tue veci. Piano in scaletta con la descrizione di ogni attivita, agenti in parallelo, sorveglianza degli agenti fermi e sveglia della principale finche il piano e aperto; le domande per te nel pane, con notifica quando sei via.',
  medio: 'MEDIUM: la principale lavora lei e delega solo i pezzi indipendenti o le ricerche ampie. Sorveglianza degli agenti fermi, niente sveglia.',
  quick: 'QUICK: un solo agente, niente subagenti ne sorveglianza',
}

/** `/model <nome>` come se lo scrivesse la persona; un toast se non riesce. */
async function cambiaModello($: EngineInterface, modello: string): Promise<void> {
  try {
    await $.command.run({ command: 'model', args: modello })
  } catch (errore) {
    $.ui.toast(`regia: modello non cambiato (${messaggioErrore(errore)}): scrivi /model ${modello}`, { timeoutMs: 15_000 })
  }
}

/** Il testo di risposta di `/regia long|medium|quick|away|here`. Non lancia. */
export async function comandoProfilo($: EngineInterface, a: ArgomentiProfilo): Promise<string> {
  try {
    const prima = await leggiProfilo($)
    if (a.nome === 'via' || a.nome === 'qui') {
      await scriviProfilo($, { ...prima, isVia: a.nome === 'via' })

      return a.nome === 'via'
        ? 'Sei via: le domande per te, il piano finito e il piano fermo ti arrivano come notifica. /regia here quando torni.'
        : 'Sei qui: niente notifiche (salvo con la sessione aperta anche sul telefono).'
    }
    const righe: string[] = []
    // Cambio di modello e obiettivo partono dopo il comando: dentro il suo hook il motore non li accetta.
    const dopo: (() => Promise<void>)[] = []
    let modelloPrima = prima.modelloPrima
    if (a.nome === 'quick' && prima.profilo !== 'quick') {
      const home = await leggiHome($)
      const modello = home === undefined ? 'sonnet' : (await leggiConfig($, home)).dati.quickModello
      modelloPrima = await $.session.model().catch(() => undefined)
      righe.push(`${SPIEGA.quick}; la principale passa a ${modello}${modelloPrima === undefined ? '' : ` (prima: ${modelloPrima}, torna uscendo da quick)`}.`)
      dopo.push(() => cambiaModello($, modello))
    } else if (a.nome === 'quick') {
      righe.push(`${SPIEGA.quick}.`)
    } else {
      righe.push(SPIEGA[a.nome])
      if (prima.profilo === 'quick' && modelloPrima !== undefined) {
        righe.push(`La principale torna a ${modelloPrima}.`)
        const torna = modelloPrima
        dopo.push(() => cambiaModello($, torna))
        modelloPrima = undefined
      }
    }
    await scriviProfilo($, { profilo: a.nome, isVia: prima.isVia, ...(modelloPrima === undefined ? {} : { modelloPrima }) })
    if (a.obiettivo !== '') {
      dopo.push(async () => {
        await $.prompt.submit({ text: a.obiettivo }).catch(errore => $.ui.toast(`regia: obiettivo non inviato (${messaggioErrore(errore)})`))
      })
      righe.push('Parto con l\'obiettivo che hai scritto.')
    }
    if (dopo.length > 0) {
      $.clock.after(0, async () => {
        for (const passo of dopo) await passo()
      })
    }

    return righe.join('\n')
  } catch (errore) {
    return `regia: non riesco a cambiare modalita (${messaggioErrore(errore)}).`
  }
}
