// Fase 2: codex_avvia, scelta dello sforzo di Codex, scelta del modello dei
// subagenti e conto dei token.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { leggiSforzoClassificato, sforzoEuristico, validaRichiesta } from '../hooks/codex'
import { conLanci } from '../hooks/agenti'
import { leggiArgomentiOpzione } from '../hooks/comando-opzioni'
import { decidi, definizioneDalFrontmatter, gradinoSu, leggiClassificazione, sceltaClassificata } from '../hooks/instradamento'
import { parseConfig } from '../hooks/registro'
import { AGENTE_VIVO, HOME, PANE, SESSIONE, fontiFinte } from './fixture'
import { BIN, PROGETTO, WORKTREE, ZERO, ambiente } from './ambiente'

const risposta = (text: string) => () => ({ isAnswered: true, text, usage: ZERO })

async function avvia($: Engine, argomenti: Record<string, unknown>) {
  return $.tool.call({ tool: 'mcp__regia__codex_avvia', ...argomenti } as never) as Promise<{ result?: unknown; deny?: string; text?: string }>
}

test('validaRichiesta rifiuta nomi con percorsi, cartelle relative, sforzi e prompt sbagliati', () => {
  expect(validaRichiesta({ nome: '../x', cartella: '/a', prompt: 'p' }, HOME).errore).toMatch(/nome non valido/)
  expect(validaRichiesta({ nome: 'a/b', cartella: '/a', prompt: 'p' }, HOME).errore).toMatch(/nome non valido/)
  expect(validaRichiesta({ nome: 'ok', cartella: 'relativa', prompt: 'p' }, HOME).errore).toMatch(/assoluto/)
  expect(validaRichiesta({ nome: 'ok', cartella: '/a', prompt: '  ' }, HOME).errore).toMatch(/vuoto/)
  expect(validaRichiesta({ nome: 'ok', cartella: '/a', prompt: 'p', sforzo: 'max' }, HOME).errore).toMatch(/sforzo/)
  expect(validaRichiesta({ nome: 'ok', cartella: '~/w', prompt: 'p' }, HOME).richiesta?.cartella).toBe(`${HOME}/w`)
})

test('sforzo euristico e lettura della classificazione', () => {
  expect(sforzoEuristico('rispondi solo OK').sforzo).toBe('low')
  expect(sforzoEuristico(`${'a'.repeat(500)} indaga la causa del guasto`).sforzo).toBe('high')
  expect(sforzoEuristico('b '.repeat(400)).sforzo).toBe('medium')
  expect(leggiSforzoClassificato('{"sforzo":"high","motivo":"molti file"}')).toEqual({ sforzo: 'high', motivo: 'molti file', daChi: 'classificazione' })
  expect(leggiSforzoClassificato('direi medium')?.sforzo).toBe('medium')
  expect(leggiSforzoClassificato('boh')).toBeUndefined()
})

test('codex_avvia lancia lo script staccato, con la sessione esportata, e risponde subito', async ($, on) => {
  const amb = ambiente(on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await avvia($, { nome: 'prova', cartella: WORKTREE, prompt: 'rispondi solo OK', sforzo: 'low' })
  const testo = String(esito.result ?? esito.text ?? esito.deny)

  expect(testo).toMatch(/pid 4242/)
  expect(testo).toMatch(/sforzo low: indicato nella chiamata/)
  const lancio = amb.lanci.find(l => l.argv[0] === 'bash')
  expect(lancio?.argv[2]).toMatch(/^setsid nohup bash/)
  expect(lancio?.argv.slice(3)).toEqual([
    BIN, 'prova', WORKTREE, `${HOME}/.claude/regia/codex/prova`, '', 'low', `${HOME}/.claude/regia/codex/esegui.log`,
  ])
  expect(lancio?.env).toEqual({ CLAUDE_CODE_SESSION_ID: SESSIONE })
  const scritto = amb.scritti.get(`${HOME}/.claude/regia/codex/prova/prova.prompt.md`) ?? ''
  expect(scritto.startsWith('rispondi solo OK\n\nREGOLE DEL PROGETTO\n\nScrivi il minimo')).toBe(true)
  expect(scritto).toContain('## Posta della regia')
  expect(scritto).toMatch(/posta leggi prova/)
  expect(amb.complete).toEqual([])
  // Il lancio e ricordato per la sessione: il pane lo attribuisce anche se finisce subito.
  const memoria = amb.store.get(`regia.agenti.${SESSIONE}`) as { lanci: Record<string, { pid: number; sforzo: string }> }
  expect(memoria.lanci.prova).toMatchObject({ pid: 4242, sforzo: 'low' })
})

test('codex_avvia rifiuta un nome in corso, una cartella che non esiste e un nome con percorso', async ($, on) => {
  const amb = ambiente(on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const doppio = await avvia($, { nome: 'lavoro-alfa', cartella: WORKTREE, prompt: 'x', sforzo: 'low' })
  expect(String(doppio.deny ?? doppio.text)).toMatch(/gia un lavoro "lavoro-alfa" in corso/)
  const assente = await avvia($, { nome: 'nuovo', cartella: `${PROGETTO}/non-c-e`, prompt: 'x', sforzo: 'low' })
  expect(String(assente.deny ?? assente.text)).toMatch(/non esiste/)
  const furbo = await avvia($, { nome: '../../etc', cartella: WORKTREE, prompt: 'x' })
  expect(String(furbo.deny ?? furbo.text)).toMatch(/nome non valido/)
  expect(amb.lanci.some(l => l.argv[0] === 'bash')).toBe(false)
})

test('senza sforzo lo sceglie haiku; se haiku non risponde, l\'euristica', async ($, on) => {
  let testoHaiku: string | undefined = '{"sforzo":"high","motivo":"indagine su molti file"}'
  const amb = ambiente(on, { risposta: () => (testoHaiku === undefined ? undefined : risposta(testoHaiku)()) })
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const alto = await avvia($, { nome: 'uno', cartella: WORKTREE, prompt: 'studia il problema' })
  expect(String(alto.result)).toMatch(/sforzo high: indagine su molti file \(scelto da classificazione\)/)
  testoHaiku = undefined
  const ripiego = await avvia($, { nome: 'due', cartella: WORKTREE, prompt: 'rispondi solo OK' })
  expect(String(ripiego.result)).toMatch(/sforzo low: compito breve \(haiku: api-error\) \(scelto da euristica\)/)
  expect(amb.complete).toHaveLength(2)
})

const SPAWN = { tool_use_id: 't1', prompt: 'trova i file', description: 'cerca', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as const

test('decidi: si guarda il compito, salvo cio che chiamata, definizione o config fissano', () => {
  const opzioni = { instradamento: true, modelli: {} }
  const scelta = (d: ReturnType<typeof decidi>) => (d.tipo === 'scelta' ? d.scelta : undefined)

  // Nessuna tabella: anche un Explore passa dalla classificazione.
  expect(decidi({ tipo: 'Explore' }, opzioni)).toEqual({ tipo: 'classifica', isModelloLasciato: false })
  expect(decidi({ tipo: 'x', model: 'opus' }, opzioni)).toMatchObject({ tipo: 'classifica', modelloFisso: 'opus' })
  expect(scelta(decidi({ tipo: 'x', model: 'opus', effort: 'low' }, opzioni))?.provenienza).toBe('esplicito')
  expect(scelta(decidi({ tipo: 'x' }, { ...opzioni, definizione: { modello: 'opus', sforzo: 'high' } }))?.provenienza).toBe('esplicito')
  expect(scelta(decidi({ tipo: 'fork' }, opzioni))?.provenienza).toBe('ereditato')
  expect(scelta(decidi({ tipo: 'x' }, { ...opzioni, instradamento: false }))?.modello).toBeUndefined()
  expect(decidi({ tipo: 'Explore' }, { ...opzioni, modelli: { Explore: 'sonnet' } })).toMatchObject({ modelloFisso: 'sonnet' })
  expect(decidi({ tipo: 'plugin:Explore' }, { ...opzioni, modelli: { Explore: 'inherit' } })).toMatchObject({ isModelloLasciato: true })
})

test('classificazione: risposta buona, risposta storta, nessuna risposta', () => {
  const d = { tipo: 'classifica', isModelloLasciato: false } as const

  expect(leggiClassificazione('{"modello":"opus","sforzo":"high","motivo":"molti file"}')).toEqual({ modello: 'opus', sforzo: 'high', motivo: 'molti file' })
  expect(sceltaClassificata(d, 'p', { testo: '{"modello":"haiku","sforzo":"low","motivo":"meccanico"}' })).toEqual({ modello: 'haiku', sforzo: 'low', motivo: 'meccanico', provenienza: 'regia' })
  const ripiego = sceltaClassificata(d, 'indaga la causa del guasto', { errore: 'api-error' })
  expect(ripiego).toMatchObject({ modello: 'sonnet', sforzo: 'high' })
  expect(ripiego.motivo).toMatch(/api-error/)
  // Cio che e fisso non si tocca, neanche se haiku dice altro.
  expect(sceltaClassificata({ ...d, modelloFisso: 'opus' }, 'p', { testo: '{"modello":"haiku","sforzo":"low"}' })).toMatchObject({ modello: 'opus', sforzo: 'low' })
  expect(sceltaClassificata({ ...d, isModelloLasciato: true }, 'p', { testo: '{"modello":"haiku","sforzo":"low"}' }).modello).toBeUndefined()
  expect(definizioneDalFrontmatter('---\nname: a\nmodel: opus\neffort: low\n---\ntesto')).toEqual({ modello: 'opus', sforzo: 'low' })
  expect(definizioneDalFrontmatter('---\nmodel: inherit\n---\n').modello).toBeUndefined()
})

test('un gradino sopra: modello e sforzo salgono, senza sfondare', () => {
  expect(gradinoSu({ modello: 'claude-haiku-4-5', sforzo: 'low' })).toEqual({ modello: 'sonnet', sforzo: 'medium' })
  expect(gradinoSu({ modello: 'claude-sonnet-5-5', sforzo: 'high' })).toEqual({ modello: 'opus', sforzo: 'xhigh' })
  expect(gradinoSu({ modello: 'claude-opus-5-5', sforzo: 'xhigh' })).toEqual({ modello: 'opus', sforzo: 'xhigh' })
  expect(gradinoSu({})).toEqual({ modello: 'opus', sforzo: 'high' })
})

/** Il tool Agent finto: risponde con cio che riceve e fa nascere il suo spawn. */
function motore($: Engine, on: On) {
  const ricevuti: { model?: string; effort?: string; prompt: string }[] = []
  let n = 0
  on('agent.spawn', (_, e) => {
    n += 1

    return { model: e.model ?? 'claude-opus-5-5', agentId: `a${n}` }
  })
  on('tool.call', { tool: 'Agent' }, async (_, e) => {
    ricevuti.push({ model: e.model, effort: e.effort, prompt: e.prompt })
    const r = await $.agent.spawn({ ...SPAWN, tool_use_id: e.tool_use_id, subagentType: e.subagent_type ?? 'general-purpose', model: e.model, prompt: e.prompt } as never)

    return { result: { status: 'async_launched', agentId: r.agentId, description: '', prompt: e.prompt, outputFile: '' } } as never
  })

  return ricevuti
}

const chiama = ($: Engine, argomenti: Record<string, unknown>) =>
  $.tool.call({ tool: 'Agent', tool_use_id: `u${JSON.stringify(argomenti).length}`, description: 'cerca', prompt: 'trova i file', ...argomenti } as never)

test('tool Agent: modello e sforzo dal compito, mai sopra cio che la chiamata dice', async ($, on) => {
  let testoHaiku: string | undefined = '{"modello":"opus","sforzo":"high","motivo":"guasto difficile"}'
  const amb = ambiente(on, { risposta: () => (testoHaiku === undefined ? undefined : risposta(testoHaiku)()) })
  const ricevuti = motore($, on)

  await chiama($, { subagent_type: 'Explore', prompt: 'indaga il guasto' })
  testoHaiku = undefined
  await chiama($, { prompt: 'correggi il titolo' })
  await chiama($, { subagent_type: 'Explore', model: 'haiku', effort: 'low' })

  expect(ricevuti.map(r => `${r.model}/${r.effort}`)).toEqual(['opus/high', 'sonnet/low', 'haiku/low'])
  // Due classificazioni: la terza chiamata aveva gia deciso tutto.
  expect(amb.complete).toHaveLength(2)
  const memoria = amb.store.get(`regia.agenti.${SESSIONE}`) as { agenti: Record<string, { modello: string; sforzo?: string; provenienza: string; motivo: string }> }
  expect(memoria.agenti.a1).toMatchObject({ modello: 'opus', sforzo: 'high', provenienza: 'regia', motivo: 'guasto difficile' })
  expect(memoria.agenti.a3).toMatchObject({ modello: 'haiku', provenienza: 'esplicito' })
})

test('il prompt del delegato riceve le regole di risparmio, che si spengono in config', async ($, on) => {
  ambiente(on, { risposta: risposta('{"modello":"haiku","sforzo":"low"}') })
  const ricevuti = motore($, on)
  await chiama($, {})

  expect(ricevuti[0]?.prompt).toContain('Scrivi il minimo')
  expect(ricevuti[0]?.prompt).toContain('Rapporto finale breve')
})

test('con la scelta spenta in config il tool Agent passa com\'e', async ($, on) => {
  ambiente(on, { config: { instradamento: false, risparmio: false } })
  const ricevuti = motore($, on)
  await chiama($, {})

  expect(ricevuti).toEqual([{ model: undefined, effort: undefined, prompt: 'trova i file' }])
})

test('turn.complete somma i token di ogni subagente', async ($, on) => {
  const amb = ambiente(on)
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10, model: 'claude-haiku-4-5' }
  on('turn.complete', () => ({ text: '' }) as never)
  const turno = { answer: 'ok', durationMs: 5, isAborted: false, turnId: 't', agentId: 'a1', usage, reason: 'answer' }
  await $.turn.complete(turno as never)
  await $.turn.complete(turno as never)

  const memoria = amb.store.get(`regia.agenti.${SESSIONE}`) as { agenti: Record<string, { token: unknown }> }
  expect(memoria.agenti.a1?.token).toEqual({ input: 200, output: 100, cacheLettura: 2000, cacheScrittura: 20 })
})

test('/regia modelli|orchestra|risparmio: argomenti e config', () => {
  expect(leggiArgomentiOpzione('modelli')).toEqual({ nome: 'modelli' })
  expect(leggiArgomentiOpzione('modelli off')).toEqual({ nome: 'modelli', valore: false })
  expect(leggiArgomentiOpzione('orchestra guida')).toEqual({ nome: 'orchestra', valore: 'guida' })
  expect(leggiArgomentiOpzione('orchestra boh')).toEqual({ nome: 'orchestra', isValoreSbagliato: true })
  expect(leggiArgomentiOpzione('tutti')).toBeUndefined()
  const config = parseConfig({ instradamento: false, modelli: { Explore: 'sonnet', rotto: 3 }, codexModello: 'gpt-5.5' }, HOME)
  expect(config.config).toMatchObject({ instradamento: false, modelli: { Explore: 'sonnet' }, codexModello: 'gpt-5.5' })
  expect(config.avvisi).toHaveLength(1)
})

test('il pane mostra il modello vero, il motivo e i token di un subagente', async ($, on) => {
  const info = { modello: 'claude-haiku-4-5-20251001', motivo: 'dalla tabella', provenienza: 'regia', token: { input: 2000, output: 500, cacheLettura: 9000, cacheScrittura: 500 } }
  const clock = fontiFinte(on, { agenti: () => [AGENTE_VIVO], store: { [`regia.agenti.${SESSIONE}`]: { agenti: { [AGENTE_VIVO.id]: info }, lanci: {}, aggiornatoMs: 1_700_000_000_000 } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 160 } })
  const riga = (await ui.find({ key: `riga:claude:${AGENTE_VIVO.id}` }))?.text ?? ''
  expect(riga).toMatch(/haiku 4\.5/)
  expect(riga).toMatch(/12k/)
  expect(riga).toMatch(/code-reviewer · dalla tab/)
  await ui.unmount()
})

test('un Codex concluso prende modello e sforzo dal lancio', () => {
  const riga = { chiave: 'log:x:0', nome: 'prova', fonte: 'codex' as const, esecutore: 'codex', stato: 'fatto' as const }
  const lancio = { pid: 1, modello: 'gpt-6-astra', sforzo: 'low', motivo: 'm', cartella: '/w', inizioMs: 0 }

  expect(conLanci([riga], { prova: lancio })[0]).toMatchObject({ modello: 'gpt-6-astra', effort: 'low' })
  expect(conLanci([riga], {})[0]?.modello).toBeUndefined()
})
