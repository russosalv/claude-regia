import { expect, test } from 'claude-code/testing'

import {
  abbreviaModello,
  accorciaPercorso,
  esitoBreve,
  formattaDurata,
  nomeLavoro,
  parseEseguiLog,
  parseEtime,
  parsePs,
  tokenizza,
} from '../hooks/parsers'
import { pidConSessione } from '../hooks/fonti'
import { parseConfig, validaRegistro } from '../hooks/registro'

const CODEX =
  'codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-6-astra -c model_reasoning_effort=high -C /home/u/DEV/progetto-demo/.worktrees/lavoro-alfa -o lavoro-alfa.esito.md -'

const PS = [
  '  PID     ELAPSED COMMAND',
  `12345       03:12 ${CODEX}`,
  // il binario figlio del launcher npm: stessi argomenti, stesso lavoro
  `12399       03:11 /usr/lib/node_modules/@openai/codex/vendor/codex ${CODEX}`,
  '  777 1-02:03:04 grep codex exec',
  '  800       00:10 bash',
  `  901    45:00 codex exec -m gpt-5.5 -c 'model_reasoning_effort="medium"' --cd=/tmp/x -o /tmp/out/altro.esito.md -`,
].join('\n')

// Il risultato è in ordine di pid: prima il 901, poi il 12345.
test('parsePs estrae modello, effort, cartella e nome dal processo codex', () => {
  const trovati = parsePs(PS)

  expect(trovati).toHaveLength(2)
  const [secondo, primo] = trovati
  expect(primo).toEqual({
    pid: 12345,
    durataSec: 192,
    nome: 'lavoro-alfa',
    modello: 'gpt-6-astra',
    effort: 'high',
    cartella: '/home/u/DEV/progetto-demo/.worktrees/lavoro-alfa',
    output: 'lavoro-alfa.esito.md',
  })
  expect(secondo).toMatchObject({
    pid: 901,
    nome: 'altro',
    output: '/tmp/out/altro.esito.md',
    modello: 'gpt-5.5',
    effort: 'medium',
    cartella: '/tmp/x',
    durataSec: 2700,
  })
})

test('parsePs ignora grep, altri processi, intestazioni e righe vuote', () => {
  expect(parsePs('')).toEqual([])
  expect(parsePs('  PID ELAPSED COMMAND\n  800 00:10 bash\n  777 00:01 grep codex exec')).toEqual([])
  expect(parsePs('  5 00:01 codex exec')).toHaveLength(1)
})

test('parseEtime copre i formati di ps', () => {
  expect(parseEtime('03:12')).toBe(192)
  expect(parseEtime('02:03:04')).toBe(7384)
  expect(parseEtime('1-02:03:04')).toBe(93784)
  expect(parseEtime('boh')).toBeUndefined()
})

test('tokenizza rispetta le virgolette e nomeLavoro ha dei ripieghi', () => {
  expect(tokenizza(`a "b c" 'd e' f=g`)).toEqual(['a', 'b c', 'd e', 'f=g'])
  expect(nomeLavoro('x/y.esito.md', undefined, 1)).toBe('y')
  expect(nomeLavoro(undefined, '/a/b/', 1)).toBe('b')
  expect(nomeLavoro(undefined, undefined, 42)).toBe('codex-42')
})

const LOG = [
  '09:00 inizio capacity',
  '09:00 capacity, riprovo (2)',
  '11:31 fine finetuning-varianti (exit 0)',
  '12:27 inizio lavoro-beta',
  '13:10 fine lavoro-beta (exit 0, commit 5)',
  '14:06 inizio lavoro-epsilon',
  '14:14 inizio lavoro-delta',
  '14:14 inizio lavoro-alfa',
  '23:50 inizio notturno',
  '00:20 fine notturno (exit 2)',
  '18:29 TUTTO FINITO',
  '09:10 inizio arch-decision visure r2',
  '09:30 fine arch-decision visure r2 (exit 0, commit 1)',
  '',
  'una riga senza ora',
].join('\n')

test('parseEseguiLog riconosce inizio, fine, exit, commit e riprovi', () => {
  const { voci, ignorate } = parseEseguiLog(LOG)
  const per = (nome: string) => voci.find(v => v.nome === nome)

  // Le annotazioni con l'ora ("TUTTO FINITO") sono legittime; conta solo la riga senza ora.
  expect(ignorate).toBe(1)
  expect(per('arch-decision visure r2')).toMatchObject({ exitCode: 0, commit: 1, durataSec: 1200 })
  expect(per('lavoro-beta')).toMatchObject({
    inizio: '12:27',
    fine: '13:10',
    durataSec: 43 * 60,
    exitCode: 0,
    commit: 5,
    isConclusa: true,
  })
  expect(per('finetuning-varianti')).toMatchObject({ exitCode: 0, isConclusa: true })
  expect(per('finetuning-varianti')?.commit).toBeUndefined()
  expect(per('capacity')).toMatchObject({ tentativi: 2, isConclusa: false })
  expect(per('lavoro-alfa')).toMatchObject({ inizio: '14:14', isConclusa: false })
  expect(per('notturno')).toMatchObject({ exitCode: 2, durataSec: 30 * 60 })
})

test('un nuovo inizio con lo stesso nome sostituisce quello rimasto aperto', () => {
  const { voci } = parseEseguiLog('10:00 inizio a\n10:30 inizio a\n10:40 fine a (exit 0)')

  expect(voci).toHaveLength(2)
  expect(voci[0]).toMatchObject({ isSostituita: true, isConclusa: false })
  expect(voci[1]).toMatchObject({ isConclusa: true, durataSec: 600 })
})

test('validaRegistro salta le voci non valide e le conta', () => {
  const esito = validaRegistro({
    lavori: [
      { id: 'a', titolo: 'Uno', stato: 'scaletta', modello: 'x' },
      { id: 'b', titolo: 'Due', stato: 'inventato' },
      { id: '', titolo: 'Tre', stato: 'fatto' },
      { id: 'c', titolo: 'Quattro', stato: 'bloccato', note: 5 },
      null,
      'stringa',
      { id: 'd', titolo: 'Cinque', stato: 'in_corso', worktree: '~/w' },
    ],
  })

  expect(esito.lavori.map(l => l.id)).toEqual(['a', 'd'])
  expect(esito.scartate).toBe(5)
  expect(esito.errore).toBeUndefined()
})

test('validaRegistro rifiuta una radice senza lista di lavori', () => {
  expect(validaRegistro({}).errore).toBeDefined()
  expect(validaRegistro([]).errore).toBeDefined()
  expect(validaRegistro(null).errore).toBeDefined()
})

test('parseConfig espande ~ e torna ai predefiniti con un avviso', () => {
  const ok = parseConfig({ codexLogs: ['~/a/log', '/b/log'], aggiornamentoSecondi: 30 }, '/home/u')
  expect(ok.config).toEqual({
    codexLogs: ['/home/u/a/log', '/b/log', '/home/u/.claude/regia/codex/esegui.log'],
    aggiornamentoSecondi: 30,
    instradamento: true,
    modelli: {},
    orchestra: 'stretta',
    risparmio: true,
    ponytail: true,
    sciameParallelo: 4,
  })
  expect(ok.avvisi).toEqual([])

  const vuota = parseConfig({}, '/home/u')
  expect(vuota.config.aggiornamentoSecondi).toBe(15)
  expect(vuota.config.codexLogs).toEqual(['/home/u/.claude/regia/codex/esegui.log'])
  expect(vuota.config.codexModello).toBeUndefined()

  const storta = parseConfig({ codexLogs: 'no', aggiornamentoSecondi: 0 }, '/home/u')
  expect(storta.avvisi).toHaveLength(2)
  expect(storta.config.aggiornamentoSecondi).toBe(15)
  expect(parseConfig(7, '/h').avvisi).toHaveLength(1)
})

test('durate compatte, modelli abbreviati, esiti brevi e percorsi corti', () => {
  expect(formattaDurata(45)).toBe('<1m')
  expect(formattaDurata(1260)).toBe('21m')
  expect(formattaDurata(3840)).toBe('1h04')
  expect(formattaDurata(190000)).toBe('2g')
  expect(abbreviaModello('gpt-6-astra')).toBe('astra')
  expect(abbreviaModello('gpt-5.5')).toBe('5.5')
  expect(abbreviaModello('sonnet')).toBe('sonnet')
  expect(abbreviaModello('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  expect(abbreviaModello('claude-opus-5-5')).toBe('opus 5.5')
  expect(esitoBreve('exit 0 · 5 commit')).toBe('5 commit')
  expect(esitoBreve('exit 143')).toBe('exit 143')
  expect(esitoBreve('exit 0')).toBe('ok')
  expect(esitoBreve('interrotto (nessun processo vivo)')).toBe('interrotto')
  expect(accorciaPercorso('/home/u/x', '/home/u')).toBe('~/x')
  expect(
    accorciaPercorso('/home/u/DEV/progetto-demo/.worktrees/lavoro-alfa', '/home/u'),
  ).toBe('…/.worktrees/lavoro-alfa')
  expect(accorciaPercorso('/altro/posto', '/home/u')).toBe('/altro/posto')
})

test('pidConSessione tiene solo i processi con il proprio id di sessione', () => {
  const uscita = [
    '/proc/10/environ:CLAUDE_CODE_SESSION_ID=mio',
    '/proc/11/environ:CLAUDE_CODE_SESSION_ID=altrui',
    '/proc/12/environ:CLAUDE_CODE_SESSION_ID=mio',
    '',
  ].join('\0')

  expect([...pidConSessione(uscita, 'mio')]).toEqual([10, 12])
  expect(pidConSessione('', 'mio').size).toBe(0)
})
