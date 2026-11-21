// Qoder CLI (modelli Qwen): processi `qodercli` nel pane, qoder_avvia (modello predefinito Qwen4-Max), riprendi,
// sciame con esecutore qoder, la preferenza su qwen quando sono usabili tutti e due, doctor e sorveglianza.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { QODER_MODELLO_PREDEFINITO, SCHEMA_QODER_AVVIA, percorsiLavoro, validaRichiesta } from '../hooks/codex'
import { testoDoctor } from '../hooks/doctor'
import { COLORE_QODER, rigaTabella } from '../hooks/layout'
import { costruisciSnapshot, riepilogoTestuale, testoStato } from '../hooks/model'
import { esecutoreDelLog, parseEseguiLog, parsePs } from '../hooks/parsers'
import { LOG_QODER_REGIA, parseConfig } from '../hooks/registro'
import type { Sciame } from '../hooks/sciame'
import { HOME, SESSIONE, baseInput } from './fixture'
import { PROGETTO, WORKTREE, ZERO, ambiente } from './ambiente'
import { chiama as chiamaSciame, compiti, esterni, haiku, lungo } from './sciame-finto'

const BIN_QODER = `${HOME}/.claude/regia/bin/qoder-esegui`
const CARTELLA = `${HOME}/.claude/regia/qoder`
const UUID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'

const chiama = ($: Engine, tool: string, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: `mcp__regia__${tool}`, ...argomenti } as never) as Promise<{ result?: string; deny?: string; text?: string }>

test('il modello predefinito di Qoder e Qwen4-Max; lo schema di qoder_avvia e quello di Qwen con i suoi testi, e i file stanno in ~/.claude/regia/qoder', () => {
  expect(QODER_MODELLO_PREDEFINITO).toBe('Qwen4-Max')
  expect(Object.keys(SCHEMA_QODER_AVVIA.properties)).toEqual(['nome', 'cartella', 'prompt', 'regole', 'sforzo', 'modello', 'scrive'])
  expect(SCHEMA_QODER_AVVIA.required).toEqual(['nome', 'cartella', 'prompt'])
  expect(SCHEMA_QODER_AVVIA.properties.modello.description).toContain('Qwen4-Max')
  // I nomi dei modelli di Qoder hanno maiuscole, cifre, punto e trattino (Qwen3.8-Flash): devono passare la validazione.
  expect(validaRichiesta({ nome: 'q', cartella: '/a', prompt: 'p', modello: 'Qwen3.8-Flash', scrive: false }, HOME).richiesta).toMatchObject({ modello: 'Qwen3.8-Flash', scrive: false })
  expect(percorsiLavoro(HOME, 'q', 'qoder').eseguiLog).toBe(`${CARTELLA}/esegui.log`)
  expect(percorsiLavoro(HOME, 'q', 'qoder').sessione).toBe(`${CARTELLA}/q/q.sessione`)
  expect(esecutoreDelLog(`${HOME}/${LOG_QODER_REGIA}`)).toBe('qoder')
  expect(esecutoreDelLog(`${HOME}/.claude/regia/qwen/esegui.log`)).toBe('qwen')
  expect(esecutoreDelLog(`${HOME}/altro/esegui.log`)).toBe('codex')
})

test('la config ha qoderModello (come copilotModello): un nome, o un avviso', () => {
  expect(parseConfig({}, HOME).config.qoderModello).toBeUndefined()
  expect(parseConfig({ qoderModello: ' Qwen3.8-Max ' }, HOME).config.qoderModello).toBe('Qwen3.8-Max')
  expect(parseConfig({ qoderModello: 'due parole' }, HOME).avvisi).toEqual(['config.json: "qoderModello" non e un nome valido'])
})

test('parsePs riconosce un qodercli lanciato dallo script, anche dietro timeout, e non una sessione interattiva ne un bash che ne parla', () => {
  const riga = `-m Qwen4-Max --reasoning-effort high --permission-mode auto --session-id ${UUID} -n sciame-a -w ${WORKTREE} -p`
  const ps = [
    '  PID ELAPSED COMMAND',
    ` 500 01:10 timeout 14400 qodercli ${riga}`,
    ` 501 01:10 qodercli ${riga}`,
    // Una ripresa ha --resume invece di --session-id, ma lo stesso -n.
    ` 510 00:20 /home/t/.local/bin/qodercli -m Qwen4-Max --permission-mode default --resume ${UUID} -n ripreso -w ${WORKTREE} -p`,
    ' 600 00:30 qodercli -p fai una cosa --permission-mode default',
    ' 650 40:00 qodercli',
    ` 700 05:00 /bin/bash -c cd ${WORKTREE} && timeout 1500 qodercli -p "ciao" --permission-mode default`,
    ` 800 00:05 codex exec -m gpt-6-astra -C ${WORKTREE} -o c.esito.md -`,
  ].join('\n')
  const trovati = parsePs(ps)

  expect(trovati.map(p => `${p.pid}:${p.nome}:${p.esecutore ?? 'codex'}`)).toEqual(['500:sciame-a:qoder', '510:ripreso:qoder', '600:qoder-600:qoder', '800:c:codex'])
  expect(trovati[0]).toMatchObject({ modello: 'Qwen4-Max', effort: 'high', cartella: WORKTREE, durataSec: 70 })
})

test('qoder_avvia lancia qoder-esegui: modello dalla chiamata, da qoderModello o Qwen4-Max; permesso da scrive; nessuno sforzo inventato', async ($, on) => {
  const amb = ambiente(on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const scrive = await chiama($, 'qoder_avvia', { nome: 'prova', cartella: WORKTREE, prompt: 'crea un file' })
  const testo = String(scrive.result ?? scrive.text ?? scrive.deny)
  expect(testo).toMatch(/Lavoro Qoder "prova" avviato in background \(pid 4242\)/)
  expect(testo).toMatch(/Modello Qwen4-Max, sforzo deciso da Qoder/)
  expect(testo).toMatch(/Permesso auto \(puo scrivere e lanciare comandi\)/)
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv.slice(3)).toEqual([BIN_QODER, 'prova', WORKTREE, `${CARTELLA}/prova`, 'Qwen4-Max', '', `${CARTELLA}/esegui.log`, 'auto'])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE })
  const scritto = amb.scritti.get(`${CARTELLA}/prova/prova.prompt.md`) ?? ''
  expect(scritto.startsWith('crea un file\n\nREGOLE DEL PROGETTO')).toBe(true)
  expect(scritto).toMatch(/posta leggi prova/)
  // Niente giudizio di haiku per Qoder.
  expect(amb.complete).toEqual([])

  const legge = await chiama($, 'qoder_avvia', { nome: 'sola-lettura', cartella: WORKTREE, prompt: 'leggi', scrive: false, sforzo: 'low', modello: 'Qwen3.8-Flash' })
  expect(String(legge.result)).toMatch(/Modello Qwen3.8-Flash, sforzo low/)
  expect(String(legge.result)).toMatch(/Permesso default \(solo lettura\)/)
  const ultimo = amb.lanci.filter(l => l.argv[0] === 'bash').at(-1)
  expect(ultimo?.argv.slice(-4)).toEqual(['Qwen3.8-Flash', 'low', `${CARTELLA}/esegui.log`, 'default'])

  const memoria = amb.store.get(`regia.agenti.${SESSIONE}`) as { lanci: Record<string, { pid: number; modello?: string }> }
  expect(memoria.lanci.prova).toMatchObject({ pid: 4242, modello: 'Qwen4-Max' })
})

test('qoder_avvia usa qoderModello della config al posto del predefinito, rifiuta un nome che c\'e gia (anche Codex), una cartella che non esiste e uno spento in config', async ($, on) => {
  const amb = ambiente(on, { config: { qoderModello: 'Qwen3.8-Max' } })
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const config = await chiama($, 'qoder_avvia', { nome: 'libero', cartella: WORKTREE, prompt: 'x' })
  expect(String(config.result)).toMatch(/Modello Qwen3.8-Max, sforzo deciso da Qoder/)
  expect(amb.lanci.find(l => l.argv[0] === 'bash')?.argv.slice(7, 9)).toEqual(['Qwen3.8-Max', ''])
  const doppio = await chiama($, 'qoder_avvia', { nome: 'lavoro-alfa', cartella: WORKTREE, prompt: 'x' })
  expect(String(doppio.deny ?? doppio.text)).toMatch(/qoder_avvia: c'e gia un lavoro "lavoro-alfa" in corso/)
  const assente = await chiama($, 'qoder_avvia', { nome: 'nuovo', cartella: `${PROGETTO}/non-c-e`, prompt: 'x' })
  expect(String(assente.deny ?? assente.text)).toMatch(/qoder_avvia: la cartella non esiste/)
})

test('qoder_avvia spento in config e rifiutato, con il comando per riaccenderlo', async ($, on) => {
  ambiente(on, { config: { esecutori: ['codex', 'qwen'] } })
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const spento = await chiama($, 'qoder_avvia', { nome: 'x', cartella: WORKTREE, prompt: 'p' })
  expect(String(spento.deny ?? spento.text)).toBe('qoder_avvia: esecutore qoder spento in config: /regia executors qoder on')
})

test('qoder_riprendi riprende la sessione scritta dallo script, con lo stesso permesso e la stessa cartella; senza memoria del lancio ripiega sul modello predefinito', async ($, on) => {
  const p = percorsiLavoro(HOME, 'vecchio', 'qoder')
  const rotto = percorsiLavoro(HOME, 'senza-sessione', 'qoder')
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

  const esito = await chiama($, 'qoder_riprendi', { nome: 'vecchio', messaggio: 'continua' })
  expect(String(esito.result ?? esito.text ?? esito.deny)).toMatch(new RegExp(`Lavoro Qoder "vecchio" ripreso \\(sessione ${UUID}, pid 4242, Qwen4-Max`))
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv.slice(3)).toEqual([BIN_QODER, 'vecchio', WORKTREE, `${CARTELLA}/vecchio`, 'Qwen4-Max', '', `${CARTELLA}/esegui.log`, 'default'])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE, REGIA_RIPRENDI: UUID })
  expect(amb.scritti.get(p.riprendi)).toMatch(/^continua\n/)

  const senza = await chiama($, 'qoder_riprendi', { nome: 'mai-esistito', messaggio: 'x' })
  expect(String(senza.deny ?? senza.text)).toMatch(/qoder_riprendi: non trovo il log/)
  const senzaId = await chiama($, 'qoder_riprendi', { nome: 'senza-sessione', messaggio: 'x' })
  expect(String(senzaId.deny ?? senzaId.text)).toMatch(/qoder_riprendi: non trovo l'id della sessione Qoder di "senza-sessione"/)
})

test('sciame con esecutore qoder: scrive=false parte in sola lettura sul repo, l\'esito viene dal log di qoder', async ($, on) => {
  const amb = ambiente(on, { risposta: () => ({ isAnswered: true, text: '{"modello":"haiku","sforzo":"low"}', usage: ZERO }) })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'rileggi', prompt: 'rileggi il diff', esecutore: 'qoder', scrive: false }] })
  expect(String(esito.result ?? esito.text ?? esito.deny)).toContain('Non controllarlo')
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv[3]).toBe(BIN_QODER)
  expect(lancio?.argv[4]).toMatch(/^s[a-z0-9]+-rileggi$/)
  expect(lancio?.argv[5]).toBe(PROGETTO)
  expect(lancio?.argv[6]).toBe(`${CARTELLA}/${String(lancio?.argv[4])}`)
  // Il primo tentativo ha il modello predefinito di Qoder e nessuno sforzo.
  expect(lancio?.argv.slice(7, 9)).toEqual(['Qwen4-Max', ''])
  expect(lancio?.argv.at(-1)).toBe('default')
  const nome = String(lancio?.argv[4])

  // Lo script finisce: riga di fine nel log e rapporto in <nome>.esito.md.
  const p = percorsiLavoro(HOME, nome, 'qoder')
  amb.scritti.set(p.eseguiLog, `10:00 inizio ${nome}\n10:04 fine ${nome} (exit 0, commit 0)\n`)
  amb.scritti.set(p.esito, 'Nessun difetto.\n')
  await amb.clock?.advance(6_000)
  const compito = (amb.store.get(`regia.sciami.${SESSIONE}`) as Sciame[])[0]?.compiti[0]
  expect(compito).toMatchObject({ esecutore: 'qoder', stato: 'fatto' })
  expect(compito?.esito).toContain('Nessun difetto.')
})

test('sciame con squadra esterni, qoder e qwen usabili e haiku muto: chi legge parte da qoder, il resto ruota; qoder spento lascia qwen', async ($, on) => {
  const amb = ambiente(on, { conQoder: true, config: { squadra: 'esterni', esecutori: ['qwen', 'qoder'] } })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  await chiamaSciame($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'a', prompt: lungo('leggi a') }, { nome: 'b', prompt: lungo('leggi b') }] })

  expect(esterni(amb)).toEqual(['qoder:a', 'qwen:b'])
  expect(Object.values(compiti(amb)).map(c => c.motivoEsecutore)).toEqual(['ripiego: a rotazione', 'ripiego: a rotazione'])
})

test('haiku che nomina qoder: la sua risposta vale e il prompt lo presenta come il Qwen da preferire', async ($, on) => {
  const amb = ambiente(on, { conQoder: true, config: { squadra: 'esterni', esecutori: ['qwen', 'qoder'] }, risposta: haiku(() => amb, '{"a":"qoder","b":"qwen"}') })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  await chiamaSciame($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'a', prompt: lungo('leggi a') }, { nome: 'b', prompt: lungo('leggi b') }] })

  expect(amb.complete.some(p => p.includes('- qoder: come qwen (modelli Qwen) ma con un lancio che funziona meglio'))).toBe(true)
  expect(esterni(amb)).toEqual(['qoder:a', 'qwen:b'])
})

test('il pane mostra i lavori Qoder come quelli Codex: vivi dal processo, finiti e falliti dal log di qoder, esecutore qoder', () => {
  const percorso = `${HOME}/${LOG_QODER_REGIA}`
  const { voci } = parseEseguiLog('10:00 inizio finito\n10:04 fine finito (exit 0, commit 2)\n10:06 inizio rotto\n10:06 fine rotto (exit 127, commit 0)\n10:10 inizio vivo')
  const snap = costruisciSnapshot({
    ...baseInput(),
    home: HOME,
    pidMiei: new Set([500]),
    nomiSessione: new Set(['finito', 'rotto', 'vivo']),
    processi: parsePs(` 500 01:10 qodercli -m Qwen4-Max --reasoning-effort high --permission-mode auto --session-id ${UUID} -n vivo -w ${WORKTREE} -p`),
    log: [{ percorso, voci, esiti: new Set(['finito']) }],
  })
  const { inCorso, fatti } = snap.viste.sessione

  expect(inCorso.map(r => [r.nome, r.fonte, r.esecutore, r.modello, r.effort, r.fileLog])).toEqual([['vivo', 'codex', 'qoder', 'Qwen4-Max', 'high', `${CARTELLA}/vivo/vivo.log`]])
  expect(fatti.find(r => r.nome === 'finito')).toMatchObject({ esecutore: 'qoder', stato: 'fatto', fileLog: `${CARTELLA}/finito/finito.log`, fileEsito: expect.stringContaining('finito.esito.md') })
  expect(fatti.find(r => r.nome === 'rotto')).toMatchObject({ esecutore: 'qoder', stato: 'fallito', esito: 'exit 127 · 0 commit' })
  expect(testoStato(snap)).toBe('● 1 qoder')
  expect(riepilogoTestuale(snap, 'sessione')).toContain('1 in corso (0 codex, 1 qoder, 0 claude, 0 altri)')

  const celle = rigaTabella(inCorso[0]!, { fotogramma: 0, trascorsiSec: 0 }).celle
  expect(celle.esecutore).toEqual([{ testo: 'qoder', colore: COLORE_QODER }])
})

test('/regia doctor dice se qodercli c\'e, con il modello (predefinito o della config), o che i lavori Qoder non partiranno', () => {
  const dati = {
    versione: '1.2.3', radice: '/p', config: parseConfig({}, HOME).config, isConfigPresente: false, percorsoConfig: '/c.json',
    avvisi: [], haSuperficie: true, haAgent: true, isPonytail: false, sciamiAttivi: 0, repo: '/r', qoder: '1.1.93',
  }

  expect(testoDoctor(dati)).toContain('Qoder: 1.1.93, modello Qwen4-Max.')
  expect(testoDoctor({ ...dati, config: parseConfig({ qoderModello: 'Qwen3.8-Max' }, HOME).config })).toContain('Qoder: 1.1.93, modello Qwen3.8-Max.')
  expect(testoDoctor({ ...dati, qoder: undefined })).toContain('Qoder: NON trovato — qoder_avvia e i compiti Qoder non partiranno.')
})

const MIN = 60_000
const LOG_QODER = `${HOME}/${LOG_QODER_REGIA}`
const LAVORO = percorsiLavoro(HOME, 'lavoro-q', 'qoder')
const SESSIONE_QODER = `${HOME}/.qoder/projects/-p/${UUID}.jsonl`

test('la sorveglianza: un Qoder che scrive la sua sessione (~/.qoder) non si tocca, uno fermo (log, esito e sessione) si ferma', { timeoutMs: 60_000 }, async ($, on) => {
  mock.env(on, { HOME })
  mock.store(on, {})
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const f = { mtime: {} as Record<string, number>, uccisi: [] as string[][], sveglie: [] as string[], avvisi: [] as string[], cercati: [] as string[] }
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
  on('fs.exists', (_, e) => ({ value: e.path === LOG_QODER || e.path === LAVORO.sessione }))
  on('fs.read', (_, e) => ({ value: e.path === LOG_QODER ? '14:14 inizio lavoro-q' : e.path === LAVORO.sessione ? `${UUID}\n` : '' }))
  on('fs.stat', (_, e) => {
    const m = f.mtime[e.path]
    if (m === undefined) throw new Error('ENOENT')

    return { value: { kind: 'file' as const, size: 1, mtimeMs: m, isLink: false } }
  })
  on('process.run', (_, e) => {
    const [cmd] = e.argv
    if (cmd === 'kill') f.uccisi.push([...e.argv])
    if (cmd === 'find') f.cercati.push(String(e.argv[1]))
    const stdout = cmd === 'ps' ? `  PID ELAPSED COMMAND\n 2222 59:00 qodercli -m Qwen4-Max --permission-mode auto --session-id ${UUID} -n lavoro-q -w /p -p\n`
      : cmd === 'grep' ? `/proc/2222/environ:CLAUDE_CODE_SESSION_ID=${SESSIONE}\0`
        : cmd === 'find' ? `${SESSIONE_QODER}\n` : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  // Lo stderr tace da 45 min e l'esito pure, ma Qoder scrive la sua sessione.
  f.mtime[LAVORO.log] = clock.now() - 45 * MIN
  f.mtime[LAVORO.esito] = clock.now() - 45 * MIN
  f.mtime[SESSIONE_QODER] = clock.now() - 2 * MIN
  for (let i = 0; i < 3; i++) await clock.advance(MIN)
  expect(f.uccisi).toEqual([])
  expect(f.cercati.every(c => c === `${HOME}/.qoder/projects`)).toBe(true)
  expect(f.cercati.length).toBeGreaterThan(0)

  // Fermi tutti e tre da oltre 30 min: lo ferma e lo dice alla principale.
  f.mtime[SESSIONE_QODER] = clock.now() - 40 * MIN
  await clock.advance(MIN)
  expect(f.uccisi).toEqual([['kill', '2222']])
  expect(f.avvisi.some(t => /Qoder lavoro-q fermo da 41 min, fermato/.test(t))).toBe(true)
  expect(f.sveglie.join('\n')).toContain('Qoder "lavoro-q": nessun segno di vita da 41 min')
  expect(f.sveglie.join('\n')).toContain('qoder_riprendi o un nuovo lavoro')
})
