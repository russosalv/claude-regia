// La sveglia della principale: quando, e quando smette.

import { expect, test } from 'claude-code/testing'

import { ATTESA_MS, MASSIMO_SVEGLIE, decidiSveglia, testoSveglia } from '../hooks/sorveglianza'
import type { Sveglie } from '../hooks/sorveglianza'

const ferma = { isOccupata: false, fineMs: 0 }
const nuove: Sveglie = { impronta: 'a', tentativi: 0, ultimaMs: 0, isEsaurita: false }
const base = { oraMs: ATTESA_MS, principale: ferma, aperte: 3, agentiInCorso: 0, impronta: 'a', sveglie: nuove }

test('sveglia la principale ferma col piano aperto e nessuno al lavoro, dopo l\'attesa', () => {
  expect(decidiSveglia(base).isDovuta).toBe(true)
  expect(decidiSveglia({ ...base, oraMs: ATTESA_MS - 1 }).isDovuta).toBe(false)
  expect(decidiSveglia({ ...base, aperte: 0 }).isDovuta).toBe(false)
  expect(decidiSveglia({ ...base, principale: { ...ferma, isOccupata: true } }).isDovuta).toBe(false)
  // Fermata dalla persona con Esc: niente sveglia.
  expect(decidiSveglia({ ...base, principale: { ...ferma, motivo: 'aborted' } }).isDovuta).toBe(false)
})

test('con agenti al lavoro aspetta, a meno che qualcosa sia appena finito', () => {
  expect(decidiSveglia({ ...base, agentiInCorso: 2 }).isDovuta).toBe(false)
  expect(decidiSveglia({ ...base, agentiInCorso: 2, impronta: 'b' }).isDovuta).toBe(true)
  // Il cambio l'ha fatto (o visto) la principale nel suo turno: niente sveglia.
  expect(decidiSveglia({ ...base, agentiInCorso: 2, impronta: 'b', isTurnoNuovo: true }).isDovuta).toBe(false)
})

test('senza progressi le sveglie si diradano e poi smettono; un progresso le riapre', () => {
  let s = nuove
  let ora = 0
  for (let i = 0; i < MASSIMO_SVEGLIE; i++) {
    ora += ATTESA_MS * 2 ** i
    expect(decidiSveglia({ ...base, oraMs: ora - 1, sveglie: s }).isDovuta).toBe(false)
    const d = decidiSveglia({ ...base, oraMs: ora, sveglie: s })
    expect(d.isDovuta).toBe(true)
    s = d.sveglie
  }
  const esaurita = decidiSveglia({ ...base, oraMs: ora + 10 * 60 * 60_000, sveglie: s })
  expect(esaurita.isDovuta).toBe(false)
  expect(esaurita.sveglie.isEsaurita).toBe(true)
  expect(decidiSveglia({ ...base, oraMs: ora + 10 * 60 * 60_000, sveglie: esaurita.sveglie, impronta: 'b' }).isDovuta).toBe(true)
})

test('il testo dice di andare avanti e ricorda l\'errore dell\'API', () => {
  const riga = { chiave: 'registro:x', nome: 'x', fonte: 'registro' as const, esecutore: '', stato: 'scaletta' as const }
  const t = testoSveglia({ aperte: [riga], agentiInCorso: 0, minuti: 4, motivo: 'error' })
  expect(t).toContain('- x (scaletta)')
  expect(t).toContain('errore dell\'API')
  expect(t).toContain('Non chiedere alla persona il permesso')
})

// ── la mod intera: stalli e sveglia, a orologio finto ──

import { mock } from 'claude-code/testing'

import { AGENTE_VIVO, GREP, HOME, LOG, REGISTRO, SESSIONE } from './fixture'

const MIN = 60_000
const LOG_ALFA = `${HOME}/.claude/regia/codex/lavoro-alfa/lavoro-alfa.log`
const ROLLOUT = `${HOME}/.codex/sessions/2026/11/10/rollout-x-abc-123.jsonl`
const PS_ALFA = '  PID ELAPSED COMMAND\n 1234 59:00 codex exec -C /p -o lavoro-alfa.esito.md -\n'
const PIANO = JSON.stringify({ lavori: [{ id: 'sviluppo-04', titolo: 'Sviluppo 04', stato: 'scaletta', sessione: SESSIONE }] })

// Una cinquantina di minuti a orologio finto: ogni minuto un giro completo della mod.
test('la sorveglianza: un Codex vivo non si tocca, uno fermo si ferma, la principale si sveglia col piano aperto', { timeoutMs: 60_000 }, async ($, on) => {
  mock.env(on, { HOME })
  // La sveglia vale in modalita long.
  mock.store(on, { [`regia.profilo.${SESSIONE}`]: { profilo: 'long', isVia: false, aggiornatoMs: 1_700_000_000_000 } })
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const ora = () => clock.now()
  const f = {
    ps: PS_ALFA,
    log: '14:14 inizio lavoro-alfa',
    mtime: {} as Record<string, number>,
    agenti: [] as unknown[],
    bozza: '',
    uccisi: [] as string[][],
    sveglie: [] as string[],
  }
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__regia__${e.name}` } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSIONE }))
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.read', () => ({ value: { text: f.bozza, cursor: 0 } }))
  on('prompt.submit', (_, e) => {
    f.sveglie.push(e.text)

    return { text: e.text } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('agent.list', () => ({ value: f.agenti as never }))
  on('fs.exists', (_, e) => ({ value: e.path === LOG || e.path === REGISTRO }))
  on('fs.read', (_, e) => ({ value: e.path === REGISTRO ? PIANO : e.path === LOG ? f.log : '' }))
  on('fs.stat', (_, e) => {
    const m = f.mtime[e.path]
    if (m === undefined) throw new Error('ENOENT')

    return { value: { kind: 'file' as const, size: 1, mtimeMs: m, isLink: false } }
  })
  on('process.run', (_, e) => {
    const [cmd] = e.argv
    if (cmd === 'kill') f.uccisi.push([...e.argv])
    const stdout = cmd === 'ps' ? f.ps
      : cmd === 'grep' ? GREP
        : cmd === 'head' ? 'OpenAI Codex\nsession id: abc-123\n'
          : cmd === 'find' ? `${ROLLOUT}\n` : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  /** La principale gira il turno che le si e chiesto e si ferma. */
  const turnoPrincipale = () => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  // Un comando lungo: lo stderr tace da 45 min, ma Codex scrive la sua sessione.
  f.mtime[LOG_ALFA] = ora() - 45 * MIN
  f.mtime[ROLLOUT] = ora() - 2 * MIN
  for (let i = 0; i < 4; i++) await clock.advance(MIN)
  expect(f.uccisi).toEqual([])
  // Il piano e aperto ma Codex lavora: nessuna sveglia.
  expect(f.sveglie).toEqual([])

  // Fermi entrambi da oltre 30 min: lo ferma e lo dice alla principale, una volta.
  f.mtime[ROLLOUT] = ora() - 40 * MIN
  await clock.advance(MIN)
  expect(f.uccisi).toEqual([['kill', '1234']])
  expect(f.sveglie.length).toBe(1)
  expect(f.sveglie[0]).toContain('Codex "lavoro-alfa": nessun segno di vita da 41 min')
  await turnoPrincipale()
  await clock.advance(MIN)
  expect(f.uccisi.length).toBe(1)

  // Codex e finito, nessuno lavora, il piano ha una voce aperta: dopo 3 minuti
  // la sveglia, ma non sopra la bozza della persona.
  f.ps = '  PID ELAPSED COMMAND\n'
  f.log = '14:14 inizio lavoro-alfa\n14:59 fine lavoro-alfa (exit 143)'
  f.bozza = 'sto scrivendo'
  for (let i = 0; i < 5; i++) await clock.advance(MIN)
  expect(f.sveglie.length).toBe(1)
  f.bozza = ''
  await clock.advance(MIN)
  expect(f.sveglie.length).toBe(2)
  expect(f.sveglie[1]).toContain('Sviluppo 04')
  expect(f.sveglie[1]).toContain('Non chiedere alla persona il permesso')
  await turnoPrincipale()

  // Un subagente che non fa passi per oltre 30 min si segnala, con TaskStop.
  f.agenti = [AGENTE_VIVO]
  for (let i = 0; i < 29; i++) await clock.advance(MIN)
  expect(f.sveglie.filter(t => t.includes('TaskStop'))).toEqual([])
  for (let i = 0; i < 3; i++) await clock.advance(MIN)
  const segnalazione = f.sveglie.find(t => t.includes('TaskStop'))
  expect(segnalazione).toContain('(id a-vivo): nessun passo da')
})
