// GitHub Copilot CLI: argomenti per lo script e permesso, processi `copilot` nel pane, copilot_avvia, riprendi,
// sciame con esecutore copilot (anche quando la CLI manca), doctor e sorveglianza.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SCHEMA_COPILOT_AVVIA, percorsiLavoro, validaRichiesta } from '../hooks/codex'
import { testoDoctor } from '../hooks/doctor'
import { COLORE_COPILOT, rigaTabella } from '../hooks/layout'
import { costruisciSnapshot, riepilogoTestuale, testoStato } from '../hooks/model'
import { esecutoreDelLog, parseEseguiLog, parsePs } from '../hooks/parsers'
import { LOG_COPILOT_REGIA, parseConfig } from '../hooks/registro'
import type { Sciame } from '../hooks/sciame'
import { HOME, SESSIONE, baseInput } from './fixture'
import { PROGETTO, WORKTREE, ZERO, ambiente } from './ambiente'

const BIN_COPILOT = `${HOME}/.claude/regia/bin/copilot-esegui`
const CARTELLA = `${HOME}/.claude/regia/copilot`
const UUID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
/** Come li lancia `script/copilot-esegui` (la riga vera la prova tests/copilot-esegui.sh). */
const SCRIVE = '--allow-all-tools --allow-all-paths --no-ask-user -s'
const LEGGE = '--deny-tool=write --no-ask-user -s'

const chiama = ($: Engine, tool: string, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: `mcp__regia__${tool}`, ...argomenti } as never) as Promise<{ result?: string; deny?: string; text?: string }>

test('lo schema di copilot_avvia ha scrive, sforzo e modello; i suoi file stanno in ~/.claude/regia/copilot', () => {
  expect(Object.keys(SCHEMA_COPILOT_AVVIA.properties)).toEqual(['nome', 'cartella', 'prompt', 'regole', 'sforzo', 'modello', 'scrive'])
  expect(SCHEMA_COPILOT_AVVIA.required).toEqual(['nome', 'cartella', 'prompt'])
  // I modelli di Copilot hanno il punto (claude-sonnet-4.6): devono passare la validazione.
  expect(validaRichiesta({ nome: 'c', cartella: '/a', prompt: 'p', modello: 'claude-sonnet-4.6', scrive: false }, HOME).richiesta).toMatchObject({ modello: 'claude-sonnet-4.6', scrive: false })
  expect(percorsiLavoro(HOME, 'c', 'copilot').eseguiLog).toBe(`${CARTELLA}/esegui.log`)
  expect(percorsiLavoro(HOME, 'c', 'copilot').sessione).toBe(`${CARTELLA}/c/c.sessione`)
  expect(esecutoreDelLog(`${HOME}/${LOG_COPILOT_REGIA}`)).toBe('copilot')
  expect(esecutoreDelLog(`${HOME}/.claude/regia/qwen/esegui.log`)).toBe('qwen')
  expect(esecutoreDelLog(`${HOME}/altro/esegui.log`)).toBe('codex')
})

test('parsePs riconosce un copilot lanciato dallo script (anche ripreso, dietro timeout o dal launcher npm) e non una sessione interattiva', () => {
  const nuovo = `--model claude-sonnet-4.6 --effort high ${SCRIVE} --log-dir ${CARTELLA}/sciame-a/log --session-id ${UUID} -C ${WORKTREE}`
  const ps = [
    '  PID ELAPSED COMMAND',
    ` 500 01:10 timeout 14400 copilot ${nuovo}`,
    ` 501 01:10 node /usr/lib/node_modules/@github/copilot/npm-loader.js ${nuovo}`,
    ` 502 01:10 /usr/lib/node_modules/@github/copilot-linux-x64/copilot ${nuovo}`,
    // Una ripresa non ha -C ne un nome: lo dice --log-dir.
    ` 510 00:20 copilot ${LEGGE} --log-dir ${CARTELLA}/ripreso/log --resume=${UUID}`,
    ' 600 00:30 copilot -p fai una cosa --allow-all-tools',
    ' 650 40:00 copilot',
    ` 660 40:00 copilot --resume=${UUID} --log-dir /tmp/altro/log`,
    ` 700 05:00 /bin/bash -c cd ${WORKTREE} && copilot -p "ciao" --allow-all-tools`,
    ` 800 00:05 codex exec -m gpt-6-astra -C ${WORKTREE} -o c.esito.md -`,
  ].join('\n')
  const trovati = parsePs(ps)

  expect(trovati.map(p => `${p.pid}:${p.nome}:${p.esecutore ?? 'codex'}`)).toEqual(['500:sciame-a:copilot', '510:ripreso:copilot', '600:copilot-600:copilot', '800:c:codex'])
  expect(trovati[0]).toMatchObject({ modello: 'claude-sonnet-4.6', effort: 'high', cartella: WORKTREE, durataSec: 70 })
  expect(trovati[1]).not.toHaveProperty('cartella')
  expect(trovati[1]).not.toHaveProperty('modello')
})

test('copilot_avvia lancia copilot-esegui: modello dalla chiamata o da copilotModello, permesso da scrive, nessuno sforzo inventato', async ($, on) => {
  const amb = ambiente(on, { config: { copilotModello: 'claude-sonnet-4.6' } })
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const scrive = await chiama($, 'copilot_avvia', { nome: 'prova', cartella: WORKTREE, prompt: 'crea un file' })
  const testo = String(scrive.result ?? scrive.text ?? scrive.deny)
  expect(testo).toMatch(/Lavoro Copilot "prova" avviato in background \(pid 4242\)/)
  expect(testo).toMatch(/Modello claude-sonnet-4\.6, sforzo deciso da Copilot/)
  expect(testo).toMatch(/Permesso auto \(puo scrivere e lanciare comandi\)/)
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv.slice(3)).toEqual([BIN_COPILOT, 'prova', WORKTREE, `${CARTELLA}/prova`, 'claude-sonnet-4.6', '', `${CARTELLA}/esegui.log`, 'auto'])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE })
  const scritto = amb.scritti.get(`${CARTELLA}/prova/prova.prompt.md`) ?? ''
  expect(scritto.startsWith('crea un file\n\nREGOLE DEL PROGETTO')).toBe(true)
  expect(scritto).toMatch(/posta leggi prova/)
  // Niente giudizio di haiku per Copilot.
  expect(amb.complete).toEqual([])

  const legge = await chiama($, 'copilot_avvia', { nome: 'sola-lettura', cartella: WORKTREE, prompt: 'leggi', scrive: false, sforzo: 'low', modello: 'gpt-5.4' })
  expect(String(legge.result)).toMatch(/Modello gpt-5\.4, sforzo low/)
  expect(String(legge.result)).toMatch(/Permesso default \(solo lettura\)/)
  const ultimo = amb.lanci.filter(l => l.argv[0] === 'bash').at(-1)
  expect(ultimo?.argv.slice(-4)).toEqual(['gpt-5.4', 'low', `${CARTELLA}/esegui.log`, 'default'])

  const memoria = amb.store.get(`regia.agenti.${SESSIONE}`) as { lanci: Record<string, { pid: number; modello?: string }> }
  expect(memoria.lanci.prova).toMatchObject({ pid: 4242, modello: 'claude-sonnet-4.6' })
})

test('copilot_avvia senza modello lascia decidere a Copilot; rifiuta un nome che c\'e gia (anche Codex) e una cartella che non esiste', async ($, on) => {
  const amb = ambiente(on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const senza = await chiama($, 'copilot_avvia', { nome: 'libero', cartella: WORKTREE, prompt: 'x' })
  expect(String(senza.result)).toMatch(/Modello scelto da Copilot, sforzo deciso da Copilot/)
  expect(amb.lanci.find(l => l.argv[0] === 'bash')?.argv.slice(7, 9)).toEqual(['', ''])
  const doppio = await chiama($, 'copilot_avvia', { nome: 'lavoro-alfa', cartella: WORKTREE, prompt: 'x' })
  expect(String(doppio.deny ?? doppio.text)).toMatch(/copilot_avvia: c'e gia un lavoro "lavoro-alfa" in corso/)
  const assente = await chiama($, 'copilot_avvia', { nome: 'nuovo', cartella: `${PROGETTO}/non-c-e`, prompt: 'x' })
  expect(String(assente.deny ?? assente.text)).toMatch(/copilot_avvia: la cartella non esiste/)
})

test('copilot_riprendi riprende la sessione scritta dallo script, con lo stesso permesso e la stessa cartella', async ($, on) => {
  const p = percorsiLavoro(HOME, 'vecchio', 'copilot')
  const rotto = percorsiLavoro(HOME, 'senza-sessione', 'copilot')
  const amb = ambiente(on, {
    esistenti: [WORKTREE],
    file: {
      [p.log]: '',
      [p.sessione]: `${UUID}\n`,
      [p.cartellaLavoro]: `${WORKTREE}\n`,
      [p.permesso]: 'default\n',
      [rotto.log]: '',
    },
  })
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'copilot_riprendi', { nome: 'vecchio', messaggio: 'continua' })
  expect(String(esito.result ?? esito.text ?? esito.deny)).toMatch(new RegExp(`Lavoro Copilot "vecchio" ripreso \\(sessione ${UUID}, pid 4242`))
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv.slice(3)).toEqual([BIN_COPILOT, 'vecchio', WORKTREE, `${CARTELLA}/vecchio`, '', '', `${CARTELLA}/esegui.log`, 'default'])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE, REGIA_RIPRENDI: UUID })
  expect(amb.scritti.get(p.riprendi)).toMatch(/^continua\n/)

  const senza = await chiama($, 'copilot_riprendi', { nome: 'mai-esistito', messaggio: 'x' })
  expect(String(senza.deny ?? senza.text)).toMatch(/copilot_riprendi: non trovo il log/)
  const senzaId = await chiama($, 'copilot_riprendi', { nome: 'senza-sessione', messaggio: 'x' })
  expect(String(senzaId.deny ?? senzaId.text)).toMatch(/copilot_riprendi: non trovo l'id della sessione Copilot di "senza-sessione"/)
})

test('sciame con esecutore copilot: scrive=false parte in sola lettura sul repo, l\'esito viene dal log di copilot', async ($, on) => {
  const amb = ambiente(on, { risposta: () => ({ isAnswered: true, text: '{"modello":"haiku","sforzo":"low"}', usage: ZERO }) })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'rileggi', prompt: 'rileggi il diff', esecutore: 'copilot', scrive: false }] })
  expect(String(esito.result ?? esito.text ?? esito.deny)).toContain('Non controllarlo')
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv[3]).toBe(BIN_COPILOT)
  expect(lancio?.argv[4]).toMatch(/^s[a-z0-9]+-rileggi$/)
  expect(lancio?.argv[5]).toBe(PROGETTO)
  expect(lancio?.argv[6]).toBe(`${CARTELLA}/${String(lancio?.argv[4])}`)
  // Primo tentativo: ne modello ne sforzo, decide Copilot.
  expect(lancio?.argv.slice(7, 9)).toEqual(['', ''])
  expect(lancio?.argv.at(-1)).toBe('default')
  const nome = String(lancio?.argv[4])

  // Lo script finisce: riga di fine nel log e rapporto in <nome>.esito.md.
  const p = percorsiLavoro(HOME, nome, 'copilot')
  amb.scritti.set(p.eseguiLog, `10:00 inizio ${nome}\n10:04 fine ${nome} (exit 0, commit 0)\n`)
  amb.scritti.set(p.esito, 'Nessun difetto.\n')
  await amb.clock?.advance(6_000)
  const compito = (amb.store.get(`regia.sciami.${SESSIONE}`) as Sciame[])[0]?.compiti[0]
  expect(compito).toMatchObject({ esecutore: 'copilot', stato: 'fatto' })
  expect(compito?.esito).toContain('Nessun difetto.')
})

test('sciame con esecutore copilot e la CLI che manca: exit 127, un secondo tentativo con lo sforzo un gradino sopra, poi fallito', async ($, on) => {
  const amb = ambiente(on)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'scrivi', prompt: 'cambia un file', esecutore: 'copilot', scrive: true }] })
  const lanci = () => amb.lanci.filter(l => l.argv[0] === 'bash')
  // Chi scrive ha il suo worktree e il permesso auto.
  expect(lanci()[0]?.argv[5]).toBe(`${PROGETTO}/.worktrees/${String(lanci()[0]?.argv[4])}`)
  expect(lanci()[0]?.argv.at(-1)).toBe('auto')
  const nome = String(lanci()[0]?.argv[4])

  // `copilot: command not found`: lo script scrive la riga di fine con exit 127 e nessun esito.
  const p = percorsiLavoro(HOME, nome, 'copilot')
  amb.scritti.set(p.eseguiLog, `10:00 inizio ${nome}\n10:00 fine ${nome} (exit 127, commit 0)\n`)
  await amb.clock?.advance(6_000)
  expect(lanci().length).toBe(2)
  expect(lanci()[1]?.argv.slice(3, 5)).toEqual([BIN_COPILOT, nome])
  expect(lanci()[1]?.argv[8]).toBe('high')
  await amb.clock?.advance(6_000)
  const compito = (amb.store.get(`regia.sciami.${SESSIONE}`) as Sciame[])[0]?.compiti[0]
  expect(compito).toMatchObject({ esecutore: 'copilot', stato: 'fallito', tentativi: 2 })
  expect(compito?.esito).toBe('exit 127, 0 commit')
})

test('il pane mostra i lavori Copilot come quelli Codex: vivi dal processo, finiti e falliti dal log di copilot, esecutore copilot', () => {
  const percorso = `${HOME}/${LOG_COPILOT_REGIA}`
  const { voci } = parseEseguiLog('10:00 inizio finito\n10:04 fine finito (exit 0, commit 2)\n10:06 inizio rotto\n10:06 fine rotto (exit 127, commit 0)\n10:10 inizio vivo')
  const snap = costruisciSnapshot({
    ...baseInput(),
    home: HOME,
    pidMiei: new Set([500]),
    nomiSessione: new Set(['finito', 'rotto', 'vivo']),
    processi: parsePs(` 500 01:10 copilot --model claude-sonnet-4.6 --effort high ${SCRIVE} --log-dir ${CARTELLA}/vivo/log --session-id ${UUID} -C ${WORKTREE}`),
    log: [{ percorso, voci, esiti: new Set(['finito']) }],
  })
  const { inCorso, fatti } = snap.viste.sessione

  expect(inCorso.map(r => [r.nome, r.fonte, r.esecutore, r.modello, r.effort, r.fileLog])).toEqual([['vivo', 'codex', 'copilot', 'claude-sonnet-4.6', 'high', `${CARTELLA}/vivo/vivo.log`]])
  expect(fatti.find(r => r.nome === 'finito')).toMatchObject({ esecutore: 'copilot', stato: 'fatto', fileLog: `${CARTELLA}/finito/finito.log`, fileEsito: expect.stringContaining('finito.esito.md') })
  expect(fatti.find(r => r.nome === 'rotto')).toMatchObject({ esecutore: 'copilot', stato: 'fallito', esito: 'exit 127 · 0 commit' })
  expect(testoStato(snap)).toBe('● 1 copilot')
  expect(riepilogoTestuale(snap, 'sessione')).toContain('1 in corso (0 codex, 1 copilot, 0 claude, 0 altri)')

  // La riga del pane: `copilot` nel suo colore, il modello con il punto abbreviato come gli altri Claude.
  const celle = rigaTabella(inCorso[0]!, { fotogramma: 0, trascorsiSec: 0 }).celle
  expect(celle.esecutore).toEqual([{ testo: 'copilot', colore: COLORE_COPILOT }])
  expect(celle.modello?.[0]).toEqual({ testo: 'sonnet 4.6' })
})

test('/regia doctor dice se copilot c\'e, con il modello della config, o che i lavori Copilot non partiranno', () => {
  const dati = {
    versione: '1.2.3', radice: '/p', config: parseConfig({}, HOME).config, isConfigPresente: false, percorsoConfig: '/c.json',
    avvisi: [], haSuperficie: true, haAgent: true, isPonytail: false, sciamiAttivi: 0, repo: '/r', copilot: 'GitHub Copilot CLI 1.0.112',
  }

  expect(testoDoctor(dati)).toContain('Copilot: GitHub Copilot CLI 1.0.112, modello deciso da Copilot.')
  expect(testoDoctor({ ...dati, config: parseConfig({ copilotModello: 'claude-sonnet-4.6' }, HOME).config })).toContain('Copilot: GitHub Copilot CLI 1.0.112, modello claude-sonnet-4.6.')
  expect(testoDoctor({ ...dati, copilot: undefined })).toContain('Copilot: NON trovato — copilot_avvia e i compiti Copilot non partiranno.')
})

const MIN = 60_000
const LOG_COPILOT = `${HOME}/${LOG_COPILOT_REGIA}`
const LAVORO = percorsiLavoro(HOME, 'lavoro-c', 'copilot')
const EVENTI = `${HOME}/.copilot/session-state/${UUID}/events.jsonl`

test('la sorveglianza: un Copilot che scrive la sua sessione non si tocca, uno fermo (log, esito e sessione) si ferma', { timeoutMs: 60_000 }, async ($, on) => {
  mock.env(on, { HOME })
  mock.store(on, {})
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const f = { mtime: {} as Record<string, number>, uccisi: [] as string[][], sveglie: [] as string[], avvisi: [] as string[] }
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__regia__${e.name}` } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    f.avvisi.push(e.text)

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSIONE }))
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.submit', (_, e) => {
    f.sveglie.push(e.text)

    return { text: e.text } as never
  })
  on('agent.list', () => ({ value: [] }))
  on('fs.exists', (_, e) => ({ value: e.path === LOG_COPILOT || e.path === LAVORO.sessione }))
  on('fs.read', (_, e) => ({ value: e.path === LOG_COPILOT ? '14:14 inizio lavoro-c' : e.path === LAVORO.sessione ? `${UUID}\n` : '' }))
  on('fs.stat', (_, e) => {
    const m = f.mtime[e.path]
    if (m === undefined) throw new Error('ENOENT')

    return { value: { kind: 'file' as const, size: 1, mtimeMs: m, isLink: false } }
  })
  on('process.run', (_, e) => {
    const [cmd] = e.argv
    if (cmd === 'kill') f.uccisi.push([...e.argv])
    const stdout = cmd === 'ps' ? `  PID ELAPSED COMMAND\n 2222 59:00 copilot ${SCRIVE} --log-dir ${LAVORO.cartella}/log --session-id ${UUID} -C /p\n`
      : cmd === 'grep' ? `/proc/2222/environ:CLAUDE_CODE_SESSION_ID=${SESSIONE}\0` : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  // Lo stderr tace da 45 min e l'esito pure, ma Copilot scrive gli eventi della sua sessione.
  f.mtime[LAVORO.log] = clock.now() - 45 * MIN
  f.mtime[LAVORO.esito] = clock.now() - 45 * MIN
  f.mtime[EVENTI] = clock.now() - 2 * MIN
  for (let i = 0; i < 3; i++) await clock.advance(MIN)
  expect(f.uccisi).toEqual([])

  // Fermi tutti e tre da oltre 30 min: lo ferma e lo dice alla principale.
  f.mtime[EVENTI] = clock.now() - 40 * MIN
  await clock.advance(MIN)
  expect(f.uccisi).toEqual([['kill', '2222']])
  expect(f.avvisi.some(t => /Copilot lavoro-c fermo da 41 min, fermato/.test(t))).toBe(true)
  expect(f.sveglie.join('\n')).toContain('Copilot "lavoro-c": nessun segno di vita da 41 min')
  expect(f.sveglie.join('\n')).toContain('copilot_riprendi o un nuovo lavoro')
})
