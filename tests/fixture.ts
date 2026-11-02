// Dati di prova comuni ai test del pane: un log, ps, l'ambiente dei processi,
// un registro e una sessione con le sue fonti finte.

import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { nomiAggiornati } from '../hooks/model'
import { parseEseguiLog } from '../hooks/parsers'
import type { ProcessoCodex } from '../hooks/parsers'

export const HOME = '/home/t'
export const SESSIONE = 'sessione-mia'
export const ALTRA = 'sessione-altrui'
export const LOG = `${HOME}/.claude/regia/codex/esegui.log`
export const REGISTRO = `${HOME}/.claude/regia/registro.json`
/** Config con il log elencato: di default la mod legge solo il suo. */
export const CONFIG = `${HOME}/.claude/regia/config.json`
export const WORKTREE = `${HOME}/DEV/progetto-demo/.worktrees/lavoro-alfa`
export const ALTRO_WORKTREE = `${HOME}/DEV/altro-progetto/ramo-delta`

export const TESTO_LOG = [
  '12:27 inizio lavoro-beta',
  '13:10 fine lavoro-beta (exit 0, commit 5)',
  '13:20 inizio lavoro-gamma',
  '13:21 fine lavoro-gamma (exit 143)',
  '14:06 inizio studio-altrui',
  '14:14 inizio lavoro-delta',
  '14:14 inizio lavoro-alfa',
  '18:29 TUTTO FINITO',
].join('\n')

export const PS = [
  '  PID ELAPSED COMMAND',
  ` 1234 21:00 codex exec -m gpt-6-astra -c model_reasoning_effort=high -C ${WORKTREE} -o lavoro-alfa.esito.md -`,
  ` 1300 21:00 codex exec -m gpt-6-astra -c model_reasoning_effort=high -C ${ALTRO_WORKTREE} -o lavoro-delta.esito.md -`,
].join('\n')

// grep -az -H sull'ambiente dei processi: il pid 1234 e della sessione, il 1300 no.
export const GREP = [
  `/proc/1234/environ:CLAUDE_CODE_SESSION_ID=${SESSIONE}`,
  `/proc/1300/environ:CLAUDE_CODE_SESSION_ID=${ALTRA}`,
  '',
].join('\0')

export const REGISTRO_JSON = JSON.stringify({
  lavori: [
    { id: 'prossimo', titolo: 'Prossimo lavoro', stato: 'scaletta', esecutore: 'codex' },
    { id: 'rotta', titolo: 'voce rotta', stato: '???' },
  ],
})

export const PANE = {
  plugin: 'regia',
  component: 'Pane',
  requestId: 'regia',
  props: {
    title: 'Regia agenti',
    isFocused: false,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

export const processi: ProcessoCodex[] = [
  { pid: 1234, durataSec: 1260, nome: 'lavoro-alfa', modello: 'gpt-6-astra', effort: 'high', cartella: WORKTREE },
  { pid: 1300, durataSec: 1260, nome: 'lavoro-delta', modello: 'gpt-6-astra', effort: 'high', cartella: ALTRO_WORKTREE },
]

export function baseInput() {
  const nomiSessione = new Set(nomiAggiornati(['lavoro-beta', 'lavoro-gamma'], processi, new Set([1234])))

  return {
    oraMs: 1000,
    home: HOME,
    processi,
    log: [{ percorso: LOG, voci: parseEseguiLog(TESTO_LOG).voci, esiti: new Set<string>() }],
    isRegistroPresente: false,
    tempiPrecedenti: {},
    isPrimaLettura: false,
    avvisi: [],
    pidMiei: new Set([1234]),
    nomiSessione,
  }
}

export const LOG_STRADA = `${HOME}/.claude/regia/codex/lavoro-alfa/lavoro-alfa.log`

export const AGENTE_FINITO = { id: 'a-finito', description: 'per le mappe 3d che componenti usiamo', type: 'fork', status: 'completed' as const }
export const AGENTE_VIVO = { id: 'a-vivo', description: 'revisione heatmap', type: 'code-reviewer', status: 'running' as const }

/** Una sessione con tutte le fonti finte; i subagenti Claude falliscono. */
export function fontiFinte(on: On, opzioni: { isAgentiNegati?: boolean; agenti?: () => unknown[]; store?: Record<string, unknown> } = {}) {
  mock.env(on, { HOME })
  // Lavori gia attribuiti a questa sessione in una lettura precedente.
  mock.store(on, {
    [`regia.sessione.${SESSIONE}`]: {
      nomi: ['lavoro-beta', 'lavoro-gamma'],
      aggiornatoMs: 1_700_000_000_000,
    },
    ...opzioni.store,
  })
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const percorsiPresenti = new Set([LOG, REGISTRO, LOG_STRADA, CONFIG])
  on('session.repo', () => ({ value: { root: `${HOME}/DEV/progetto-demo`, name: 'progetto-demo', remote: null, internal: false } }))
  on('command.register', () => ({ value: { command: 'regia' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__regia__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSIONE }))
  on('fs.exists', (_, e) => ({ value: percorsiPresenti.has(e.path) }))
  on('fs.read', (_, e) => ({
    value: e.path === LOG ? TESTO_LOG
      : e.path === CONFIG ? JSON.stringify({ codexLogs: [LOG] })
        : REGISTRO_JSON,
  }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'ps' ? PS
        : e.argv[0] === 'tail' ? 'riga uno\n\x1b[32mriga\tdue\x1b[0m\n' : GREP,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  if (opzioni.agenti !== undefined) {
    const dai = opzioni.agenti
    on('agent.list', () => ({ value: dai() as never }))
  } else if (opzioni.isAgentiNegati === false) {
    on('agent.list', () => ({ value: [AGENTE_FINITO, AGENTE_VIVO] }))
  } else {
    on('agent.list', () => ({ deny: 'non disponibile' }))
  }

  return clock
}
