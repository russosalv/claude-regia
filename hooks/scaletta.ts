// Il tool `scaletta_scrivi`: la scaletta e della mod, in `registro.json`, senza
// dipendere da altri strumenti. Il pane la legge come sempre.

import type { EngineInterface } from 'claude-code'

import { leggiHome } from './fonti'
import { messaggioErrore } from './parsers'
import { validaRegistro } from './registro'
import type { StatoRegistro, VoceRegistro } from './registro'

export const DESCRIZIONE_SCALETTA = 'Aggiunge, aggiorna o toglie una voce della scaletta di regia (i lavori da fare, nel pane e nella status line). stato: scaletta, in_corso, fatto, bloccato, oppure rimossa per toglierla.'

export const SCHEMA_SCALETTA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Nome breve e stabile della voce.' },
    titolo: { type: 'string', description: 'Che cosa c\'e da fare; obbligatorio per una voce nuova.' },
    stato: { type: 'string', enum: ['scaletta', 'in_corso', 'fatto', 'bloccato', 'rimossa'] },
    note: { type: 'string' },
  },
  required: ['id', 'stato'],
  additionalProperties: false,
} as const

type Argomenti = { id: string; titolo?: string; stato: StatoRegistro | 'rimossa'; note?: string }

/** I lavori dopo una scrittura, o il motivo per cui non si puo fare. */
export function conVoce(lavori: readonly VoceRegistro[], a: Argomenti, sessione: string, oraIso: string): VoceRegistro[] | string {
  if (a.id.trim() === '') return 'manca l\'id'
  const altre = lavori.filter(v => v.id !== a.id)
  if (a.stato === 'rimossa') return altre
  const prima = lavori.find(v => v.id === a.id)
  const titolo = a.titolo?.trim() || prima?.titolo
  if (titolo === undefined) return `la voce "${a.id}" e nuova: serve un titolo`

  return [...altre, { ...prima, id: a.id, titolo, stato: a.stato, sessione, aggiornato: oraIso, ...(a.note === undefined ? {} : { note: a.note }) }]
}

let coda: Promise<unknown> = Promise.resolve()

/** Il corpo del tool. Le scritture di questa sessione passano una alla volta. */
export function scalettaScrivi($: EngineInterface, grezzi: unknown): Promise<{ result: string } | { deny: string }> {
  const lavoro = coda.then(async () => {
    try {
      const a = grezzi as Argomenti
      const home = await leggiHome($)
      if (home === undefined) return { deny: 'scaletta_scrivi: HOME non definita' }
      const percorso = `${home}/.claude/regia/registro.json`
      const { lavori, errore } = (await $.fs.exists(percorso))
        ? validaRegistro(JSON.parse(await $.fs.read(percorso)))
        : { lavori: [], errore: undefined }
      if (errore !== undefined) return { deny: `scaletta_scrivi: registro.json non valido: ${errore}` }
      const ora = new Date(await $.clock.now()).toISOString()
      const nuovi = conVoce(lavori, a, await $.session.id(), ora)
      if (typeof nuovi === 'string') return { deny: `scaletta_scrivi: ${nuovi}` }
      await $.fs.write(percorso, `${JSON.stringify({ lavori: nuovi }, null, 2)}\n`)

      return { result: `Scaletta: "${a.id}" ${a.stato}.` }
    } catch (errore) {
      return { deny: `scaletta_scrivi: ${messaggioErrore(errore)}` }
    }
  })
  coda = lavoro

  return lavoro
}
