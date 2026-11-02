// La regola della delega (prompt e rifiuti) e lo sciame: lavagna e motore.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { rigaModi, testoDoctor } from '../hooks/doctor'
import { CHIAVE_DIPENDENZE, leggiArgomentiPonytail, statoDaImpostazioni } from '../hooks/ponytail'
import { parseConfig } from '../hooks/registro'
import { RIFIUTO_SCRITTURA, TESTO_ORCHESTRA, fileDaScrivere, isDelProgetto } from '../hooks/orchestra'
import { avvisoFine, conCompiti, conEsito, conLancio, creaSciame, daLanciare, ferma, isFinito, promptLavoratore } from '../hooks/sciame'
import type { Sciame } from '../hooks/sciame'
import { HOME, SESSIONE } from './fixture'
import { PROGETTO, ZERO, ambiente } from './ambiente'

const base = { id: 's1', obiettivo: 'obiettivo', parallelo: 2 as unknown, oraMs: 1, predefinito: 4 }

function sciame(compiti: unknown, parallelo: unknown = 2): Sciame {
  const s = creaSciame({ ...base, compiti, parallelo })
  if (typeof s === 'string') throw new Error(s)

  return s
}

test('la lavagna rifiuta nomi doppi, dipendenze ignote e cicli, tutto o niente', () => {
  const crea = (compiti: unknown) => creaSciame({ ...base, compiti })

  expect(crea([])).toMatch(/almeno un compito/)
  expect(crea([{ nome: 'a/b', prompt: 'p' }])).toMatch(/non valido/)
  expect(crea([{ nome: 'a', prompt: 'p' }, { nome: 'a', prompt: 'p' }])).toMatch(/ripetuto/)
  expect(crea([{ nome: 'a', prompt: 'p', dopo: ['x'] }])).toMatch(/sconosciuta/)
  expect(crea([{ nome: 'a', prompt: 'p', dopo: ['b'] }, { nome: 'b', prompt: 'p', dopo: ['a'] }])).toMatch(/circolari/)
  expect(creaSciame({ ...base, parallelo: 99, compiti: [{ nome: 'a', prompt: 'p' }] })).toMatch(/parallelo/)
  expect(conCompiti(sciame([{ nome: 'a', prompt: 'p' }]), [{ nome: 'a', prompt: 'q' }])).toMatch(/ripetuto/)
})

test('partono i pronti entro il parallelo; le dipendenze aspettano', () => {
  let s = sciame([{ nome: 'a', prompt: 'p' }, { nome: 'b', prompt: 'p' }, { nome: 'c', prompt: 'p' }, { nome: 'd', prompt: 'p', dopo: ['a'] }])

  expect(daLanciare(s).map(c => c.nome)).toEqual(['a', 'b'])
  s = conLancio(conLancio(s, 'a', {}), 'b', {})
  expect(daLanciare(s)).toEqual([])
  s = conEsito(s, 'a', { isOk: true, esito: 'ok' })
  expect(daLanciare(s).map(c => c.nome)).toEqual(['c'])
  s = conEsito(s, 'b', { isOk: true, esito: 'ok' })
  expect(daLanciare(s).map(c => c.nome)).toEqual(['c', 'd'])
})

test('chi fallisce riprova una volta; poi i dipendenti si bloccano a cascata', () => {
  let s = sciame([{ nome: 'a', prompt: 'p' }, { nome: 'b', prompt: 'p', dopo: ['a'] }, { nome: 'c', prompt: 'p', dopo: ['b'] }])

  s = conEsito(conLancio(s, 'a', {}), 'a', { isOk: false, esito: 'rotto' })
  expect(s.compiti[0]?.stato).toBe('attesa')
  expect(promptLavoratore(s, s.compiti[0]!)).toContain('Il tentativo precedente non e riuscito: rotto')
  s = conEsito(conLancio(s, 'a', {}), 'a', { isOk: false, esito: 'rotto ancora' })
  expect(s.compiti.map(c => c.stato)).toEqual(['fallito', 'bloccato', 'bloccato'])
  expect(isFinito(s)).toBe(true)
})

test('fermare annulla chi aspetta e lascia correre chi corre', () => {
  const s = ferma(conLancio(sciame([{ nome: 'a', prompt: 'p' }, { nome: 'b', prompt: 'p' }]), 'a', {}))

  expect(s.compiti.map(c => c.stato)).toEqual(['corsa', 'annullato'])
  expect(isFinito(s)).toBe(false)
})

test('il compito sa chi sono i compagni e che cosa hanno trovato i predecessori', () => {
  let s = sciame([{ nome: 'a', prompt: 'p' }, { nome: 'b', prompt: 'fai b', dopo: ['a'], scrive: true }])
  s = conEsito(conLancio(s, 'a', {}), 'a', { isOk: true, esito: 'trovato X', fileEsito: '/f/a.md' })
  const testo = promptLavoratore(s, s.compiti[1]!)

  expect(testo).toContain('fai b')
  expect(testo).toContain('- a: trovato X (per intero: /f/a.md)')
  expect(testo).toContain('Il tuo indirizzo e s1-b')
  expect(testo).toContain('Compagni: s1-a (fatto)')
  expect(testo).toContain('Il tuo worktree e gia pronto')
  expect(promptLavoratore(s, { ...s.compiti[1]!, cartella: '/r/.worktrees/x' })).toContain('/r/.worktrees/x, ramo sciame/s1/b')
})

/** Il motore finto dello sciame: il tool Agent lancia, gli agenti vivono nella lista. */
function motoreSciame($: Engine, on: On, opzioni: { surfaces?: string[] } = {}) {
  const lanci: { name: string; model?: string; cwd?: string; prompt: string }[] = []
  const agenti: { id: string; status: string; name?: string }[] = []
  on('agent.spawn', (_, e) => {
    lanci.push({ name: String(e.name), model: e.model, cwd: e.cwd, prompt: e.prompt })
    const agentId = `a${lanci.length}`
    agenti.push({ id: agentId, status: 'running', name: e.name })

    return { model: e.model ?? 'claude-opus-5-5', agentId }
  })
  on('session.surfaces', () => ({ value: (opzioni.surfaces ?? ['terminal']) as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  const finisce = (agentId: string, reason = 'answer', answer = `rapporto ${agentId}`) =>
    $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', agentId, reason } as never)

  return { lanci, agenti, finisce }
}

async function drena(flusso: AsyncIterable<unknown>) {
  for await (const _ of flusso) void _
}

const avvia = ($: Engine, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__regia__sciame_avvia', ...argomenti } as never) as Promise<{ result?: string; deny?: string; text?: string }>

test('lo sciame lancia, avanza a ogni fine, rilancia sopra chi fallisce e sveglia la principale', async ($, on) => {
  const amb = ambiente(on, { risposta: () => ({ isAnswered: true, text: '{"modello":"haiku","sforzo":"low"}', usage: ZERO }), agenti: () => m.agenti })
  on('turn.complete', () => ({ text: '' }) as never)
  const sforzi: unknown[] = []
  on('turn.step', async function* (_, e) {
    sforzi.push(e.effort)

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  const m = motoreSciame($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await avvia($, {
    obiettivo: 'prova',
    parallelo: 2,
    compiti: [{ nome: 'a', prompt: 'fai a', scrive: true }, { nome: 'b', prompt: 'fai b' }, { nome: 'c', prompt: 'fai c', dopo: ['a'] }],
  })
  expect(String(esito.result ?? esito.text)).toContain('Non controllarlo')
  expect(m.lanci.map(l => l.name.split('-')[1])).toEqual(['a', 'b'])
  // Chi scrive ha il suo worktree, nel repository e fuori da git.
  expect(m.lanci[0]?.cwd).toMatch(new RegExp(`^${PROGETTO}/\\.worktrees/s[a-z0-9]+-a$`))
  expect(m.lanci[1]?.cwd).toBeUndefined()
  expect(amb.lanci.find(l => l.argv.includes('worktree'))?.argv).toContain('HEAD')
  expect(m.lanci[0]?.model).toBe('haiku')

  // Lo sforzo scelto arriva alla richiesta vera, anche se il motore non lo prende allo spawn.
  await drena($.turn.step({ turnId: 't', index: 0, model: 'haiku', messageCount: 1, agentId: 'a1', effort: 'high' } as never))
  expect(sforzi).toEqual(['low'])

  await m.finisce('a1')
  expect(m.lanci.map(l => l.name.split('-')[1])).toEqual(['a', 'b', 'c'])
  expect(m.lanci[2]?.prompt).toContain('rapporto a1')

  // b fallisce: riprova un gradino sopra di quanto gli era toccato.
  amb.store.set(`regia.agenti.${SESSIONE}`, { agenti: { a2: { modello: 'claude-haiku-4-5', sforzo: 'low' } }, lanci: {} })
  await m.finisce('a2', 'error', 'guasto')
  expect(m.lanci[3]).toMatchObject({ model: 'sonnet' })
  expect(m.lanci[3]?.prompt).toContain('Il tentativo precedente non e riuscito: guasto')

  await m.finisce('a3')
  await m.finisce('a4')
  const fine = (amb.store.get(`regia.sciami.${SESSIONE}`) as Sciame[])[0]
  expect(fine?.isAvvisato).toBe(true)
  expect(avvisoFine(fine as Sciame)).toContain('3 fatti')
  expect(amb.avvisi.filter(a => a.endsWith('finito'))).toHaveLength(1)
  // Il rapporto intero resta su disco, una volta sola la sveglia.
  expect([...amb.scritti.keys()].some(p => p.startsWith(`${HOME}/.claude/regia/sciami/`) && p.endsWith('/a.md'))).toBe(true)
  await m.finisce('a4')
  expect(amb.avvisi.filter(a => a.endsWith('finito'))).toHaveLength(1)
})

test('sciame_avvia rifiuta chi scrive fuori da un repository', async ($, on) => {
  ambiente(on, { senzaRepo: true })
  motoreSciame($, on)
  const esito = await avvia($, { obiettivo: 'prova', compiti: [{ nome: 'a', prompt: 'p', scrive: true }] })

  expect(esito.deny).toMatch(/repository git/)
})

test('i percorsi della regola: file del progetto si, fuori e .claude no', () => {
  expect(fileDaScrivere({ tool: 'Edit', file_path: '/r/a.ts' })).toBe('/r/a.ts')
  expect(fileDaScrivere({ tool: 'NotebookEdit', notebook_path: '/r/a.ipynb' })).toBe('/r/a.ipynb')
  expect(fileDaScrivere({ tool: 'Read', file_path: '/r/a.ts' })).toBeUndefined()
  expect(isDelProgetto('/r/a.ts', '/r')).toBe(true)
  expect(isDelProgetto('/r2/a.ts', '/r')).toBe(false)
  expect(isDelProgetto('/r/.claude/settings.json', '/r')).toBe(false)
  expect(isDelProgetto('/tmp/x', '/r')).toBe(false)
})

function regola(on: On, surfaces: string[]) {
  on('session.surfaces', () => ({ value: surfaces as never }))
  on('tool.list', () => ({ value: [{ name: 'Agent' }] as never }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { scritto: true } }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' as const }] }))
}

const scrittura = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Write', file_path: `${PROGETTO}/a.ts`, content: 'x', ...extra } as never) as Promise<{ deny?: string; result?: unknown }>

const INPUT_PROMPT = { model: 'm', promptModel: 'm', outputStyle: null } as const

test('in modo stretta la principale non scrive nel progetto; un subagente si', async ($, on) => {
  ambiente(on)
  regola(on, ['terminal'])

  expect((await scrittura($)).deny).toBe(RIFIUTO_SCRITTURA)
  expect((await scrittura($, { agentId: 'a1' })).deny).toBeUndefined()
  expect((await scrittura($, { file_path: '/tmp/fuori.txt' })).deny).toBeUndefined()
})

test('modo guida: la regola nel prompt, nessun rifiuto. off: niente', async ($, on) => {
  ambiente(on, { config: { orchestra: 'guida' } })
  regola(on, ['terminal'])

  expect((await scrittura($)).deny).toBeUndefined()
  const r = await $.prompt.compose({ ...INPUT_PROMPT, surfaces: ['terminal'], tools: ['Agent'], traits: [] } as never)
  expect(r.sections.map(s => s.id)).toEqual(['intro', 'regia:orchestra'])
  expect(r.sections[1]?.text).toBe(TESTO_ORCHESTRA)
})

test('senza superficie (claude -p, SDK) o senza Agent la regola non si applica', async ($, on) => {
  ambiente(on)
  regola(on, [])

  expect((await scrittura($)).deny).toBeUndefined()
  const nomi = async (input: Record<string, unknown>) => (await $.prompt.compose({ ...INPUT_PROMPT, ...input } as never)).sections.map(s => s.id)
  expect(await nomi({ surfaces: [], tools: ['Agent'], traits: [] })).toEqual(['intro'])
  expect(await nomi({ surfaces: ['terminal'], tools: ['Read'], traits: [] })).toEqual(['intro'])
  expect(await nomi({ surfaces: ['terminal'], tools: ['Agent'], traits: ['print'] })).toEqual(['intro'])
})

test('/regia orchestra off spegne la regola e toglie i rifiuti, /regia orchestra stretta la riaccende', async ($, on) => {
  const amb = ambiente(on)
  regola(on, ['terminal'])
  const comando = (args: string) => $.command.run({ command: 'regia', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  const sezioni = async () => (await $.prompt.compose({ ...INPUT_PROMPT, surfaces: ['terminal'], tools: ['Agent'], traits: [] } as never)).sections.map(s => s.id)
  const config = () => JSON.parse(amb.scritti.get(`${HOME}/.claude/regia/config.json`) ?? '{}') as { orchestra?: string }

  expect(await sezioni()).toContain('regia:orchestra')
  expect((await comando('orchestra off')).text).toContain('OFF')
  expect(config().orchestra).toBe('off')
  expect(await sezioni()).toEqual(['intro'])
  expect((await scrittura($)).deny).toBeUndefined()

  await comando('orchestra stretta')
  expect(config().orchestra).toBe('stretta')
  expect((await scrittura($)).deny).toBe(RIFIUTO_SCRITTURA)
})

test('/regia doctor dice che cosa e attivo e perche non si applica', () => {
  const dati = {
    versione: '1.2.3', radice: '/p', config: parseConfig({}, HOME).config, isConfigPresente: false, percorsoConfig: '/c.json',
    avvisi: [], haSuperficie: true, haAgent: true, isPonytail: false, sciamiAttivi: 1, repo: '/r', codex: 'codex-cli 1', python: 'Python 3',
  }

  const testo = testoDoctor(dati)
  expect(testo).toContain('Regia 1.2.3')
  expect(testo).toContain('Orchestra: STRETTA')
  expect(testo).toContain('Attiva in questa sessione')
  expect(testo).toContain('Ponytail non attivo')
  expect(testo).toContain('nessun file, valori predefiniti')
  expect(testoDoctor({ ...dati, haSuperficie: false })).toContain('NON si applica qui: sessione senza superficie')
  expect(testoDoctor({ ...dati, codex: undefined, repo: undefined })).toContain('Codex: NON trovato')
  expect(testoDoctor({ ...dati, config: parseConfig({ orchestra: 'off' }, HOME).config })).not.toContain('Attiva in questa')
  expect(rigaModi(dati.config)).toBe('Orchestra stretta · modelli on · risparmio on — /regia doctor per i dettagli')
})

test('/regia doctor risponde dal comando, /regia riporta la riga dei modi', async ($, on) => {
  ambiente(on, { config: { orchestra: 'guida' } })
  regola(on, ['terminal'])
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const comando = (args: string) => $.command.run({ command: 'regia', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

  expect((await comando('doctor')).text).toContain('Orchestra: GUIDA')
  expect((await comando('')).text).toContain('Orchestra guida · modelli on · risparmio on')
})

test('lo stato di Ponytail e gli argomenti del comando', () => {
  expect(statoDaImpostazioni({})).toBe('manca')
  expect(statoDaImpostazioni({ 'ponytail@ponytail': true })).toBe('attivo')
  expect(statoDaImpostazioni({ 'ponytail@ponytail': false })).toBe('spento')
  expect(statoDaImpostazioni({ 'altro@x': true })).toBe('manca')
  expect(leggiArgomentiPonytail('ponytail off')).toEqual({ valore: false })
  expect(leggiArgomentiPonytail('ponytail boh')).toBeUndefined()
  expect(leggiArgomentiPonytail('tutti')).toBeUndefined()
})

const INSTALLA = ['plugin marketplace add DietrichGebert/ponytail', 'plugin install ponytail@ponytail']

function conImpostazioni(on: On, attivi: Record<string, boolean>, config?: unknown) {
  const amb = ambiente(on, { config })
  on('settings.read', () => ({ value: { enabledPlugins: attivi } }) as never)

  return { amb, lanci: () => amb.lanci.filter(l => l.argv[0] === 'claude').map(l => l.argv.slice(1).join(' ')) }
}

/** L'installazione parte staccata da `session.start`: la si lascia finire. */
async function avvio($: Engine, amb: ReturnType<typeof ambiente>, isInteractive = true) {
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive })
  for (let i = 0; i < 20; i += 1) await amb.clock?.advance(1)
}

test('mod nuova: installa Ponytail una volta, e segna la versione', async ($, on) => {
  const { amb, lanci } = conImpostazioni(on, {})
  await avvio($, amb)

  expect(lanci()).toEqual(INSTALLA)
  expect(amb.store.get(CHIAVE_DIPENDENZE)).toBeDefined()
})

test('stessa versione: non lo rimette anche se e stato tolto', async ($, on) => {
  const { amb, lanci } = conImpostazioni(on, {})
  amb.store.set(CHIAVE_DIPENDENZE, 'sconosciuta')
  await avvio($, amb)

  expect(lanci()).toEqual([])
})

test('mod aggiornata: controlla di nuovo e lo installa se manca', async ($, on) => {
  const { amb, lanci } = conImpostazioni(on, {})
  amb.store.set(CHIAVE_DIPENDENZE, '0.0.1')
  await avvio($, amb)

  expect(lanci()).toEqual(INSTALLA)
})

test('senza persona davanti non installa nulla', async ($, on) => {
  const { amb, lanci } = conImpostazioni(on, {})
  await avvio($, amb, false)

  expect(lanci()).toEqual([])
})

test('disabilitato a mano non si tocca, e la versione si segna lo stesso', async ($, on) => {
  const { amb, lanci } = conImpostazioni(on, { 'ponytail@ponytail': false })
  await avvio($, amb)

  expect(lanci()).toEqual([])
  expect(amb.store.get(CHIAVE_DIPENDENZE)).toBeDefined()
})

test('con ponytail spento in config non installa', async ($, on) => {
  const { amb, lanci } = conImpostazioni(on, {}, { ponytail: false })
  await avvio($, amb)

  expect(lanci()).toEqual([])
})
