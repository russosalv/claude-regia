import { expect, mock, test } from 'claude-code/testing'

import { colonnePane, durataViva, rigaTabella, segnoStato } from '../hooks/layout'
import { cellWidth, fitColumns, scorrimento, tacche, taglia, tronca } from '../hooks/tavola'
import type { Colonna } from '../hooks/tavola'
import { pilloleConteggi } from '../hooks/vista'
import type { RegiaRiga } from '../types/index'
import { HOME, PANE, SESSIONE, fontiFinte } from './fixture'
import { resa } from './resa'

const RIGHE: RegiaRiga[] = [
  { chiave: 'a', nome: 'lavoro-alfa', fonte: 'codex', esecutore: 'codex', stato: 'in_corso', modello: 'gpt-6-astra', effort: 'high', durataSec: 1260, cartella: '…/.worktrees/lavoro-alfa' },
  { chiave: 'b', nome: 'un-nome-di-lavoro-davvero-troppo-lungo-per-il-pane', fonte: 'claude', esecutore: 'claude:code-reviewer', stato: 'in_corso', durataSec: 240 },
  { chiave: 'c', nome: 'lavoro-beta', fonte: 'codex', esecutore: 'codex', stato: 'fatto', modello: 'gpt-6-astra', effort: 'medium', durataSec: 2580, esito: 'exit 0 · 5 commit' },
  { chiave: 'd', nome: 'lavoro-gamma', fonte: 'codex', esecutore: 'codex', stato: 'fallito', modello: 'gpt-6-astra', effort: 'low', durataSec: 60, esito: 'exit 143' },
]
const MOMENTO = { fotogramma: 0, trascorsiSec: 4 }

test('fitColumns cede le colonne per priorita e da l\'avanzo a quella che cresce', () => {
  const colonne: Colonna[] = [
    { id: 'a', titolo: 'A', larghezza: 10, cresce: true },
    { id: 'b', titolo: 'B', larghezza: 5, priorita: 1 },
    { id: 'c', titolo: 'C', larghezza: 5, priorita: 0 },
  ]

  expect(fitColumns(colonne, 40).map(c => `${c.id}${c.larghezza}`)).toEqual(['a24', 'b5', 'c5'])
  expect(fitColumns(colonne, 20).map(c => c.id)).toEqual(['a', 'b'])
  expect(fitColumns(colonne, 12).map(c => `${c.id}${c.larghezza}`)).toEqual(['a12'])
})

test('le colonne del pane cedono prima indicatore ed esecutore, poi modello ed esito', () => {
  const righe = RIGHE.map(r => rigaTabella(r, MOMENTO))
  const ids = (spazio: number) => colonnePane(righe, spazio).map(c => c.id)

  expect(ids(120)).toEqual(['stato', 'lavoro', 'moto', 'esecutore', 'modello', 'durata', 'ultima'])
  expect(ids(58)).toEqual(['stato', 'lavoro', 'modello', 'durata', 'ultima'])
  expect(ids(48)).toEqual(['stato', 'lavoro', 'durata', 'ultima'])
  expect(ids(30)).toEqual(['stato', 'lavoro', 'durata'])
  for (const spazio of [30, 40, 48, 60, 64, 80, 120]) {
    const colonne = colonnePane(righe, spazio)
    const larghezza = colonne.reduce((s, c) => s + c.larghezza, 0) + 3 * (colonne.length - 1)
    expect(larghezza).toBeLessThanOrEqual(spazio)
  }
})

test('ogni stato ha simbolo e colore del tema, lo sforzo ha le sue tacche', () => {
  expect(segnoStato('fatto', 0)).toEqual({ testo: '✓', colore: 'success' })
  expect(segnoStato('fallito', 0)).toEqual({ testo: '✗', colore: 'error' })
  expect(segnoStato('bloccato', 0)).toEqual({ testo: '⊘', colore: 'warning' })
  expect(segnoStato('in_corso', 0).colore).toBe('claude')
  expect(segnoStato('in_corso', 0).testo).not.toBe(segnoStato('in_corso', 1).testo)
  expect(tacche('low')?.testo).toBe('▰▱▱')
  expect(tacche('medium')?.testo).toBe('▰▰▱')
  expect(tacche('high')?.testo).toBe('▰▰▰')
  expect(tacche('boh')).toBeUndefined()
  expect(scorrimento(2, 4).map(p => p.testo).join('')).toBe('▱▱▰▱')

  const fallito = rigaTabella(RIGHE[3]!, MOMENTO).celle
  expect(fallito.ultima).toEqual([{ testo: '✗ exit 143', colore: 'error' }])
  const fatto = rigaTabella(RIGHE[2]!, MOMENTO).celle
  expect(fatto.ultima).toEqual([{ testo: '✓ 5 commit', colore: 'success' }])
  expect(rigaTabella(RIGHE[1]!, MOMENTO).celle.esecutore).toEqual([{ testo: 'claude', colore: 'claude' }])
  expect(fatto.esecutore?.[0]?.colore).toBe('permission')
})

test('durate vive, larghezze in celle e tagli', () => {
  expect(durataViva(45)).toBe('45s')
  expect(durataViva(1264)).toBe('21m04s')
  expect(durataViva(3840)).toBe('1h04m')
  expect(cellWidth('✅ ok')).toBe(5)
  expect(tronca('abcdefghij', 5)).toBe('abcd…')
  expect(taglia([{ testo: 'astra' }, { testo: ' ' }, { testo: '▰▰▰' }], 7).map(p => p.testo)).toEqual(['astra', ' ', '…'])
})

test('le pillole si accorciano quando non ci stanno', () => {
  const gruppi = { inCorso: RIGHE.slice(0, 2), scaletta: [], scalettaExtra: 0, fatti: RIGHE.slice(2), fattiExtra: 3 }

  expect(pilloleConteggi(gruppi, 80).map(p => p.testo)).toEqual(['● 2 in corso', '○ 0 in scaletta', '✓ 5 fatti', '✗ 1 falliti'])
  expect(pilloleConteggi(gruppi, 30).map(p => p.testo)).toEqual(['● 2', '○ 0', '✓ 5', '✗ 1'])
})

const LARGHEZZE = [40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120]

test('il pane non va mai a capo: nessuna riga oltre la larghezza da 40 a 120', async ($, on) => {
  const clock = fontiFinte(on, { isAgentiNegati: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const monta = (larghezza: number, view = {}) =>
    $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: larghezza, view } })

  for (const vista of ['sessione', 'tutti'] as const) {
    for (const larghezza of LARGHEZZE) {
      for (const view of [{}, { agentId: 'a-vivo' }]) {
        const ui = await monta(larghezza, view)
        const righe = resa(await ui.drawn(), larghezza)

        for (const riga of righe) expect(cellWidth(riga)).toBeLessThanOrEqual(larghezza)
        expect(righe.some(r => /^│ ◆ Regia.*\[ ⇄ (tutti|sessione) \] │$/.test(r))).toBe(true)
        expect(righe.some(r => r.startsWith('── IN CORSO'))).toBe(true)
        expect(righe.some(r => /─┼─/.test(r))).toBe(true)
        // L'esecutore cede prima del modello: c'e a pane largo, manca a pane stretto.
        if (larghezza <= 60) expect(righe.some(r => r.includes('Esec.'))).toBe(false)
        if (larghezza >= 110) expect(righe.some(r => r.includes('Esec.'))).toBe(true)
        await ui.unmount()
      }
    }
    const ui = await monta(64)
    await ui.press({ key: 'vista' })
    await ui.unmount()
  }

  // La vista di dettaglio di un log, alle stesse larghezze.
  for (const larghezza of LARGHEZZE) {
    const ui = await monta(larghezza)
    await ui.press({ key: 'log:codex:1234' })
    const righe = resa(await ui.drawn(), larghezza)
    for (const riga of righe) expect(cellWidth(riga)).toBeLessThanOrEqual(larghezza)
    expect(righe[0]).toMatch(/\[ ← indietro \] \[ ↻ \]$/)
    await ui.press({ key: 'indietro' })
    await ui.unmount()
  }
})

test('stati ed esecutori colorati con i nomi del tema', async ($, on) => {
  const clock = fontiFinte(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 100 } })

  const colore = async (text: string) =>
    (await ui.findAll({ type: 'Text', text })).map(t => t.props.color).filter(c => c !== undefined)

  expect(await colore('✓ 5 commit')).toEqual(['success'])
  expect(await colore('✗ exit 143')).toEqual(['error'])
  expect(await colore('codex')).toContain('permission')
  expect(await colore('▰▰▰')).toEqual(['claude'])
  expect(await colore('◆ Regia agenti')).toEqual(['claude'])
  await ui.unmount()
})

test('senza lavori il pane mostra un riquadro attenuato con il suggerimento', async ($, on) => {
  mock.env(on, { HOME })
  mock.store(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSIONE }))
  on('fs.exists', () => ({ value: false }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 40 } })
  const righe = resa(await ui.drawn(), 40)

  expect(righe.some(r => r.includes('Nessun agente al lavoro in questa'))).toBe(true)
  expect(righe.some(r => r.includes('/regia tutti per vedere la macchina'))).toBe(true)
  expect(righe.some(r => r.startsWith('── IN CORSO'))).toBe(false)
  for (const riga of righe) expect(cellWidth(riga)).toBeLessThanOrEqual(40)
  await ui.unmount()
})
