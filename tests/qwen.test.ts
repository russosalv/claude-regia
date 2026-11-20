// Qwen/Qoder: riga di comando e permesso, processi `qwen` nel pane, qwen_avvia, riprendi e sciame con esecutore qwen.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { SCHEMA_QWEN_AVVIA, permessoQwen, percorsiLavoro, validaRichiesta } from '../hooks/codex'
import { costruisciSnapshot, testoStato } from '../hooks/model'
import { esecutoreDelLog, parseEseguiLog, parsePs } from '../hooks/parsers'
import { LOG_QWEN_REGIA } from '../hooks/registro'
import { isHelpQwenCompatibile, trovaCliQwen } from '../hooks/qwen-cli'
import type { Sciame } from '../hooks/sciame'
import { HOME, SESSIONE, baseInput } from './fixture'
import { PROGETTO, WORKTREE, ZERO, ambiente } from './ambiente'

const BIN_QWEN = `${HOME}/.claude/regia/bin/qwen-esegui`
const CARTELLA = `${HOME}/.claude/regia/qwen`

const HELP_COMPATIBILE = [
  '--permission-mode', '--strict-mcp-config', '--session-id', '--name', '--cwd',
  '--print', '--resume', '--model', '--reasoning-effort',
].join('\n')

test('il resolver accetta soltanto una CLI con tutto il contratto usato dal launcher', () => {
  expect(isHelpQwenCompatibile(HELP_COMPATIBILE)).toBe(true)
  expect(isHelpQwenCompatibile(HELP_COMPATIBILE.replace('--strict-mcp-config', '--mcp-config'))).toBe(false)
  expect(isHelpQwenCompatibile(HELP_COMPATIBILE.replace('--print', '--print-config'))).toBe(false)
})

type RispostaProcesso = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
const engineProcesso = (run: (argv: readonly string[]) => RispostaProcesso): EngineInterface => ({
  process: { run: async (argv: readonly string[]) => run(argv) },
} as unknown as EngineInterface)

test('il resolver preferisce qwen compatibile e non interroga qoder', async () => {
  const chiamate: string[] = []
  const engine = engineProcesso(argv => {
    chiamate.push(argv.join(' '))
    const stdout = argv[1] === '--help' ? HELP_COMPATIBILE : 'qwen 1.0.0'

    return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  })

  expect(await trovaCliQwen(engine)).toEqual({ comando: 'qwen', versione: 'qwen 1.0.0' })
  expect(chiamate).toEqual(['qwen --help', 'qwen --version'])
})

test('il resolver usa qoder se qwen manca o non e compatibile', async () => {
  const engine = engineProcesso(argv => {
    const [comando, opzione] = argv
    const isQoder = comando === 'qoder'
    const stdout = opzione === '--help' ? (isQoder ? HELP_COMPATIBILE : '--model\n--resume') : '1.1.93'

    return { exitCode: isQoder ? 0 : 127, stdout, stderr: isQoder ? '' : 'command not found', isStdoutTruncated: false, isStderrTruncated: false }
  })

  expect(await trovaCliQwen(engine)).toEqual({ comando: 'qoder', versione: 'qoder 1.1.93' })
})

test('il resolver usa qoder se qwen ha help compatibile ma --version fallisce', async () => {
  const engine = engineProcesso(argv => {
    const [comando, opzione] = argv
    if (opzione === '--help') return { exitCode: 0, stdout: HELP_COMPATIBILE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const isQoder = comando === 'qoder'

    return { exitCode: isQoder ? 0 : 1, stdout: isQoder ? '1.1.93' : '', stderr: isQoder ? '' : 'version failed', isStdoutTruncated: false, isStderrTruncated: false }
  })

  expect(await trovaCliQwen(engine)).toEqual({ comando: 'qoder', versione: 'qoder 1.1.93' })
})

test('il resolver non dichiara usabile una famiglia senza alcuna CLI compatibile', async () => {
  const engine = engineProcesso(() => ({
    exitCode: 0, stdout: '--model\n--resume', stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
  }))

  expect(await trovaCliQwen(engine)).toBeUndefined()
})

const chiama = ($: Engine, tool: string, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: `mcp__regia__${tool}`, ...argomenti } as never) as Promise<{ result?: string; deny?: string; text?: string }>

test('permessoQwen: auto per chi scrive (provato: accept_edits rifiuta git e python), default per chi legge', () => {
  expect(permessoQwen(undefined)).toBe('auto')
  expect(permessoQwen(true)).toBe('auto')
  expect(permessoQwen(false)).toBe('default')
})

test('validaRichiesta legge scrive; lo schema di qwen_avvia lo ha e Codex no', () => {
  expect(validaRichiesta({ nome: 'q', cartella: '/a', prompt: 'p', scrive: false }, HOME).richiesta?.scrive).toBe(false)
  expect(validaRichiesta({ nome: 'q', cartella: '/a', prompt: 'p' }, HOME).richiesta).not.toHaveProperty('scrive')
  expect(Object.keys(SCHEMA_QWEN_AVVIA.properties)).toContain('scrive')
  expect(SCHEMA_QWEN_AVVIA.required).toEqual(['nome', 'cartella', 'prompt'])
  expect(percorsiLavoro(HOME, 'q', 'qwen').eseguiLog).toBe(`${CARTELLA}/esegui.log`)
  expect(percorsiLavoro(HOME, 'q').log).toBe(`${HOME}/.claude/regia/codex/q/q.log`)
  expect(esecutoreDelLog(`${HOME}/${LOG_QWEN_REGIA}`)).toBe('qwen')
  expect(esecutoreDelLog(`${HOME}/.claude/regia/codex/esegui.log`)).toBe('codex')
})

test('parsePs riconosce un qwen lanciato dallo script, anche dietro timeout, e non un bash che ne parla', () => {
  const ps = [
    '  PID ELAPSED COMMAND',
    ` 500 01:10 timeout 14400 qwen -m qwen3-coder --reasoning-effort high --permission-mode auto --strict-mcp-config --session-id abc -n sciame-a -w ${WORKTREE} -p`,
    ` 501 01:10 qwen -m qwen3-coder --reasoning-effort high --permission-mode auto --strict-mcp-config --session-id abc -n sciame-a -w ${WORKTREE} -p`,
    ' 600 00:30 qwen -p fai una cosa --permission-mode default',
    ` 610 00:20 qoder -m coder -n qoder-vivo -w ${WORKTREE} --reasoning-effort medium -p`,
    ` 620 00:10 timeout 14400 /opt/qoder/bin/qodercli -n qodercli-vivo -w ${WORKTREE} --print`,
    ' 650 40:00 qwen',
    ' 660 40:00 qoder',
    ` 700 05:00 /bin/bash -c cd ${WORKTREE} && timeout 1500 qwen -p "ciao" --permission-mode default`,
    ` 710 05:00 /bin/bash -c qoder -p "ciao" -w ${WORKTREE}`,
    ' 720 00:05 qoder -- explain what --print does',
    ` 800 00:05 codex exec -m gpt-6-astra -C ${WORKTREE} -o c.esito.md -`,
  ].join('\n')
  const trovati = parsePs(ps)

  expect(trovati.map(p => `${p.pid}:${p.nome}:${p.esecutore ?? 'codex'}`)).toEqual([
    '500:sciame-a:qwen', '600:qwen-600:qwen', '610:qoder-vivo:qwen', '620:qodercli-vivo:qwen', '800:c:codex',
  ])
  expect(trovati[0]).toMatchObject({ modello: 'qwen3-coder', effort: 'high', cartella: WORKTREE, durataSec: 70 })
  expect(trovati[2]).toMatchObject({ modello: 'coder', effort: 'medium', cartella: WORKTREE, durataSec: 20 })
})

test('qwen_avvia lancia qwen-esegui con il permesso giusto e scrive il prompt in ~/.claude/regia/qwen', async ($, on) => {
  const amb = ambiente(on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const scrive = await chiama($, 'qwen_avvia', { nome: 'prova', cartella: WORKTREE, prompt: 'crea un file', modello: 'qwen3-coder' })
  const testo = String(scrive.result ?? scrive.text ?? scrive.deny)
  expect(testo).toMatch(/Lavoro Qwen\/Qoder "prova" avviato in background \(pid 4242\)/)
  expect(testo).toMatch(/Modello qwen3-coder, sforzo deciso da Qwen/)
  expect(testo).toMatch(/Permesso auto/)
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv.slice(3)).toEqual([BIN_QWEN, 'prova', WORKTREE, `${CARTELLA}/prova`, 'qwen3-coder', '', `${CARTELLA}/esegui.log`, 'auto'])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE })
  const scritto = amb.scritti.get(`${CARTELLA}/prova/prova.prompt.md`) ?? ''
  expect(scritto.startsWith('crea un file\n\nREGOLE DEL PROGETTO')).toBe(true)
  expect(scritto).toMatch(/posta leggi prova/)
  // Niente giudizio di haiku per Qwen, e lo script giusto e installato accanto a posta.
  expect(amb.complete).toEqual([])

  const legge = await chiama($, 'qwen_avvia', { nome: 'sola-lettura', cartella: WORKTREE, prompt: 'leggi', scrive: false, sforzo: 'low' })
  expect(String(legge.result)).toMatch(/Permesso default \(solo lettura\)/)
  expect(String(legge.result)).toMatch(/sforzo low/)
  const ultimo = amb.lanci.filter(l => l.argv[0] === 'bash').at(-1)
  expect(ultimo?.argv.slice(-3)).toEqual(['low', `${CARTELLA}/esegui.log`, 'default'])

  const memoria = amb.store.get(`regia.agenti.${SESSIONE}`) as { lanci: Record<string, { pid: number }> }
  expect(memoria.lanci.prova).toMatchObject({ pid: 4242 })
})

test('qwen_avvia rifiuta un nome che c\'e gia (anche Codex) e una cartella che non esiste', async ($, on) => {
  ambiente(on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const doppio = await chiama($, 'qwen_avvia', { nome: 'lavoro-alfa', cartella: WORKTREE, prompt: 'x' })
  expect(String(doppio.deny ?? doppio.text)).toMatch(/qwen_avvia: c'e gia un lavoro "lavoro-alfa" in corso/)
  const assente = await chiama($, 'qwen_avvia', { nome: 'nuovo', cartella: `${PROGETTO}/non-c-e`, prompt: 'x' })
  expect(String(assente.deny ?? assente.text)).toMatch(/non esiste/)
})

test('qwen_riprendi riprende la sessione scritta dallo script, con lo stesso permesso e la stessa cartella', async ($, on) => {
  const p = percorsiLavoro(HOME, 'vecchio', 'qwen')
  const amb = ambiente(on, {
    esistenti: [WORKTREE],
    file: {
      [p.log]: '',
      [p.sessione]: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed\n',
      [p.cartellaLavoro]: `${WORKTREE}\n`,
      [p.permesso]: 'default\n',
    },
  })
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'qwen_riprendi', { nome: 'vecchio', messaggio: 'continua' })
  expect(String(esito.result ?? esito.text ?? esito.deny)).toMatch(/Lavoro Qwen\/Qoder "vecchio" ripreso \(sessione 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed, pid 4242/)
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv.slice(3)).toEqual([BIN_QWEN, 'vecchio', WORKTREE, `${CARTELLA}/vecchio`, '', '', `${CARTELLA}/esegui.log`, 'default'])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE, REGIA_RIPRENDI: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed' })
  expect(amb.scritti.get(p.riprendi)).toMatch(/^continua\n/)

  const senza = await chiama($, 'qwen_riprendi', { nome: 'mai-esistito', messaggio: 'x' })
  expect(String(senza.deny ?? senza.text)).toMatch(/qwen_riprendi: non trovo il log/)
})

test('sciame con esecutore qwen: scrive=false parte in sola lettura sul repo, l\'esito viene dal log di qwen', async ($, on) => {
  const amb = ambiente(on, { risposta: () => ({ isAnswered: true, text: '{"modello":"haiku","sforzo":"low"}', usage: ZERO }) })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'rileggi', prompt: 'rileggi il diff', esecutore: 'qwen', scrive: false }] })
  expect(String(esito.result ?? esito.text ?? esito.deny)).toContain('Non controllarlo')
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv[3]).toBe(BIN_QWEN)
  expect(lancio?.argv[4]).toMatch(/^s[a-z0-9]+-rileggi$/)
  expect(lancio?.argv[6]).toBe(`${CARTELLA}/${String(lancio?.argv[4])}`)
  expect(lancio?.argv[5]).toBe(PROGETTO)
  expect(lancio?.argv.at(-1)).toBe('default')
  const nome = String(lancio?.argv[4])

  // Lo script finisce: riga di fine nel log e rapporto in <nome>.esito.md.
  const p = percorsiLavoro(HOME, nome, 'qwen')
  amb.scritti.set(p.eseguiLog, `10:00 inizio ${nome}\n10:04 fine ${nome} (exit 0, commit 0)\n`)
  amb.scritti.set(p.esito, 'Nessun difetto.\n')
  await amb.clock?.advance(6_000)
  const compito = (amb.store.get(`regia.sciami.${SESSIONE}`) as Sciame[])[0]?.compiti[0]
  expect(compito).toMatchObject({ esecutore: 'qwen', stato: 'fatto' })
  expect(compito?.esito).toContain('Nessun difetto.')
})

test('il pane mostra i lavori Qwen come quelli Codex: vivi dal processo, finiti dal log di qwen, esecutore qwen', () => {
  const percorso = `${HOME}/${LOG_QWEN_REGIA}`
  const { voci } = parseEseguiLog('10:00 inizio finito\n10:04 fine finito (exit 0, commit 2)\n10:10 inizio vivo')
  const snap = costruisciSnapshot({
    ...baseInput(),
    home: HOME,
    pidMiei: new Set([500]),
    nomiSessione: new Set(['finito', 'vivo']),
    processi: parsePs(` 500 01:10 qwen -m qwen3-coder --reasoning-effort high --permission-mode auto -n vivo -w ${WORKTREE} -p`),
    log: [{ percorso, voci, esiti: new Set(['finito']) }],
  })
  const { inCorso, fatti } = snap.viste.sessione

  expect(inCorso.map(r => [r.nome, r.fonte, r.esecutore, r.effort])).toEqual([['vivo', 'codex', 'qwen', 'high']])
  expect(fatti.find(r => r.nome === 'finito')).toMatchObject({ esecutore: 'qwen', stato: 'fatto', fileLog: `${CARTELLA}/finito/finito.log`, fileEsito: expect.stringContaining('finito.esito.md') })
  expect(testoStato(snap)).toBe('● 1 qwen')
})
