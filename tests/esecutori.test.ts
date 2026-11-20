// Gli esecutori esterni: la chiave `esecutori` in config, `/regia executors`, chi e usabile,
// e la scelta dell'esecutore per i compiti di uno sciame che non lo indicano
// (vincoli, una domanda ad haiku, ripiego a rotazione), fino al pane.
// Qui la squadra e `esterni` (il comportamento della 0.15) dove non si dice altro;
// le tre squadre e la quota stanno in `squadra.test.ts`.

import { expect, test } from 'claude-code/testing'

import { percorsiLavoro } from '../hooks/codex'
import { leggiArgomentiEsecutori } from '../hooks/comando-opzioni'
import { testoDoctor } from '../hooks/doctor'
import { rigaEsecutori, soloUsabili, statoEsecutori, testoEsecutori } from '../hooks/esecutori'
import { CARATTERI_COMPITO, MINIMO_AUTOSUFFICIENTE, assegnaEsecutori, daChiedere, leggiEsecutori, promptEsecutori, ripiegoEsecutori, vincoloEsecutore } from '../hooks/instradamento'
import { costruisciSnapshot } from '../hooks/model'
import { parseConfig } from '../hooks/registro'
import { MOTIVO_INDICATO, caricoEsterni, chiHaScelto, compitoConSpento, conLancio, conRipiegoClaude, conScelte, creaSciame, descrivi, isEsternoSceltoDallaMod } from '../hooks/sciame'
import type { Sciame } from '../hooks/sciame'
import { cellWidth } from '../hooks/tavola'
import { HOME, PANE, SESSIONE, baseInput } from './fixture'
import { PROGETTO, WORKTREE, ambiente } from './ambiente'
import type { Ambiente } from './ambiente'
import { resa } from './resa'
import { chiama, comando, compiti, domande, esterni, haiku, lungo, motore, sciami, testoDi } from './sciame-finto'

const TUTTI = ['codex', 'qwen', 'copilot'] as const
const ESTERNI = { squadra: 'esterni', quota: 50 } as const
const compito = (nome: string, extra: { scrive?: boolean; prompt?: string; tipo?: string } = {}) =>
  ({ nome, prompt: extra.prompt ?? lungo(`fai ${nome}`), scrive: extra.scrive ?? false, ...(extra.tipo === undefined ? {} : { tipo: extra.tipo }) })

test('config: "esecutori" e una lista fra codex, qwen, copilot; predefiniti tutti, i nomi sconosciuti si tolgono con un avviso', () => {
  expect(parseConfig({}, HOME).config.esecutori).toEqual([...TUTTI])
  expect(parseConfig({ esecutori: ['qwen', ' Codex ', 'qwen'] }, HOME)).toMatchObject({ config: { esecutori: ['codex', 'qwen'] }, avvisi: [] })
  // Lista vuota: lavora solo Claude, senza avvisi.
  expect(parseConfig({ esecutori: [] }, HOME)).toMatchObject({ config: { esecutori: [] }, avvisi: [] })

  const ignoti = parseConfig({ esecutori: ['copilot', 'gemini', 7] }, HOME)
  expect(ignoti.config.esecutori).toEqual(['copilot'])
  expect(ignoti.avvisi).toEqual(['config.json: in "esecutori" tolti i nomi sconosciuti "gemini", 7 (validi: codex, qwen, copilot)'])

  const nonLista = parseConfig({ esecutori: 'codex' }, HOME)
  expect(nonLista.config.esecutori).toEqual([...TUTTI])
  expect(nonLista.avvisi).toEqual(['config.json: "esecutori" deve essere una lista fra codex, qwen, copilot'])
})

test('usabile e chi e acceso in config e ha la CLI: il doctor e /regia executors dicono chi no e perche', () => {
  const stati = statoEsecutori(['codex', 'copilot'], { codex: 'codex-cli 1.2', qwen: 'qwen 0.9' })

  expect(soloUsabili(stati)).toEqual(['codex'])
  expect(rigaEsecutori(stati)).toBe('Esecutori: usabili codex; qwen no (spento in config), copilot no (CLI non trovata) — /regia executors.')
  expect(rigaEsecutori(statoEsecutori([], {}))).toBe('Esecutori: nessuno usabile, negli sciami lavora solo Claude; codex no (spento in config, CLI non trovata), qwen no (spento in config, CLI non trovata), copilot no (spento in config, CLI non trovata) — /regia executors.')
  expect(rigaEsecutori(statoEsecutori([...TUTTI], { codex: 'a', qwen: 'b', copilot: 'c' }))).toBe('Esecutori: usabili codex, qwen, copilot — /regia executors.')

  const testo = testoEsecutori(stati)
  expect(testo).toContain('Esecutori esterni usabili ora: codex.')
  expect(testo).toContain('  codex: acceso · CLI trovata (codex-cli 1.2)')
  expect(testo).toContain('  qwen (Qwen/Qoder): spento in config · CLI trovata (qwen 0.9)')
  expect(testo).toContain('  copilot: acceso · CLI non trovata')
  expect(testo).toContain('/regia executors codex|qwen|copilot on|off')
  expect(testoEsecutori(statoEsecutori([], {}))).toContain('usabili ora: nessuno, negli sciami lavora solo Claude.')

  const dati = {
    versione: '1.2.3', radice: '/p', config: parseConfig({ esecutori: ['codex', 'qwen'] }, HOME).config, isConfigPresente: true, percorsoConfig: '/c.json',
    avvisi: [], haSuperficie: true, haAgent: true, isPonytail: false, sciamiAttivi: 0, repo: '/r', codex: 'codex-cli 1', copilot: 'Copilot 1',
  }
  expect(testoDoctor(dati)).toContain('Esecutori: usabili codex; qwen no (CLI non trovata), copilot no (spento in config) — /regia executors.')
  expect(testoDoctor({ ...dati, qwen: 'qoder 1.1.93' })).toContain('Qwen/Qoder: qoder 1.1.93.')
})

test('gli argomenti di /regia executors: mostra, accende o spegne uno dei tre; il resto e sbagliato o non e questo comando', () => {
  expect(leggiArgomentiEsecutori('executors')).toEqual({})
  expect(leggiArgomentiEsecutori(' Esecutori ')).toEqual({})
  expect(leggiArgomentiEsecutori('executors codex off')).toEqual({ esecutore: 'codex', valore: false })
  expect(leggiArgomentiEsecutori('esecutori copilot ON')).toEqual({ esecutore: 'copilot', valore: true })
  expect(leggiArgomentiEsecutori('executors codex')).toEqual({ isSbagliato: true })
  expect(leggiArgomentiEsecutori('executors claude off')).toEqual({ isSbagliato: true })
  expect(leggiArgomentiEsecutori('executors qwen on subito')).toEqual({ isSbagliato: true })
  expect(leggiArgomentiEsecutori('codex off')).toBeUndefined()
  expect(leggiArgomentiEsecutori('doctor')).toBeUndefined()
})

test('i vincoli decidono da soli: un tipo di agente resta a Claude, e senza esterni usabili tutto resta a Claude', () => {
  expect(vincoloEsecutore({ tipo: 'code-reviewer' }, [...TUTTI], 'esterni')).toEqual({ esecutore: 'claude', motivo: 'scelto dalla mod: tipo di agente Claude' })
  expect(vincoloEsecutore({}, [], 'esterni')).toEqual({ esecutore: 'claude', motivo: 'scelto dalla mod: nessun esterno usabile' })
  expect(vincoloEsecutore({}, ['qwen'], 'esterni')).toBeUndefined()
  expect(daChiedere([compito('a'), compito('b', { tipo: 'Explore' })], ['qwen'], ESTERNI).map(c => c.nome)).toEqual(['a'])
  expect(daChiedere([compito('a')], [], ESTERNI)).toEqual([])
})

test('il prompt per haiku: tutti i compiti insieme con nome, se scrivono e l\'inizio del prompt; solo gli esecutori usabili', () => {
  const testo = promptEsecutori([compito('api', { scrive: true, prompt: `  ${'x'.repeat(CARATTERI_COMPITO)}CODA  ` }), compito('doc', { prompt: 'riassumi i moduli' })], ['codex', 'qwen'], ESTERNI)

  expect(testo).toContain('- claude: servono i tool, i server MCP, le skill o i tipi di agente di questa sessione')
  expect(testo).toContain('- codex: implementazione autonoma di un compito ben specificato, debug, revisione del codice, audit.')
  expect(testo).toContain('- qwen: modifiche meccaniche o in blocco')
  expect(testo).not.toContain('- copilot:')
  expect(testo).toContain('non dare tutto a claude quando un esecutore esterno puo farlo')
  expect(testo).toContain('Rispondi SOLO con JSON su una riga, una voce per compito: {"<nome del compito>":"<claude|codex|qwen>"}')
  expect(testo).toContain('Compito "api" (scrive file):')
  expect(testo).toContain('Compito "doc" (legge soltanto):\nriassumi i moduli')
  // Del prompt di un compito passano i primi caratteri soltanto.
  expect(testo).toContain(`\n${'x'.repeat(CARATTERI_COMPITO)}\n`)
  expect(testo).not.toContain('CODA')
  expect(promptEsecutori([compito('a')], ['copilot'], ESTERNI)).toContain('- copilot: implementazione autonoma di un compito ben specificato; un\'altra famiglia di modelli')
})

test('della risposta di haiku si tengono solo i compiti chiesti e solo claude o un esecutore usabile', () => {
  const nomi = ['a', 'b', 'c', 'constructor']

  expect([...leggiEsecutori('Ecco: {"a":"codex","b":" Claude ","c":"copilot","d":"codex","constructor":"gemini"} fine', nomi, ['codex', 'qwen'])]).toEqual([['a', 'codex'], ['b', 'claude']])
  expect(leggiEsecutori('non lo so', nomi, [...TUTTI]).size).toBe(0)
  expect(leggiEsecutori('{"a":', nomi, [...TUTTI]).size).toBe(0)
  expect(leggiEsecutori('["codex"]', nomi, [...TUTTI]).size).toBe(0)
  expect(leggiEsecutori('{"a":{"esecutore":"codex"},"b":3}', nomi, [...TUTTI]).size).toBe(0)
  // Un compito che si chiama come una proprieta di ogni oggetto non inganna nessuno.
  expect(leggiEsecutori('{}', nomi, [...TUTTI]).has('constructor')).toBe(false)
})

test('il ripiego: i compiti lunghi a rotazione sugli esterni, al meno carico, chi scrive da codex e chi legge da qwen; i brevi restano a Claude', () => {
  const scelte = (compiti: ReturnType<typeof compito>[], usabili: readonly ('codex' | 'qwen' | 'copilot')[], carico?: Map<string, number>) =>
    [...ripiegoEsecutori(compiti, usabili, carico)].map(([nome, s]) => `${nome}:${s.esecutore}`)
  const scrive = (nome: string) => compito(nome, { scrive: true })

  // Chi scrive: codex, copilot, qwen; poi di nuovo dal primo.
  expect(scelte([scrive('a'), scrive('b'), scrive('c'), scrive('d')], [...TUTTI])).toEqual(['a:codex', 'b:copilot', 'c:qwen', 'd:codex'])
  // Chi legge: qwen, codex, copilot.
  expect(scelte([compito('a'), compito('b'), compito('c'), compito('d')], [...TUTTI])).toEqual(['a:qwen', 'b:codex', 'c:copilot', 'd:qwen'])
  // Misti: conta il carico di tutti, non il tipo di compito.
  expect(scelte([scrive('a'), compito('b'), scrive('c'), compito('d')], [...TUTTI])).toEqual(['a:codex', 'b:qwen', 'c:copilot', 'd:qwen'])
  // Solo fra gli usabili, e partendo da chi ha gia meno compiti.
  expect(scelte([scrive('a'), scrive('b'), scrive('c')], ['codex', 'qwen'])).toEqual(['a:codex', 'b:qwen', 'c:codex'])
  expect(scelte([scrive('a'), scrive('b')], [...TUTTI], new Map([['codex', 2], ['copilot', 1]]))).toEqual(['a:qwen', 'b:copilot'])

  // Sotto la soglia un prompt non e autosufficiente: resta a Claude e non entra nel conto.
  const breve = compito('breve', { prompt: 'x'.repeat(MINIMO_AUTOSUFFICIENTE - 1) })
  const esito = ripiegoEsecutori([breve, compito('giusto', { prompt: 'x'.repeat(MINIMO_AUTOSUFFICIENTE) }), compito('altro')], [...TUTTI])
  expect(esito.get('breve')).toEqual({ esecutore: 'claude', motivo: 'ripiego: compito breve' })
  expect(esito.get('giusto')).toEqual({ esecutore: 'qwen', motivo: 'ripiego: a rotazione' })
  expect(esito.get('altro')?.esecutore).toBe('codex')
  expect(ripiegoEsecutori([compito('a')], []).get('a')).toEqual({ esecutore: 'claude', motivo: 'ripiego: nessun esterno usabile' })
})

test('assegnare: prima i vincoli, poi cio che haiku ha detto, poi il ripiego per chi resta (contando chi haiku ha gia caricato)', () => {
  const compiti = [compito('rev', { tipo: 'code-reviewer' }), compito('a', { scrive: true }), compito('b', { scrive: true }), compito('c'), compito('corto', { prompt: 'guarda il file' })]
  const con = (risposta: string | undefined) => Object.fromEntries([...assegnaEsecutori(compiti, [...TUTTI], risposta, ESTERNI)].map(([nome, s]) => [nome, `${s.esecutore} · ${s.motivo}`]))

  expect(con('{"a":"codex","c":"claude","rev":"qwen","b":"gemini"}')).toEqual({
    rev: 'claude · scelto dalla mod: tipo di agente Claude',
    a: 'codex · scelto dalla mod: dal compito',
    c: 'claude · scelto dalla mod: dal compito',
    // codex ha gia `a`: il ripiego passa al prossimo di chi scrive.
    b: 'copilot · ripiego: a rotazione',
    corto: 'claude · ripiego: compito breve',
  })
  // Haiku non ha risposto: tutto il resto al ripiego.
  expect(con(undefined)).toEqual({
    rev: 'claude · scelto dalla mod: tipo di agente Claude',
    a: 'codex · ripiego: a rotazione',
    b: 'copilot · ripiego: a rotazione',
    c: 'qwen · ripiego: a rotazione',
    corto: 'claude · ripiego: compito breve',
  })
  // Senza esterni usabili non c'e nulla da chiedere ne da distribuire.
  expect([...assegnaEsecutori(compiti, [], undefined, ESTERNI).values()].every(s => s.esecutore === 'claude' && s.motivo === 'scelto dalla mod: nessun esterno usabile' || s.motivo.endsWith('tipo di agente Claude'))).toBe(true)
})

function lavagna(compiti: unknown): Sciame {
  const s = creaSciame({ id: 's1', obiettivo: 'obiettivo', compiti, parallelo: 4, oraMs: 1, predefinito: 4 })
  if (typeof s === 'string') throw new Error(s)

  return s
}

test('la lavagna: l\'esecutore indicato resta, gli altri lo ricevono dalla mod, e ogni riga dice chi ha scelto', () => {
  const s = lavagna([{ nome: 'a', prompt: 'p' }, { nome: 'b', prompt: 'p', esecutore: 'copilot' }, { nome: 'c', prompt: 'p', esecutore: 'claude' }, { nome: 'd', prompt: 'p', esecutore: 'gemini' }])

  expect(s.compiti.map(c => `${c.esecutore}:${c.motivoEsecutore ?? 'da assegnare'}`)).toEqual(['claude:da assegnare', 'copilot:indicato', 'claude:indicato', 'claude:da assegnare'])
  const scelto = conScelte(s, new Map([
    ['a', { esecutore: 'codex', motivo: 'scelto dalla mod: dal compito' }],
    // Chi ha gia il suo esecutore non lo cambia.
    ['b', { esecutore: 'qwen', motivo: 'scelto dalla mod: dal compito' }],
    ['d', { esecutore: 'qwen', motivo: 'ripiego: a rotazione' }],
  ]))
  expect(scelto.compiti.map(c => c.esecutore)).toEqual(['codex', 'copilot', 'claude', 'qwen'])
  expect(descrivi(scelto).split('\n').slice(1)).toEqual([
    '○ a (codex · scelto dalla mod: dal compito)',
    '○ b (copilot · indicato)',
    '○ c (claude · indicato)',
    '○ d (qwen · ripiego: a rotazione)',
  ])
  expect(scelto.compiti.map(isEsternoSceltoDallaMod)).toEqual([true, false, false, true])
  expect([...caricoEsterni(scelto)]).toEqual([['codex', 1], ['copilot', 1], ['qwen', 1]])
  expect(chiHaScelto('scelto dalla mod: dal compito')).toBe('mod')
  expect(chiHaScelto('ripiego: a rotazione')).toBe('ripiego')
  expect(chiHaScelto(MOTIVO_INDICATO)).toBe('indicato')

  // Spento in config: conta solo per chi lo ha indicato.
  expect(compitoConSpento(scelto.compiti, ['codex', 'qwen'])?.nome).toBe('b')
  expect(compitoConSpento(scelto.compiti, ['copilot'])).toBeUndefined()

  // Una CLI scelta dalla mod che poi non c'e: il compito torna a Claude e quel lancio non conta.
  const tornato = conRipiegoClaude(conLancio(scelto, 'a', { sforzo: 'low', lancioMs: 5 }), 'a', 'ripiego: CLI codex non trovata').compiti[0]
  expect(tornato).toMatchObject({ esecutore: 'claude', stato: 'attesa', tentativi: 0, motivoEsecutore: 'ripiego: CLI codex non trovata' })
  expect(tornato?.sforzo).toBeUndefined()
})

test('nel pane un compito in attesa dice lo sciame e chi ha scelto l\'esecutore', () => {
  const snap = costruisciSnapshot({
    ...baseInput(),
    attesaSciame: [
      { sciame: 's1', nome: 'a', esecutore: 'codex', isBloccato: false, chi: 'mod' },
      { sciame: 's1', nome: 'b', esecutore: 'claude', isBloccato: false },
    ],
  })

  expect(snap.viste.sessione.scaletta.slice(0, 2).map(r => [r.nome, r.esecutore, r.note])).toEqual([['a', 'codex', 'sciame s1 · mod'], ['b', 'claude', 'sciame s1']])
})

test('sciame senza esecutore: una sola domanda ad haiku per tutti i compiti, e ognuno parte con chi gli e toccato', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'esterni' }, risposta: haiku(() => amb, '{"api":"codex","doc":"qwen","cerca":"claude","boh":"gemini","rev":"qwen","forzato":"qwen"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', {
    obiettivo: 'prova',
    parallelo: 6,
    compiti: [
      { nome: 'api', prompt: lungo('implementa l\'endpoint'), scrive: true },
      { nome: 'doc', prompt: lungo('riassumi i moduli') },
      { nome: 'cerca', prompt: lungo('trova con il server MCP') },
      { nome: 'boh', prompt: 'guarda il file' },
      { nome: 'rev', prompt: lungo('rivedi il diff'), tipo: 'code-reviewer' },
      { nome: 'forzato', prompt: lungo('seconda implementazione'), esecutore: 'copilot', scrive: false },
    ],
  })

  // Una domanda sola, con i soli compiti che nessun vincolo ha deciso.
  expect(domande(amb)).toHaveLength(1)
  expect(domande(amb)[0]).toContain('Compito "api" (scrive file):')
  expect(domande(amb)[0]).toContain('Compito "boh" (legge soltanto):\nguarda il file')
  expect(domande(amb)[0]).not.toContain('"rev"')
  expect(domande(amb)[0]).not.toContain('"forzato"')

  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual([
    'api: codex · scelto dalla mod: dal compito',
    'doc: qwen · scelto dalla mod: dal compito',
    'cerca: claude · scelto dalla mod: dal compito',
    // Una risposta che non e un esecutore usabile non conta: ripiego, e un prompt breve resta a Claude.
    'boh: claude · ripiego: compito breve',
    'rev: claude · scelto dalla mod: tipo di agente Claude',
    'forzato: copilot · indicato',
  ])
  expect(esterni(amb)).toEqual(['codex:api', 'qwen:doc', 'copilot:forzato'])
  expect(m.claude()).toEqual(['cerca', 'boh', 'rev'])
  expect(testoDi(esito)).toContain('● api (codex · scelto dalla mod: dal compito')
  expect(testoDi(esito)).toContain('● forzato (copilot · indicato')
  expect(testoDi(esito)).toContain('Non controllarlo')
  expect(testoDi(await chiama($, 'sciame_stato', {}))).toContain('● doc (qwen · scelto dalla mod: dal compito')
})

test('se haiku non risponde i compiti lunghi vanno a rotazione sugli esterni, i brevi a Claude, e chi ha lanciato lo sa', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'esterni' }, risposta: haiku(() => amb, undefined) })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', {
    obiettivo: 'prova',
    parallelo: 6,
    compiti: [
      { nome: 'a', prompt: lungo('implementa a'), scrive: true },
      { nome: 'b', prompt: lungo('implementa b'), scrive: true },
      { nome: 'c', prompt: lungo('leggi c') },
      { nome: 'd', prompt: 'una cosa breve' },
    ],
  })

  expect(domande(amb)).toHaveLength(1)
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual([
    'a: codex · ripiego: a rotazione', 'b: copilot · ripiego: a rotazione', 'c: qwen · ripiego: a rotazione', 'd: claude · ripiego: compito breve',
  ])
  expect(esterni(amb)).toEqual(['codex:a', 'copilot:b', 'qwen:c'])
  expect(m.claude()).toEqual(['d'])
  expect(testoDi(esito)).toContain('Esecutori assegnati per ripiego: haiku non ha risposto (api-error).')
})

test('un esecutore spento in config: rifiutato dal suo tool e nello sciame se indicato, mai scelto dalla mod', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'esterni', esecutori: ['qwen'] }, risposta: haiku(() => amb, '{"a":"codex","b":"qwen"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  expect(testoDi(await chiama($, 'codex_avvia', { nome: 'x', cartella: WORKTREE, prompt: 'p', sforzo: 'low' }))).toBe('codex_avvia: esecutore codex spento in config: /regia executors codex on')
  expect(testoDi(await chiama($, 'copilot_avvia', { nome: 'x', cartella: WORKTREE, prompt: 'p' }))).toBe('copilot_avvia: esecutore copilot spento in config: /regia executors copilot on')
  expect(testoDi(await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'ok', prompt: 'p' }, { nome: 'x', prompt: 'p', esecutore: 'copilot' }] })))
    .toBe('sciame_avvia: compito "x": esecutore copilot spento in config: /regia executors copilot on')
  expect(esterni(amb)).toEqual([])
  expect(sciami(amb)).toEqual([])
  expect(amb.complete).toEqual([])

  // Chi e acceso funziona come prima; ad haiku si offrono solo gli usabili e una risposta fuori lista non passa.
  expect(testoDi(await chiama($, 'qwen_avvia', { nome: 'q', cartella: WORKTREE, prompt: 'p' }))).toContain('Lavoro Qwen/Qoder "q" avviato')
  await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'a', prompt: lungo('implementa a'), scrive: true }, { nome: 'b', prompt: lungo('leggi b') }] })
  expect(domande(amb)[0]).toContain('"<claude|qwen>"')
  expect(domande(amb)[0]).not.toContain('- codex:')
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual(['a: qwen · ripiego: a rotazione', 'b: qwen · scelto dalla mod: dal compito'])
  expect(m.claude()).toEqual([])

  // Anche un compito aggiunto dopo, se indica uno spento.
  const id = sciami(amb)[0]?.id
  expect(testoDi(await chiama($, 'sciame_aggiungi', { sciame: id, compiti: [{ nome: 'c', prompt: 'p', esecutore: 'codex' }] })))
    .toBe('sciame_aggiungi: compito "c": esecutore codex spento in config: /regia executors codex on')
  expect(Object.keys(compiti(amb))).toEqual(['a', 'b'])
})

test('/regia executors mostra chi e acceso e chi ha la CLI, e accende o spegne riscrivendo la lista; /regia codex resta il plugin', async ($, on) => {
  const amb = ambiente(on, { config: { orchestra: 'guida' }, cliAssenti: ['copilot'] })
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('tool.list', () => ({ value: [{ name: 'Agent' }] as never }))
  const config = () => JSON.parse(amb.scritti.get(`${HOME}/.claude/regia/config.json`) ?? '{}') as Record<string, unknown>

  const prima = String((await comando($, 'executors')).text)
  expect(prima).toContain('Esecutori esterni usabili ora: codex, qwen.')
  expect(prima).toContain('  copilot: acceso · CLI non trovata')
  expect(amb.scritti.size).toBe(0)

  const spento = String((await comando($, 'executors codex off')).text)
  expect(config()).toEqual({ orchestra: 'guida', esecutori: ['qwen', 'copilot'] })
  expect(spento).toContain('Esecutori esterni usabili ora: qwen.')
  expect(spento).toContain('  codex: spento in config · CLI trovata')
  await comando($, 'esecutori qwen off')
  await comando($, 'executors copilot off')
  expect(config().esecutori).toEqual([])
  expect(String((await comando($, 'executors')).text)).toContain('usabili ora: nessuno, negli sciami lavora solo Claude.')
  expect(String((await comando($, 'executors codex on')).text)).toContain('Esecutori esterni usabili ora: codex.')
  expect(config().esecutori).toEqual(['codex'])
  expect(String((await comando($, 'executors codex')).text)).toBe('regia: /regia executors mostra gli esecutori; /regia executors codex|qwen|copilot on|off ne accende o spegne uno.')
  expect(String((await comando($, 'doctor')).text)).toContain('Esecutori: usabili codex; qwen no (spento in config), copilot no (spento in config, CLI non trovata) — /regia executors.')

  // `/regia codex off` tocca solo il plugin, e lo dice.
  const plugin = String((await comando($, 'codex off')).text)
  expect(plugin).toContain('La mod non installera piu il plugin codex.')
  expect(plugin).toContain('L\'esecutore codex (compiti di sciame, codex_avvia) si accende e si spegne con /regia executors codex on|off.')
  expect(config()).toMatchObject({ pluginCodex: false, esecutori: ['codex'] })
  expect(String((await comando($, 'ponytail off')).text)).not.toContain('/regia executors')
})

test('codex e copilot fuori dal PATH si cercano nell\'ultimo nvm, qwen e qoder no', async ($, on) => {
  const nvm = `${HOME}/.nvm/versions/node`
  ambiente(on, { cliAssenti: [...TUTTI, 'qoder'], esistenti: [`${nvm}/v9.11.0/bin/codex`, `${nvm}/v22.3.0/bin/codex`, `${nvm}/v22.3.0/bin/qwen`] })
  on('fs.list', (_, e) => ({ value: (e.path === nvm ? ['v9.11.0', 'v22.3.0', 'v20.1.0'] : []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }))

  const testo = String((await comando($, 'executors')).text)
  expect(testo).toContain('Esecutori esterni usabili ora: codex.')
  expect(testo).toContain('  codex: acceso · CLI trovata (in ~/.nvm/versions/node/v22.3.0/bin, fuori dal PATH)')
  expect(testo).toContain('  qwen (Qwen/Qoder): acceso · CLI non trovata')
  expect(testo).toContain('  copilot: acceso · CLI non trovata')
})

test('senza le CLI non si chiede nulla ad haiku e tutto resta a Claude; un esecutore indicato parte lo stesso, come prima', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, cliAssenti: [...TUTTI, 'qoder'], risposta: haiku(() => amb, '{"a":"codex"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'a', prompt: lungo('implementa a'), scrive: true }, { nome: 'b', prompt: lungo('rileggi b'), esecutore: 'copilot', scrive: false }] })

  expect(domande(amb)).toEqual([])
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual(['a: claude · scelto dalla mod: nessun esterno usabile', 'b: copilot · indicato'])
  expect(m.claude()).toEqual(['a'])
  expect(esterni(amb)).toEqual(['copilot:b'])
  // Le tre CLI si interrogano una volta, non a ogni giro dello sciame.
  await amb.clock?.advance(30_000)
  expect(amb.lanci.filter(l => l.argv[1] === '--version').map(l => l.argv[0]).sort()).toEqual(['codex', 'copilot', 'qoder', 'qwen'])
})

test('la CLI di un esterno scelto dalla mod manca al lancio (exit 127): il compito passa a Claude invece di fallire due volte', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'esterni' }, risposta: haiku(() => amb, '{"a":"codex"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })
  await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'a', prompt: lungo('implementa a'), scrive: true }] })
  expect(esterni(amb)).toEqual(['codex:a'])
  expect(compiti(amb).a).toMatchObject({ esecutore: 'codex', stato: 'corsa', tentativi: 1 })

  // `codex: command not found`: lo script chiude con exit 127 e nessun esito.
  const nome = String(amb.lanci.find(l => l.argv[0] === 'bash')?.argv[4])
  amb.scritti.set(percorsiLavoro(HOME, nome, 'codex').eseguiLog, `10:00 inizio ${nome}\n10:00 fine ${nome} (exit 127, commit 0)\n`)
  await amb.clock?.advance(6_000)

  expect(esterni(amb)).toEqual(['codex:a'])
  expect(m.claude()).toEqual(['a'])
  expect(compiti(amb).a).toMatchObject({ esecutore: 'claude', stato: 'corsa', tentativi: 1, motivoEsecutore: 'ripiego: CLI codex non trovata' })
  // Stesso worktree di prima, e nessun "tentativo precedente" nel prompt: per Claude e il primo.
  expect(compiti(amb).a?.cartella).toBe(`${PROGETTO}/.worktrees/${nome}`)
  await m.finisce('a1')
  expect(compiti(amb).a).toMatchObject({ esecutore: 'claude', stato: 'fatto' })
})

test('un esterno scelto dalla mod e spento prima che il compito parta: al lancio torna a Claude', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'external' }, risposta: haiku(() => amb, '{"dopo":"qwen"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })
  await chiama($, 'sciame_avvia', { obiettivo: 'prova', compiti: [{ nome: 'prima', prompt: 'p', esecutore: 'claude' }, { nome: 'dopo', prompt: lungo('riassumi'), dopo: ['prima'] }] })
  expect(compiti(amb).dopo).toMatchObject({ esecutore: 'qwen', stato: 'attesa' })

  await comando($, 'executors qwen off')
  await m.finisce('a1')

  expect(esterni(amb)).toEqual([])
  expect(m.claude()).toEqual(['prima', 'dopo'])
  expect(compiti(amb).dopo).toMatchObject({ esecutore: 'claude', stato: 'corsa', motivoEsecutore: 'ripiego: qwen non piu usabile' })
})

test('sciame_aggiungi sceglie l\'esecutore dei soli compiti nuovi, contando chi e gia carico', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'esterni' }, risposta: haiku(() => amb, '{"nuovo":"qwen","primo":"codex"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })
  await chiama($, 'sciame_avvia', { obiettivo: 'prova', parallelo: 1, compiti: [{ nome: 'primo', prompt: 'p', esecutore: 'claude' }, { nome: 'secondo', prompt: lungo('implementa'), esecutore: 'codex', scrive: true }] })
  // Tutti indicati: nessuna domanda.
  expect(domande(amb)).toEqual([])
  const id = sciami(amb)[0]?.id

  const esito = await chiama($, 'sciame_aggiungi', { sciame: id, compiti: [{ nome: 'nuovo', prompt: lungo('riassumi'), dopo: ['primo'] }, { nome: 'altro', prompt: lungo('implementa altro'), scrive: true }] })

  expect(domande(amb)).toHaveLength(1)
  expect(domande(amb)[0]).toContain('Compito "nuovo"')
  expect(domande(amb)[0]).not.toContain('"primo"')
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual([
    'primo: claude · indicato',
    'secondo: codex · indicato',
    'nuovo: qwen · scelto dalla mod: dal compito',
    // Haiku non lo ha nominato: ripiego. Codex e qwen hanno gia un compito, tocca a copilot.
    'altro: copilot · ripiego: a rotazione',
  ])
  expect(testoDi(esito)).toContain('○ nuovo (qwen · scelto dalla mod: dal compito)')
  expect(testoDi(await chiama($, 'sciame_aggiungi', { sciame: 'boh', compiti: [{ nome: 'x', prompt: 'p' }] }))).toBe('sciame_aggiungi: sciame boh non trovato')
})

test('il pane con i compiti di uno sciame in attesa non va a capo a 40, 60, 80 e 120 colonne, e dice chi ha scelto', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, risposta: haiku(() => amb, '{"scelto-dalla-mod":"qwen"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })
  await chiama($, 'sciame_avvia', {
    obiettivo: 'prova',
    parallelo: 1,
    compiti: [
      { nome: 'in-corsa', prompt: 'p', esecutore: 'claude' },
      { nome: 'indicato-a-mano', prompt: lungo('implementa'), esecutore: 'codex', scrive: true },
      { nome: 'scelto-dalla-mod', prompt: lungo('riassumi') },
      { nome: 'rimasto-al-ripiego', prompt: lungo('implementa altro'), scrive: true },
    ],
  })
  await amb.clock?.advance(15_000)

  for (const larghezza of [40, 60, 80, 120]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: larghezza } })
    const righe = resa(await ui.drawn(), larghezza)
    for (const riga of righe) expect(cellWidth(riga)).toBeLessThanOrEqual(larghezza)
    expect(righe.some(r => r.includes('indicato-a-mano'))).toBe(true)
    if (larghezza >= 120) {
      expect(righe.some(r => r.includes('scelto-dalla-mod') && r.includes('qwen') && /sciame s\w+ · mod/.test(r))).toBe(true)
      expect(righe.some(r => r.includes('indicato-a-mano') && r.includes('codex') && /sciame s\w+ · indicato/.test(r))).toBe(true)
      expect(righe.some(r => r.includes('rimasto-al-ripiego') && /sciame s\w+ · ripiego/.test(r))).toBe(true)
    }
    await ui.unmount()
  }
})
