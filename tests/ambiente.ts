// Una sessione finta per i test dei tool (codex_avvia, codex_riprendi, posta):
// disco, store, processi, modello e la CLI della posta, tutti registrati.

import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { HOME, PS, SESSIONE } from './fixture'

export const PROGETTO = `${HOME}/DEV/progetto`
export const WORKTREE = `${PROGETTO}/.worktrees/lavoro`
export const REGOLE = `${PROGETTO}/.regia/regole.md`
export const BIN = `${HOME}/.claude/regia/bin/codex-esegui`

export type Chiamata = { argv: readonly string[]; env?: Record<string, string> }
export type Ambiente = {
  lanci: Chiamata[]
  scritti: Map<string, string>
  complete: string[]
  store: Map<string, unknown>
  /** Cio che la mod ha scritto con la CLI della posta: `aggiungi` (il JSON) e `stato`. */
  posta: { comando: string; dati: unknown }[]
  avvisi: string[]
  clock?: MockClock
}

/** Una sessione finta per codex_avvia e gli spawn: disco, processi, modello. */
export type OpzioniAmbiente = {
  risposta?: () => unknown
  config?: unknown
  esistenti?: string[]
  /** Testi di file gia presenti, per percorso. */
  file?: Record<string, string>
  agenti?: () => unknown[]
  senzaRepo?: boolean
}

export function ambiente(on: On, opzioni: OpzioniAmbiente = {}): Ambiente {
  const stato: Ambiente = { lanci: [], scritti: new Map(), complete: [], store: new Map(), posta: [], avvisi: [] }
  const file = new Map(Object.entries(opzioni.file ?? {}))
  const esistenti = new Set([REGOLE, ...(opzioni.esistenti ?? []), ...file.keys()])
  mock.env(on, { HOME })
  stato.clock = mock.clock(on, { now: 1_700_000_000_000 })
  on('store.get', (_, e) => ({ value: stato.store.get(e.key) as never }))
  on('store.set', (_, e) => {
    stato.store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...stato.store.keys()] }))
  on('store.delete', (_, e) => {
    stato.store.delete(e.key)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__regia__${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: (opzioni.agenti?.() ?? []) as never }))
  on('ui.toast', (_, e) => {
    stato.avvisi.push(e.text)

    return { value: undefined }
  })
  on('session.id', () => ({ value: SESSIONE }))
  on('session.cwd', () => ({ value: PROGETTO }))
  on('session.repo', () => ({ value: opzioni.senzaRepo === true ? null : { root: PROGETTO, name: 'progetto', remote: null, internal: false } }))
  on('fs.stat', (_, e) => (e.path === WORKTREE
    ? { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: WORKTREE } }
    : { value: { kind: 'other' as const, size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.exists', (_, e) => ({
    value: esistenti.has(e.path) || stato.scritti.has(e.path) || (e.path.endsWith('config.json') && opzioni.config !== undefined),
  }))
  on('fs.read', (_, e) => {
    if (e.path === REGOLE) return { value: 'REGOLE DEL PROGETTO' }
    if (e.path.endsWith('config.json')) return { value: stato.scritti.get(e.path) ?? JSON.stringify(opzioni.config) }
    if (e.path.endsWith('/script/codex-esegui')) return { value: '#!/bin/bash\n' }
    if (file.has(e.path)) return { value: file.get(e.path) ?? '' }

    return { value: stato.scritti.get(e.path) ?? '' }
  })
  on('fs.write', (_, e) => {
    stato.scritti.set(e.path, e.text)

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    stato.lanci.push({ argv: e.argv, env: e.init?.env })
    const stdout = e.argv[0] === 'ps' ? PS
      : e.argv[0] === 'bash' ? '4242\n'
        : e.argv[0] === 'tail' ? (file.get(e.argv[e.argv.length - 1] ?? '') ?? '')
          : e.argv[0] === 'python3' ? cliPosta(stato, e.argv, e.init?.stdin) : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', (_, e) => {
    stato.complete.push(e.prompt)

    return { value: (opzioni.risposta?.() ?? { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: ZERO }) as never }
  })

  return stato
}

export const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** La CLI della posta finta: `aggiungi` risponde il messaggio registrato. */
function cliPosta(stato: Ambiente, argv: readonly string[], stdin: string | undefined): string {
  const comando = argv[3] ?? ''
  if (comando === 'aggiungi') {
    const dati = JSON.parse(stdin ?? '{}') as Record<string, unknown>
    stato.posta.push({ comando, dati })

    return JSON.stringify({ t: 'msg', id: `m${stato.posta.length}`, ora: 1_700_000_000_000, stato: 'nuovo', ...dati })
  }
  stato.posta.push({ comando, dati: argv.slice(4) })

  return ''
}
