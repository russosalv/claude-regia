import { expect, mock, test } from 'claude-code/testing'

import { costruisciSnapshot, testoStato } from '../hooks/model'
import { parseEseguiLog } from '../hooks/parsers'
import { AGENTE_FINITO, AGENTE_VIVO, CONFIG, GREP, HOME, LOG, PANE, PS, SESSIONE, baseInput, fontiFinte } from './fixture'

test('la vista sessione tiene i codex propri e lo storico ricordato, quella tutti ogni cosa', () => {
  const snap = costruisciSnapshot(baseInput())

  expect(snap.viste.sessione.inCorso.map(r => r.nome)).toEqual(['lavoro-alfa'])
  expect(snap.viste.sessione.fatti.map(r => `${r.nome}:${r.stato}`)).toEqual([
    'lavoro-gamma:fallito',
    'lavoro-beta:fatto',
  ])
  expect(snap.viste.sessione.fatti[1]?.esito).toBe('exit 0 · 5 commit')

  expect(snap.viste.tutti.inCorso.map(r => r.nome)).toEqual(['lavoro-alfa', 'lavoro-delta'])
  expect(snap.viste.tutti.fatti.map(r => r.nome)).toEqual([
    'studio-altrui', 'lavoro-gamma', 'lavoro-beta',
  ])
  expect(testoStato(snap)).toBe('● 1 codex')
})

test('senza attribuzione la vista sessione non mostra codex ma segnala la lacuna', () => {
  const { pidMiei: _scartato, ...resto } = baseInput()
  const snap = costruisciSnapshot({ ...resto, nomiSessione: new Set(), avvisi: ['attribuzione non riuscita'] })

  expect(snap.viste.sessione.inCorso).toEqual([])
  expect(snap.viste.tutti.inCorso).toHaveLength(2)
  expect(snap.avvisi).toEqual(['attribuzione non riuscita'])
})

test('i fatti sono al massimo 5 e il resto si conta', () => {
  const voci = parseEseguiLog(
    Array.from({ length: 8 }, (_, i) => `10:0${i} inizio j${i}\n10:0${i} fine j${i} (exit 0)`).join('\n'),
  ).voci
  const snap = costruisciSnapshot({
    ...baseInput(),
    processi: [],
    nomiSessione: new Set(),
    log: [{ percorso: LOG, voci, esiti: new Set() }],
  })

  expect(snap.viste.tutti.fatti).toHaveLength(5)
  expect(snap.viste.tutti.fattiExtra).toBe(3)
})

const testoRiga = async (ui: { find: (q: { key: string }) => Promise<{ text: string } | undefined> }, chiave: string) =>
  (await ui.find({ key: `riga:${chiave}` }))?.text

test('il pane mostra la sessione, commuta su tutti col tasto e torna con /regia', async ($, on) => {
  const clock = fontiFinte(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: 'questa sessione' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'vista' }))?.text).toBe('⇄ tutti')
    expect(await testoRiga(ui, 'codex:1234')).toMatch(/lavoro-alfa.*astra/)
    expect(await ui.find({ key: 'riga:codex:1300' })).toBeUndefined()
    // La scaletta viene dal registro globale: c'e in entrambe le viste.
    expect(await ui.find({ type: 'Text', text: 'Prossimo lavoro' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^subagenti Claude/ })).toBeDefined()

    await ui.press({ key: 'vista' })
    expect(await ui.find({ type: 'Text', text: 'tutta la macchina' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'vista' }))?.text).toBe('⇄ sessione')
    expect(await ui.find({ type: 'Text', text: /^lavoro-delta/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'studio-altrui' })).toBeDefined()

    await ui.press({ key: 'vista' })
    expect(await ui.find({ type: 'Text', text: 'questa sessione' })).toBeDefined()
    await ui.unmount()
  }

  const tutti = await $.command.run({
    command: 'regia', args: 'tutti', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 },
  })
  expect(tutti.text).toContain('Regia (tutta la macchina): 2 in corso (2 codex, 0 claude')
  expect(tutti.text).not.toContain('da fare)')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'tutta la macchina' })).toBeDefined()
  await ui.unmount()

  const sessione = await $.command.run({
    command: 'regia', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 },
  })
  expect(sessione.text).toContain('Regia (questa sessione): 1 in corso (1 codex, 0 claude')
})

test('un lavoro visto vivo resta della sessione quando finisce, con l\'esito dal log', async ($, on) => {
  mock.env(on, { HOME })
  mock.store(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  let ps = PS
  let log = '14:14 inizio lavoro-alfa'
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSIONE }))
  on('fs.exists', (_, e) => ({ value: e.path === LOG || e.path === CONFIG }))
  on('fs.read', (_, e) => ({ value: e.path === CONFIG ? JSON.stringify({ codexLogs: [LOG] }) : log }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: e.argv[0] === 'ps' ? ps : GREP, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  // Il processo finisce: sparisce da ps, il log riceve la riga "fine".
  ps = '  PID ELAPSED COMMAND'
  log = '14:14 inizio lavoro-alfa\n14:40 fine lavoro-alfa (exit 0, commit 3)'
  await clock.advance(15000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '✓ 3 commit' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /scaletta vuota/ })).toBeDefined()
  await ui.unmount()
})

test('ps riceve -ww: con COLUMNS esportato le righe non vengono tagliate', async ($, on) => {
  mock.env(on, { HOME, COLUMNS: '80' })
  mock.store(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const chiamate: string[][] = []
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSIONE }))
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', (_, e) => {
    chiamate.push([...e.argv])

    return { value: { exitCode: 0, stdout: e.argv[0] === 'ps' ? PS : GREP, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const ps = chiamate.find(a => a[0] === 'ps')
  expect(ps).toBeDefined()
  expect(ps).toContain('-ww')
})

test('▸ apri porta alla conversazione del subagente, ← principale torna indietro', async ($, on) => {
  const clock = fontiFinte(on, { isAgentiNegati: false })
  const viste: Array<string | undefined> = []
  on('ui.view', (_, e) => {
    viste.push(e.agentId)

    return { value: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  for (const larghezza of [100, 40]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: larghezza } })
    // Largo: colonna di tasti; stretto: e la cella del Lavoro a fare da tasto.
    expect((await ui.find({ type: 'Button', key: 'apri:a-vivo' }))?.text).toMatch(larghezza === 100 ? /^▸ apri$/ : /^▸ revisione/)
    // Il subagente completato non e in corso e non ha il tasto per aprirlo.
    expect(await ui.find({ type: 'Button', key: 'apri:a-finito' })).toBeUndefined()
    await ui.press({ key: 'apri:a-vivo' })
    await ui.unmount()
  }
  expect(viste).toEqual(['a-vivo', 'a-vivo'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, view: { agentId: 'a-vivo' } } })
  await ui.press({ key: 'principale' })
  expect(viste.at(-1)).toBeUndefined()
  await ui.unmount()
})

test('▸ log apre le ultime righe del log Codex nel pane e ← indietro torna al cruscotto', async ($, on) => {
  const clock = fontiFinte(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100 } })

  await ui.press({ key: 'log:codex:1234' })
  expect(await ui.find({ type: 'Text', text: /^◆ log · lavoro-alfa/ })).toBeDefined()
  // Colori ANSI e tabulazioni tolti: la riga occupa le celle che conta.
  expect(await ui.find({ type: 'Text', text: 'riga  due' })).toBeDefined()
  await ui.press({ key: 'indietro' })
  expect(await ui.find({ type: 'Text', text: 'questa sessione' })).toBeDefined()
  await ui.unmount()
})

test('un subagente concluso resta nei Fatti dopo che il motore lo toglie, grazie allo store', async ($, on) => {
  let agenti: unknown[] = [AGENTE_FINITO, AGENTE_VIVO]
  const clock = fontiFinte(on, { agenti: () => agenti })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  agenti = [AGENTE_VIVO]
  await clock.advance(15000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100 } })
  expect(await ui.find({ type: 'Text', text: /^per le mappe 3d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ completato' })).toBeDefined()
  await ui.unmount()
})
