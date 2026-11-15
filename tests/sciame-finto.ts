// Lo sciame finto dei test che scelgono l'esecutore: un haiku che risponde alla domanda
// sugli esecutori, il motore con i suoi agenti Claude, e cio che si legge dopo una chiamata.

import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MINIMO_AUTOSUFFICIENTE } from '../hooks/instradamento'
import type { Sciame } from '../hooks/sciame'
import { SESSIONE } from './fixture'
import { ZERO } from './ambiente'
import type { Ambiente } from './ambiente'

/** Un prompt abbastanza lungo da stare in piedi da solo. */
export const lungo = (inizio: string) => `${inizio}. `.padEnd(MINIMO_AUTOSUFFICIENTE + 40, 'dettagli del compito ')

const MODELLO = '{"modello":"haiku","sforzo":"low"}'
const isDomandaEsecutori = (prompt: string | undefined) => prompt?.startsWith('Assegna ogni compito') === true

/** Haiku finto: alla domanda sugli esecutori risponde `esecutori` (o non risponde), al resto modello e sforzo. */
export function haiku(amb: () => Ambiente, esecutori: string | undefined) {
  return () => {
    if (!isDomandaEsecutori(amb().complete.at(-1))) return { isAnswered: true, text: MODELLO, usage: ZERO }

    return esecutori === undefined ? undefined : { isAnswered: true, text: esecutori, usage: ZERO }
  }
}

/** Il motore finto dello sciame: gli agenti Claude lanciati vivono nella lista (`agenti: () => m.agenti` nell'ambiente). */
export function motore($: Engine, on: On) {
  const agenti: { id: string; status: string; name?: string }[] = []
  on('agent.spawn', (_, e) => {
    const agentId = `a${agenti.length + 1}`
    agenti.push({ id: agentId, status: 'running', name: e.name })

    return { model: e.model ?? 'claude-opus-5-5', agentId }
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const finisce = (agentId: string, answer = 'fatto') => {
    const agente = agenti.find(a => a.id === agentId)
    if (agente !== undefined) agente.status = 'completed'

    return $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', agentId, reason: 'answer' } as never)
  }

  return { agenti, finisce, claude: () => agenti.map(a => String(a.name).split('-').slice(1).join('-')) }
}

export const chiama = ($: Engine, tool: string, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: `mcp__regia__${tool}`, ...argomenti } as never) as Promise<{ result?: string; deny?: string; text?: string }>
export const comando = ($: Engine, args: string) =>
  $.command.run({ command: 'regia', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
export const testoDi = (esito: { result?: string; deny?: string; text?: string }) => String(esito.result ?? esito.deny ?? esito.text)
export const sciami = (amb: Ambiente) => (amb.store.get(`regia.sciami.${SESSIONE}`) ?? []) as Sciame[]
export const compiti = (amb: Ambiente) => Object.fromEntries((sciami(amb)[0]?.compiti ?? []).map(c => [c.nome, c]))
/** I lanci degli script esterni: `<esecutore>:<compito>`. */
export const esterni = (amb: Ambiente) => amb.lanci.filter(l => l.argv[0] === 'bash').map(l => `${String(l.argv[3]).split('/').pop()?.replace('-esegui', '')}:${String(l.argv[4]).split('-').slice(1).join('-')}`)
export const domande = (amb: Ambiente) => amb.complete.filter(isDomandaEsecutori)
