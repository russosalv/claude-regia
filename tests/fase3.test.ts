// Fase 3: posta fra agenti (subagente, principale, Codex via file, specchio
// di SendMessage, destinatari che non ci sono) e ripresa di un Codex finito.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { intestazioneLog } from '../hooks/codex'
import { piegaPosta, risolviIndirizzo } from '../hooks/posta'
import { WORKTREE, ambiente } from './ambiente'
import { AGENTE_FINITO, AGENTE_VIVO, HOME, PANE, SESSIONE } from './fixture'

const CASELLA = `${HOME}/.claude/regia/posta/posta.jsonl`
const VIVO = { ...AGENTE_VIVO, name: 'revisore' }

type Esito = { result?: unknown; deny?: string; text?: string }
const chiama = ($: Engine, tool: string, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: `mcp__regia__${tool}`, ...argomenti } as never) as Promise<Esito>
const testoDi = (e: Esito) => String(e.result ?? e.deny ?? e.text)
const avvio = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('la casella si legge per id con l\'ultimo stato; le righe rotte si saltano', () => {
  const testo = [
    JSON.stringify({ t: 'msg', id: 'a', da: 'x', a: 'principale', testo: 'uno', ora: 1, sessione: 's', stato: 'nuovo' }),
    'non json',
    JSON.stringify({ t: 'msg', id: 'b', da: 'y', a: 'z', testo: 'due', ora: 2 }),
    JSON.stringify({ t: 'stato', id: 'a', stato: 'consegnato', ora: 3 }),
    JSON.stringify({ t: 'stato', id: 'fantasma', stato: 'letto' }),
  ].join('\n')

  expect(piegaPosta(testo).map(m => `${m.id}:${m.stato}`)).toEqual(['a:consegnato', 'b:nuovo'])
})

test('gli indirizzi: principale, utente, subagenti in corso, Codex vivi; gli altri sono errori chiari', () => {
  const agenti = [{ id: 'a1', nome: 'revisore', isInCorso: true }, { id: 'a2', isInCorso: false }]
  const codex = { inCorso: ['lavoro'], finiti: ['vecchio'] }

  expect(risolviIndirizzo('principale', agenti, codex).destinatario).toEqual({ tipo: 'principale' })
  expect(risolviIndirizzo('Utente', agenti, codex).destinatario).toEqual({ tipo: 'utente' })
  expect(risolviIndirizzo('revisore', agenti, codex).destinatario).toEqual({ tipo: 'subagente', agentId: 'a1', nome: 'revisore' })
  expect(risolviIndirizzo('a1', agenti, codex).destinatario?.tipo).toBe('subagente')
  expect(risolviIndirizzo('lavoro', agenti, codex).destinatario).toEqual({ tipo: 'codex', nome: 'lavoro' })
  expect(risolviIndirizzo('a2', agenti, codex).errore).toMatch(/non e piu in corso/)
  expect(risolviIndirizzo('vecchio', agenti, codex).errore).toMatch(/codex_riprendi/)
  expect(risolviIndirizzo('nessuno', agenti, codex).errore).toBe(
    'destinatario sconosciuto: "nessuno". Indirizzi validi ora: principale, utente, revisore, lavoro',
  )
})

test('posta_invia a un subagente in corso lo mette nella sua conversazione', async ($, on) => {
  const amb = ambiente(on, { agenti: () => [VIVO] })
  const sessione = mock.session(on)
  await $.session.start(avvio)

  const esito = await chiama($, 'posta_invia', { a: 'revisore', testo: 'guarda anche i test' })

  expect(testoDi(esito)).toBe('Consegnato a revisore (id m1).')
  expect(amb.posta[0]?.dati).toMatchObject({ da: 'principale', a: 'revisore', testo: 'guarda anche i test', sessione: SESSIONE })
  const riga = sessione.appended().find(r => r.agentId === VIVO.id)
  expect(JSON.stringify(riga?.message.content)).toMatch(/Messaggio da principale \(id m1\).*guarda anche i test/)
  expect(amb.posta[1]).toEqual({ comando: 'stato', dati: ['m1', 'consegnato'] })
})

test('a un Codex in corso la posta resta in casella, senza consegna', async ($, on) => {
  const amb = ambiente(on)
  const sessione = mock.session(on)
  await $.session.start(avvio)

  const esito = await chiama($, 'posta_invia', { a: 'lavoro-alfa', testo: 'fermati dopo il commit' })

  expect(testoDi(esito)).toMatch(/In casella per il lavoro Codex "lavoro-alfa"/)
  expect(amb.posta).toHaveLength(1)
  expect(sessione.appended().filter(r => r.origin.kind === 'plugin')).toHaveLength(0)
})

test('a un destinatario che non c\'e: errore chiaro e niente in casella', async ($, on) => {
  const amb = ambiente(on, { agenti: () => [AGENTE_FINITO] })
  await $.session.start(avvio)

  const ignoto = await chiama($, 'posta_invia', { a: 'fantasma', testo: 'ci sei?' })
  const finito = await chiama($, 'posta_invia', { a: AGENTE_FINITO.id, testo: 'ci sei?' })

  expect(testoDi(ignoto)).toMatch(/destinatario sconosciuto: "fantasma"/)
  expect(testoDi(finito)).toMatch(/non e piu in corso/)
  expect(amb.posta).toEqual([])
})

test('un messaggio di Codex alla principale arriva in conversazione con un avviso', async ($, on) => {
  const daCodex = { t: 'msg', id: 'c1', da: 'prova-regia', a: 'principale', testo: 'ho finito il passo 1', ora: 5, sessione: SESSIONE, stato: 'nuovo', via: 'posta' }
  const altrui = { ...daCodex, id: 'c2', sessione: 'sessione-altrui' }
  const amb = ambiente(on, { file: { [CASELLA]: `${JSON.stringify(daCodex)}\n${JSON.stringify(altrui)}\n` } })
  const sessione = mock.session(on)
  await $.session.start(avvio)
  await amb.clock?.advance(5_000)

  const righe = sessione.appended().filter(r => r.agentId === undefined && JSON.stringify(r.message.content).includes('ho finito'))
  expect(righe).toHaveLength(1)
  expect(amb.avvisi.some(a => a.startsWith('✉ da prova-regia'))).toBe(true)
  expect(amb.posta).toEqual([{ comando: 'stato', dati: ['c1', 'consegnato'] }])
})

test('SendMessage fra agenti Claude finisce in posta come specchio', async ($, on) => {
  const amb = ambiente(on)
  on('tool.call', () => ({ result: { ok: true } }) as never)
  await $.session.start(avvio)

  await $.tool.call({ tool: 'SendMessage', to: 'revisore', message: 'controlla il file x' } as never)

  expect(amb.posta[0]?.dati).toMatchObject({ da: 'principale', a: 'revisore', testo: 'controlla il file x', via: 'SendMessage', stato: 'consegnato' })
})

test('dal pane: ✉ scrivi apre il campo e Invio manda da utente', async ($, on) => {
  const messaggio = { t: 'msg', id: 'p1', da: 'prova-regia', a: 'principale', testo: 'passo 1 fatto', ora: 1_700_000_000_000, sessione: SESSIONE, stato: 'consegnato' }
  const amb = ambiente(on, { agenti: () => [VIVO], file: { [CASELLA]: `${JSON.stringify(messaggio)}\n` } })
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(avvio)
  await $.command.run({ command: 'regia', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 110 } })
  expect(await ui.find({ type: 'Text', text: /passo 1 fatto/ })).toBeDefined()
  await ui.press({ key: `scrivi:claude:${VIVO.id}` })
  expect(await ui.find({ type: 'Text', text: /✉ a revisione heatmap/ })).toBeDefined()
  await ui.input({ key: 'testo-scrittura', text: 'stringi la revisione' })

  expect(amb.posta[0]?.dati).toMatchObject({ da: 'utente', a: 'revisore', testo: 'stringi la revisione', via: 'pane' })
  expect(await ui.find({ key: 'testo-scrittura' })).toBeUndefined()
  await ui.unmount()
})

test('intestazione del log di codex exec', () => {
  const log = 'OpenAI Codex v0.163.0\n--------\nworkdir: /w/x\nmodel: gpt-6-astra\nreasoning effort: low\nsession id: 01a1-beef\n--------\nuser\n'

  expect(intestazioneLog(log)).toEqual({ sessione: '01a1-beef', cartella: '/w/x', modello: 'gpt-6-astra', sforzo: 'low' })
})

test('codex_riprendi riprende la sessione del log, staccato; rifiuta un lavoro in corso', async ($, on) => {
  const dir = `${HOME}/.claude/regia/codex/prova`
  const log = `workdir: ${WORKTREE}\nmodel: gpt-6-astra\nreasoning effort: low\nsession id: 01a1-beef-0001\n`
  const amb = ambiente(on, { file: { [`${dir}/prova.log`]: log }, esistenti: [WORKTREE] })
  await $.session.start(avvio)

  const esito = await chiama($, 'codex_riprendi', { nome: 'prova', messaggio: 'aggiungi un test' })
  expect(testoDi(esito)).toMatch(/ripreso \(sessione 01a1-beef-0001, pid 4242, gpt-6-astra low\)/)
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE, REGIA_RIPRENDI: '01a1-beef-0001' })
  expect(amb.scritti.get(`${dir}/prova.riprendi.md`)).toMatch(/^aggiungi un test\n\n## Posta della regia/)

  const vivo = await chiama($, 'codex_riprendi', { nome: 'lavoro-alfa', messaggio: 'x' })
  expect(testoDi(vivo)).toMatch(/ancora in corso/)
})
