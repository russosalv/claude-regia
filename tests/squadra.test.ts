// La squadra (`/regia team`): chi sviluppa fra Claude e gli esecutori esterni.
// La chiave `squadra` e la sua quota, il tetto degli esterni in `mista`, il ripiego
// che guarda il compito, il prompt per haiku, e uno sciame con ognuna delle tre squadre.

import { expect, test } from 'claude-code/testing'

import { USO_SQUADRA, leggiArgomentiSquadra } from '../hooks/comando-opzioni'
import { rigaModi, testoDoctor } from '../hooks/doctor'
import { nomeSquadra, rigaSquadra, testoSquadra } from '../hooks/esecutori'
import { MOTIVO_QUOTA, NULLA_ASSEGNATO, assegnaEsecutori, daChiedere, isAdattoAEsterno, postiEsterni, promptEsecutori, sembraLavoroPerEsterni, tettoEsterni, vincoloEsecutore } from '../hooks/instradamento'
import type { GiaAssegnati } from '../hooks/instradamento'
import { TESTI_ORCHESTRA } from '../hooks/orchestra'
import { parseConfig } from '../hooks/registro'
import { conScelte, creaSciame, giaAssegnati } from '../hooks/sciame'
import { HOME } from './fixture'
import { PROGETTO, WORKTREE, ambiente } from './ambiente'
import type { Ambiente } from './ambiente'
import { chiama, comando, compiti, domande, esterni, haiku, lungo, motore, sciami, testoDi } from './sciame-finto'

const TUTTI = ['codex', 'qwen', 'copilot'] as const
const MISTA = { squadra: 'mista', quota: 50 } as const
const compito = (nome: string, extra: { scrive?: boolean; prompt?: string; tipo?: string } = {}) =>
  ({ nome, prompt: extra.prompt ?? lungo(`fai ${nome}`), scrive: extra.scrive ?? false, ...(extra.tipo === undefined ? {} : { tipo: extra.tipo }) })
const scrive = (nome: string, inizio = `implementa ${nome}`) => compito(nome, { scrive: true, prompt: lungo(inizio) })
const gia = (compiti: number, esterni: number, carico: [string, number][] = []): GiaAssegnati => ({ carico: new Map(carico), compiti, esterni })
const righe = (scelte: ReadonlyMap<string, { esecutore: string; motivo: string }>) => Object.fromEntries([...scelte].map(([nome, s]) => [nome, `${s.esecutore} · ${s.motivo}`]))

test('config: "squadra" e claude, mixed o external (o mista, esterni), predefinita mista; "squadraQuota" e un intero da 0 a 100, predefinita 50', () => {
  expect(parseConfig({}, HOME)).toMatchObject({ config: { squadra: 'mista', squadraQuota: 50 }, avvisi: [] })
  for (const [scritto, letto] of [['claude', 'claude'], ['mixed', 'mista'], ['mista', 'mista'], ['external', 'esterni'], ['esterni', 'esterni']] as const) {
    expect(parseConfig({ squadra: scritto }, HOME)).toMatchObject({ config: { squadra: letto }, avvisi: [] })
  }
  for (const sbagliato of ['tutti', 'Claude', 3, true]) {
    expect(parseConfig({ squadra: sbagliato }, HOME)).toMatchObject({ config: { squadra: 'mista' }, avvisi: ['config.json: "squadra" deve essere claude, mixed, external'] })
  }

  for (const quota of [0, 1, 50, 100]) expect(parseConfig({ squadraQuota: quota }, HOME)).toMatchObject({ config: { squadraQuota: quota }, avvisi: [] })
  for (const sbagliata of [-1, 101, 33.5, '30', null]) {
    expect(parseConfig({ squadraQuota: sbagliata }, HOME)).toMatchObject({ config: { squadraQuota: 50 }, avvisi: ['config.json: "squadraQuota" deve essere un intero da 0 a 100'] })
  }
})

test('gli argomenti di /regia team: mostra, cambia la squadra (nomi inglesi e italiani) o mette la quota; il resto e sbagliato o non e questo comando', () => {
  expect(leggiArgomentiSquadra('team')).toEqual({ azione: 'mostra' })
  expect(leggiArgomentiSquadra(' Squadra ')).toEqual({ azione: 'mostra' })
  expect(leggiArgomentiSquadra('team claude')).toEqual({ azione: 'squadra', valore: 'claude' })
  expect(leggiArgomentiSquadra('team MIXED')).toEqual({ azione: 'squadra', valore: 'mista' })
  expect(leggiArgomentiSquadra('squadra mista')).toEqual({ azione: 'squadra', valore: 'mista' })
  expect(leggiArgomentiSquadra('team external')).toEqual({ azione: 'squadra', valore: 'esterni' })
  expect(leggiArgomentiSquadra('squadra esterni')).toEqual({ azione: 'squadra', valore: 'esterni' })
  expect(leggiArgomentiSquadra('team 30')).toEqual({ azione: 'quota', valore: 30 })
  expect(leggiArgomentiSquadra('team 0%')).toEqual({ azione: 'quota', valore: 0 })
  expect(leggiArgomentiSquadra('team 100')).toEqual({ azione: 'quota', valore: 100 })
  for (const sbagliato of ['team 101', 'team -5', 'team 33.5', 'team codex', 'team mixed 30', 'team on']) expect(leggiArgomentiSquadra(sbagliato)).toEqual({ azione: 'sbagliato' })
  expect(leggiArgomentiSquadra('teams')).toBeUndefined()
  expect(leggiArgomentiSquadra('executors')).toBeUndefined()
  expect(leggiArgomentiSquadra('claude')).toBeUndefined()
})

test('il tetto degli esterni in mista: la parte intera di n × quota / 100, ma almeno uno con due o piu compiti, quota sopra zero e un compito adatto', () => {
  // Un compito solo resta a Claude, salvo quota 100.
  expect(tettoEsterni(1, 50, true)).toBe(0)
  expect(tettoEsterni(1, 99, true)).toBe(0)
  expect(tettoEsterni(1, 100, true)).toBe(1)
  // Due compiti: uno, e con una quota piccola quell'uno c'e solo se un compito e adatto.
  expect(tettoEsterni(2, 50, true)).toBe(1)
  expect(tettoEsterni(2, 10, true)).toBe(1)
  expect(tettoEsterni(2, 10, false)).toBe(0)
  expect(tettoEsterni(2, 100, false)).toBe(2)
  // Quota zero: nessuno, comunque.
  for (const n of [1, 2, 10, 40]) expect(tettoEsterni(n, 0, true)).toBe(0)
  // Quota cento: tutti.
  for (const n of [1, 2, 10, 40]) expect(tettoEsterni(n, 100, true)).toBe(n)
  expect([3, 4, 5, 7, 10].map(n => tettoEsterni(n, 50, true))).toEqual([1, 2, 2, 3, 5])
  expect([3, 4, 9, 10].map(n => tettoEsterni(n, 30, true))).toEqual([1, 1, 2, 3])
})

test('i posti che restano: in mista il tetto conta anche cio che la mod ha gia assegnato nello sciame; esterni non ha tetto, claude non ha posti', () => {
  expect(postiEsterni(4, MISTA, NULLA_ASSEGNATO, true)).toBe(2)
  // sciame_aggiungi: 4 compiti gia assegnati dalla mod (2 agli esterni) e 2 nuovi: tetto 3, resta un posto.
  expect(postiEsterni(2, MISTA, gia(4, 2), true)).toBe(1)
  expect(postiEsterni(1, MISTA, gia(6, 3), true)).toBe(0)
  // Gia oltre il tetto (la quota e stata abbassata dopo): zero, mai negativo.
  expect(postiEsterni(1, { squadra: 'mista', quota: 10 }, gia(5, 3), true)).toBe(0)
  // Un compito aggiunto a uno sciame che ne ha gia: non e piu "un compito solo".
  expect(postiEsterni(1, MISTA, gia(1, 0), true)).toBe(1)
  expect(postiEsterni(40, { squadra: 'esterni', quota: 0 }, gia(40, 40), false)).toBe(Number.POSITIVE_INFINITY)
  expect(postiEsterni(40, { squadra: 'claude', quota: 100 }, NULLA_ASSEGNATO, true)).toBe(0)

  // Dalla lavagna: contano i compiti che la mod ha assegnato, in qualunque stato, non quelli indicati.
  const s = creaSciame({ id: 's1', obiettivo: 'o', parallelo: 4, oraMs: 1, predefinito: 4, compiti: [{ nome: 'a', prompt: 'p' }, { nome: 'b', prompt: 'p' }, { nome: 'c', prompt: 'p' }, { nome: 'd', prompt: 'p', esecutore: 'codex' }, { nome: 'e', prompt: 'p' }] })
  if (typeof s === 'string') throw new Error(s)
  const assegnato = conScelte(s, new Map([
    ['a', { esecutore: 'qwen', motivo: 'scelto dalla mod: dal compito' }],
    ['b', { esecutore: 'claude', motivo: MOTIVO_QUOTA }],
    ['c', { esecutore: 'copilot', motivo: 'ripiego: lavoro adatto a un esterno' }],
  ]))
  const fatto = { ...assegnato, compiti: assegnato.compiti.map(c => (c.nome === 'a' ? { ...c, stato: 'fatto' as const } : c)) }
  expect(giaAssegnati(fatto)).toEqual({ carico: new Map([['copilot', 1], ['codex', 1]]), compiti: 3, esterni: 2 })
})

test('senza modello un compito sembra adatto a un esterno se legge soltanto o se il suo inizio parla di documentazione, test, revisione o lavoro meccanico', () => {
  const adatti = [
    'Scrivi la documentazione del modulo ordini', 'Update the README and the changelog', 'Aggiungi i docstring alle funzioni pubbliche',
    'Scrivi i test del parser', 'Write unit tests for the parser', 'Alza la copertura di hooks/posta.ts', 'Raise test coverage of the router',
    'Rivedi il diff del ramo', 'Fai una revisione indipendente del codice', 'Review the pull request', 'Security audit of the auth module',
    'Rinomina userId in idUtente in tutto il progetto', 'Rename the helper across the codebase', 'Sostituisci in blocco le chiamate a vecchiaApi', 'Bulk replace the deprecated calls',
    'Formatta i file sotto src/', 'Fix the lint warnings', 'Correggi i refusi nei messaggi', 'Fix typos in the docs',
    'Traduci i messaggi in inglese', 'Translate the UI strings', 'Riassumi i moduli sotto hooks/', 'Summarize how the router works',
    // Una seconda implementazione o un secondo parere, anche se la parola e "implementazione".
    'Fai una seconda implementazione del parser, per confronto', 'Give a second opinion on this design', 'Second implementation of the cache',
  ]
  for (const prompt of adatti) expect(`${prompt}: ${sembraLavoroPerEsterni(prompt)}`).toBe(`${prompt}: true`)

  const sviluppo = [
    'Implementa l\'endpoint /ordini con la sua validazione', 'Implement the retry policy in the client', 'Progetta lo schema dello storico',
    'Aggiungi il filtro per data alla lista', 'Correggi il guasto del login', 'Fix the race in the scheduler',
    // Una parola di sviluppo nello stesso inizio vince.
    'Implementa il filtro per data e scrivi i test', 'Develop the feature and document it', 'Refactor the parser and update its tests',
    // Parole che ne contengono un'altra non ingannano: "testo", "progetto".
    'Cambia il testo del pulsante di conferma', 'Sistema il contesto del progetto',
  ]
  for (const prompt of sviluppo) expect(`${prompt}: ${sembraLavoroPerEsterni(prompt)}`).toBe(`${prompt}: false`)

  // Conta l'inizio del prompt, dove il compito dice che lavoro e.
  expect(sembraLavoroPerEsterni(`Aggiungi il filtro per data alla lista. ${'x'.repeat(260)} Alla fine aggiorna la documentazione.`)).toBe(false)
  expect(sembraLavoroPerEsterni('  \n Rivedi il diff')).toBe(true)

  expect(isAdattoAEsterno({ prompt: 'Aggiungi il filtro per data alla lista', scrive: false })).toBe(true)
  expect(isAdattoAEsterno({ prompt: 'Aggiungi il filtro per data alla lista', scrive: true })).toBe(false)
  expect(isAdattoAEsterno({ prompt: 'Scrivi i test del parser', scrive: true })).toBe(true)
})

test('il prompt per haiku in mista: claude e la squadra di sviluppo, gli esterni ricevono solo cio che gli si addice, al massimo K su N; in esterni resta quello della 0.15', () => {
  const lista = [compito('api', { scrive: true }), compito('doc'), compito('rev')]
  const testo = promptEsecutori(lista, ['codex', 'qwen'], { squadra: 'mista', tetto: 1 })

  expect(testo.split('\n').slice(0, 7)).toEqual([
    'Assegna ogni compito di uno sciame di agenti di programmazione a un esecutore, guardando SOLO i compiti qui sotto.',
    'claude e la squadra di sviluppo principale: tiene lo sviluppo che chiede di capire il progetto (funzionalita che toccano piu moduli, progettazione, cio che dipende dalla conversazione o dai tool, dai server MCP, dalle skill e dai tipi di agente di questa sessione). Nel dubbio, claude.',
    'Gli esecutori esterni ricevono solo cio che gli si addice:',
    '- codex: revisione indipendente, audit, debug, un\'implementazione isolata e ben specificata.',
    '- qwen: modifiche meccaniche o in blocco, leggere e riassumere molto codice, documentazione, test; il piu economico.',
    'Al massimo 1 compito su 3 agli esecutori esterni.',
    'Rispondi SOLO con JSON su una riga, una voce per compito: {"<nome del compito>":"<claude|codex|qwen>"}',
  ])
  expect(testo).toContain('Compito "api" (scrive file):')
  expect(testo).toContain('Compito "doc" (legge soltanto):')
  expect(testo).not.toContain('copilot')
  expect(testo).not.toContain('Distribuisci il lavoro')

  const tutti = promptEsecutori(lista, [...TUTTI], { squadra: 'mista', tetto: 2 })
  expect(tutti).toContain('- copilot: una seconda implementazione o un secondo parere da un\'altra famiglia di modelli, un\'implementazione isolata e ben specificata.')
  expect(tutti).toContain('Al massimo 2 compiti su 3 agli esecutori esterni.')
  // Il tetto non supera i compiti chiesti (sciame_aggiungi in uno sciame grande).
  expect(promptEsecutori(lista, [...TUTTI], { squadra: 'mista', tetto: 9 })).toContain('Al massimo 3 compiti su 3 agli esecutori esterni.')

  const esterni = promptEsecutori(lista, ['codex', 'qwen'], { squadra: 'esterni' })
  expect(esterni.split('\n').slice(0, 7)).toEqual([
    'Assegna ogni compito di uno sciame di agenti di programmazione a un esecutore, guardando SOLO i compiti qui sotto.',
    'Esecutori:',
    '- claude: servono i tool, i server MCP, le skill o i tipi di agente di questa sessione; ricerche brevi; lavoro legato a cio che si e detto nella conversazione.',
    '- codex: implementazione autonoma di un compito ben specificato, debug, revisione del codice, audit.',
    '- qwen: modifiche meccaniche o in blocco, leggere e riassumere molto codice, documentazione, test; il piu economico.',
    'Distribuisci il lavoro: non dare tutto a claude quando un esecutore esterno puo farlo. I compiti autosufficienti vanno a un esecutore esterno.',
    'Rispondi SOLO con JSON su una riga, una voce per compito: {"<nome del compito>":"<claude|codex|qwen>"}',
  ])
  expect(esterni).not.toContain('Al massimo')
})

test('squadra claude: ogni compito senza esecutore va a Claude, senza domande e senza guardare gli usabili', () => {
  expect(vincoloEsecutore({}, [...TUTTI], 'claude')).toEqual({ esecutore: 'claude', motivo: 'scelto dalla mod: squadra claude' })
  expect(vincoloEsecutore({ tipo: 'Explore' }, [], 'claude')).toEqual({ esecutore: 'claude', motivo: 'scelto dalla mod: squadra claude' })
  const lista = [compito('a'), scrive('b', 'scrivi i test'), compito('c', { tipo: 'code-reviewer' })]
  const claude = { squadra: 'claude', quota: 100 } as const

  expect(daChiedere(lista, [...TUTTI], claude)).toEqual([])
  // Anche se una risposta ci fosse, non conta.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], '{"a":"qwen","b":"codex"}', claude))).toEqual({
    a: 'claude · scelto dalla mod: squadra claude',
    b: 'claude · scelto dalla mod: squadra claude',
    c: 'claude · scelto dalla mod: squadra claude',
  })
})

test('mista, haiku propone piu esterni del tetto: restano fuori chi legge soltanto e cio che haiku ha dato a qwen, poi l\'ordine; gli altri tornano a Claude col motivo', () => {
  const lista = [scrive('feat'), scrive('api'), scrive('doc', 'aggiorna la documentazione'), compito('rev'), scrive('core'), compito('tipo', { tipo: 'code-reviewer' })]
  const risposta = '{"feat":"codex","api":"copilot","doc":"qwen","rev":"codex","core":"claude","tipo":"qwen"}'

  // 6 compiti assegnati dalla mod, quota 50: tetto 3. Haiku ne propone 4.
  expect(daChiedere(lista, [...TUTTI], MISTA).map(c => c.nome)).toEqual(['feat', 'api', 'doc', 'rev', 'core'])
  expect(righe(assegnaEsecutori(lista, [...TUTTI], risposta, MISTA))).toEqual({
    tipo: 'claude · scelto dalla mod: tipo di agente Claude',
    core: 'claude · scelto dalla mod: dal compito',
    feat: 'codex · scelto dalla mod: dal compito',
    api: 'claude · scelto dalla mod: quota esterni raggiunta',
    doc: 'qwen · scelto dalla mod: dal compito',
    rev: 'codex · scelto dalla mod: dal compito',
  })
  // Quota 25: tetto 1, resta chi legge soltanto.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], risposta, { squadra: 'mista', quota: 25 }))).toMatchObject({
    feat: 'claude · scelto dalla mod: quota esterni raggiunta', api: 'claude · scelto dalla mod: quota esterni raggiunta',
    doc: 'claude · scelto dalla mod: quota esterni raggiunta', rev: 'codex · scelto dalla mod: dal compito',
  })
  // Quota 34: tetto 2, chi legge e poi il lavoro dato a qwen, prima di cio che viene prima nella chiamata.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], risposta, { squadra: 'mista', quota: 34 }))).toMatchObject({
    feat: 'claude · scelto dalla mod: quota esterni raggiunta', doc: 'qwen · scelto dalla mod: dal compito', rev: 'codex · scelto dalla mod: dal compito',
  })
  // Quota 100: nessun tetto di fatto, tutto come ha detto haiku.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], risposta, { squadra: 'mista', quota: 100 }))).toMatchObject({
    feat: 'codex · scelto dalla mod: dal compito', api: 'copilot · scelto dalla mod: dal compito', doc: 'qwen · scelto dalla mod: dal compito', rev: 'codex · scelto dalla mod: dal compito',
  })
  // Sotto il tetto non si tocca nulla, e non si riempie: haiku ha detto claude, resta claude.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], '{"feat":"claude","api":"claude","doc":"qwen","rev":"claude","core":"claude"}', MISTA))).toMatchObject({
    feat: 'claude · scelto dalla mod: dal compito', doc: 'qwen · scelto dalla mod: dal compito', rev: 'claude · scelto dalla mod: dal compito',
  })
})

test('mista ai bordi: un compito solo, due compiti, quota zero e quota cento', () => {
  const uno = [scrive('a', 'scrivi i test')]
  const due = [scrive('a', 'scrivi i test'), scrive('b', 'aggiorna la documentazione')]
  const con = (lista: ReturnType<typeof compito>[], quota: number, risposta: string | undefined) => righe(assegnaEsecutori(lista, [...TUTTI], risposta, { squadra: 'mista', quota }))

  // n = 1: nessun posto, e allora non c'e nulla da chiedere.
  expect(daChiedere(uno, [...TUTTI], MISTA)).toEqual([])
  expect(con(uno, 50, '{"a":"qwen"}')).toEqual({ a: 'claude · scelto dalla mod: quota esterni raggiunta' })
  expect(daChiedere(uno, [...TUTTI], { squadra: 'mista', quota: 100 }).map(c => c.nome)).toEqual(['a'])
  expect(con(uno, 100, '{"a":"qwen"}')).toEqual({ a: 'qwen · scelto dalla mod: dal compito' })
  // n = 2: un posto, anche con una quota piccola, ma solo se haiku ne ha giudicato adatto uno.
  expect(con(due, 50, '{"a":"qwen","b":"qwen"}')).toEqual({ a: 'qwen · scelto dalla mod: dal compito', b: 'claude · scelto dalla mod: quota esterni raggiunta' })
  expect(con(due, 10, '{"a":"claude","b":"codex"}')).toEqual({ a: 'claude · scelto dalla mod: dal compito', b: 'codex · scelto dalla mod: dal compito' })
  expect(con(due, 10, '{"a":"claude","b":"claude"}')).toEqual({ a: 'claude · scelto dalla mod: dal compito', b: 'claude · scelto dalla mod: dal compito' })
  expect(con(due, 100, '{"a":"qwen","b":"codex"}')).toEqual({ a: 'qwen · scelto dalla mod: dal compito', b: 'codex · scelto dalla mod: dal compito' })
  // Quota 0: tutto a Claude, senza domande.
  expect(daChiedere(due, [...TUTTI], { squadra: 'mista', quota: 0 })).toEqual([])
  expect(con(due, 0, '{"a":"qwen","b":"qwen"}')).toEqual({ a: 'claude · scelto dalla mod: quota esterni raggiunta', b: 'claude · scelto dalla mod: quota esterni raggiunta' })
  // Senza esterni usabili il motivo e quello, non la quota.
  expect(righe(assegnaEsecutori(due, [], undefined, MISTA))).toEqual({ a: 'claude · scelto dalla mod: nessun esterno usabile', b: 'claude · scelto dalla mod: nessun esterno usabile' })
})

test('mista, haiku non risponde: vanno fuori solo i compiti che sembrano adatti, fino al tetto e al meno carico; lo sviluppo e i compiti brevi restano a Claude', () => {
  const lista = [
    scrive('feat'),
    scrive('test', 'scrivi i test del parser'),
    compito('leggi'),
    compito('breve', { prompt: 'guarda il file' }),
    scrive('doc', 'aggiorna la documentazione'),
    compito('riassunto', { prompt: lungo('riassumi i moduli') }),
  ]

  // Tetto 3 su 6. Adatti: test, leggi, doc, riassunto; restano fuori prima i due che leggono, poi `test` che viene prima di `doc`.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], undefined, MISTA))).toEqual({
    feat: 'claude · ripiego: sviluppo, resta a Claude',
    breve: 'claude · ripiego: compito breve',
    test: 'codex · ripiego: lavoro adatto a un esterno',
    leggi: 'qwen · ripiego: lavoro adatto a un esterno',
    doc: 'claude · ripiego: quota esterni raggiunta',
    riassunto: 'copilot · ripiego: lavoro adatto a un esterno',
  })
  // Al meno carico, contando chi lo sciame ha gia: qwen e codex hanno un compito, chi legge va a copilot.
  expect(righe(assegnaEsecutori([compito('leggi')], [...TUTTI], undefined, MISTA, gia(3, 0, [['qwen', 1], ['codex', 1]])))).toEqual({ leggi: 'copilot · ripiego: lavoro adatto a un esterno' })
  // Una risposta a meta: chi haiku ha deciso resta deciso e pesa sul carico, gli altri al ripiego.
  expect(righe(assegnaEsecutori(lista, [...TUTTI], '{"feat":"claude","leggi":"qwen","doc":"gemini"}', { squadra: 'mista', quota: 100 }))).toEqual({
    feat: 'claude · scelto dalla mod: dal compito',
    leggi: 'qwen · scelto dalla mod: dal compito',
    breve: 'claude · ripiego: compito breve',
    test: 'codex · ripiego: lavoro adatto a un esterno',
    doc: 'copilot · ripiego: lavoro adatto a un esterno',
    // Tutti e tre hanno un compito: a pari carico chi legge va a qwen.
    riassunto: 'qwen · ripiego: lavoro adatto a un esterno',
  })
  // Nessun compito adatto: nessuno va fuori, nemmeno il posto minimo.
  expect(righe(assegnaEsecutori([scrive('a'), scrive('b')], [...TUTTI], undefined, MISTA))).toEqual({ a: 'claude · ripiego: sviluppo, resta a Claude', b: 'claude · ripiego: sviluppo, resta a Claude' })
})

test('mista con sciame_aggiungi: il tetto si calcola su tutto lo sciame, e chi e gia di un esterno occupa il suo posto', () => {
  const nuovi = [compito('e'), compito('f')]

  // Lo sciame ha 4 compiti assegnati dalla mod, 2 agli esterni: con i 2 nuovi il tetto e 3, resta un posto.
  expect(righe(assegnaEsecutori(nuovi, [...TUTTI], '{"e":"qwen","f":"qwen"}', MISTA, gia(4, 2)))).toEqual({ e: 'qwen · scelto dalla mod: dal compito', f: 'claude · scelto dalla mod: quota esterni raggiunta' })
  // Nessuno ancora agli esterni: due posti.
  expect(righe(assegnaEsecutori(nuovi, [...TUTTI], '{"e":"qwen","f":"qwen"}', MISTA, gia(4, 0)))).toEqual({ e: 'qwen · scelto dalla mod: dal compito', f: 'qwen · scelto dalla mod: dal compito' })
  // Quota gia piena: niente domanda e tutto a Claude.
  expect(daChiedere(nuovi, [...TUTTI], MISTA, gia(4, 3))).toEqual([])
  expect(righe(assegnaEsecutori(nuovi, [...TUTTI], undefined, MISTA, gia(4, 3)))).toEqual({ e: 'claude · scelto dalla mod: quota esterni raggiunta', f: 'claude · scelto dalla mod: quota esterni raggiunta' })
  // Un compito aggiunto da solo trova posto se lo sciame gliene lascia.
  expect(righe(assegnaEsecutori([compito('g')], [...TUTTI], '{"g":"codex"}', MISTA, gia(3, 1)))).toEqual({ g: 'codex · scelto dalla mod: dal compito' })
})

test('la squadra in /regia, /regia doctor e /regia team: la politica, la quota e che cosa vuol dire', () => {
  const config = (grezza: Record<string, unknown>) => parseConfig(grezza, HOME).config

  expect([{}, { squadra: 'claude' }, { squadra: 'external', squadraQuota: 20 }, { squadraQuota: 30 }].map(c => nomeSquadra(config(c)))).toEqual(['mixed 50%', 'claude', 'external', 'mixed 30%'])
  expect(rigaModi(config({ squadra: 'claude' }), { profilo: 'medio', isVia: false })).toBe('Mode medium · orchestra guide · team claude · models on · savings on · wake on · compact 60% — /regia doctor per i dettagli')

  expect(rigaSquadra(config({}))).toBe('Squadra: MIXED, quota esterni 50% — sviluppa Claude, gli esterni prendono i compiti di sciame che gli si addicono, entro la quota (/regia team).')
  expect(rigaSquadra(config({ squadra: 'claude' }))).toBe('Squadra: CLAUDE — sviluppa solo Claude, gli esterni lavorano solo se li nomini (/regia team).')
  expect(rigaSquadra(config({ squadra: 'esterni' }))).toBe('Squadra: EXTERNAL — i compiti autosufficienti di uno sciame vanno agli esterni, senza tetto (/regia team).')
  const doctor = testoDoctor({ versione: '1.2.3', radice: '/p', config: config({ squadraQuota: 30 }), isConfigPresente: true, percorsoConfig: '/c.json', avvisi: [], haSuperficie: true, haAgent: true, isPonytail: false, sciamiAttivi: 0 })
  expect(doctor).toContain('\nSquadra: MIXED, quota esterni 30% — ')
  expect(doctor).toContain('/regia team claude|mixed|external|<quota>')

  const mista = testoSquadra(config({ squadraQuota: 30 })).split('\n')
  expect(mista).toHaveLength(3)
  expect(mista[0]).toBe('Squadra: MIXED. Quota degli esterni: 30%.')
  expect(mista[1]).toContain('Claude e la squadra di sviluppo, come subagenti (Agent) e come compiti di sciame; gli esecutori esterni sono rinforzi.')
  expect(mista[1]).toContain('al massimo il 30% dei compiti che assegna lei in uno sciame')
  expect(mista[2]).toContain('/regia team claude|mixed|external')
  expect(mista[2]).toContain('"squadra" e "squadraQuota"')
  const claude = testoSquadra(config({ squadra: 'claude' })).split('\n')
  expect(claude[0]).toBe('Squadra: CLAUDE. Quota degli esterni: 50% (vale solo con mixed).')
  expect(claude[1]).toContain('un compito senza `esecutore` va sempre a Claude')
  expect(claude[1]).toContain('lavorano solo se li nomini')
  expect(testoSquadra(config({ squadra: 'external' }))).toContain('vanno agli esecutori esterni, senza tetto')
  expect(USO_SQUADRA).toBe('regia: /regia team mostra la squadra; /regia team claude|mixed|external la cambia; /regia team <numero> mette la quota degli esterni, da 0 a 100.')
})

test('/regia team mostra e cambia la squadra e la quota in config, e la regola nel prompt la segue', async ($, on) => {
  const amb = ambiente(on, { config: { orchestra: 'guida' } })
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('tool.list', () => ({ value: [{ name: 'Agent' }] as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' as const }] }))
  const config = () => JSON.parse(amb.scritti.get(`${HOME}/.claude/regia/config.json`) ?? '{}') as Record<string, unknown>
  const testo = async (args: string) => String((await comando($, args)).text)
  const regola = async () => (await $.prompt.compose({ model: 'm', promptModel: 'm', outputStyle: null, surfaces: ['terminal'], tools: ['Agent'], traits: [] } as never)).sections.find(s => s.id === 'regia:orchestra')?.text

  expect(await testo('team')).toContain('Squadra: MIXED. Quota degli esterni: 50%.')
  expect(amb.scritti.size).toBe(0)
  expect(await regola()).toBe(TESTI_ORCHESTRA.medio.mista)

  expect(await testo('team claude')).toContain('Squadra: CLAUDE. Quota degli esterni: 50% (vale solo con mixed).')
  expect(config()).toEqual({ orchestra: 'guida', squadra: 'claude' })
  expect(await regola()).toBe(TESTI_ORCHESTRA.medio.claude)
  await comando($, 'long')
  expect(await regola()).toBe(TESTI_ORCHESTRA.long.claude)
  expect(await testo('')).toContain('Mode long · orchestra guide · team claude · models on')

  expect(await testo('squadra esterni')).toContain('Squadra: EXTERNAL.')
  expect(config().squadra).toBe('external')
  expect(await regola()).toBe(TESTI_ORCHESTRA.long.esterni)

  expect(await testo('team 30')).toContain('Squadra: EXTERNAL. Quota degli esterni: 30% (vale solo con mixed).')
  expect(config()).toEqual({ orchestra: 'guida', squadra: 'external', squadraQuota: 30 })
  expect(await testo('team mixed')).toContain('Squadra: MIXED. Quota degli esterni: 30%.')
  expect(await regola()).toBe(TESTI_ORCHESTRA.long.mista)
  // La quota non entra nella regola: la sezione resta la stessa.
  await comando($, 'team 80')
  expect(await regola()).toBe(TESTI_ORCHESTRA.long.mista)
  expect(await testo('')).toContain('· team mixed 80% ·')
  expect(await testo('doctor')).toContain('Squadra: MIXED, quota esterni 80% — sviluppa Claude')

  // Un valore sbagliato non scrive nulla e dice come si usa.
  expect(await testo('team 130')).toBe(USO_SQUADRA)
  expect(await testo('team codex')).toBe(USO_SQUADRA)
  expect(config()).toEqual({ orchestra: 'guida', squadra: 'mixed', squadraQuota: 80 })
})

test('sciame con squadra claude: nessuna domanda ad haiku sugli esecutori e nessuna CLI interrogata; gli esterni partono solo se nominati', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'claude' }, risposta: haiku(() => amb, '{"api":"codex","doc":"qwen","rev":"qwen"}') })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', {
    obiettivo: 'prova',
    parallelo: 6,
    compiti: [
      { nome: 'api', prompt: lungo('implementa l\'endpoint'), scrive: true },
      { nome: 'doc', prompt: lungo('aggiorna la documentazione'), scrive: true },
      { nome: 'rev', prompt: lungo('rivedi il diff'), tipo: 'code-reviewer' },
      { nome: 'forzato', prompt: lungo('seconda implementazione'), esecutore: 'copilot', scrive: false },
    ],
  })

  expect(domande(amb)).toEqual([])
  expect(amb.lanci.filter(l => l.argv[1] === '--version')).toEqual([])
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual([
    'api: claude · scelto dalla mod: squadra claude',
    'doc: claude · scelto dalla mod: squadra claude',
    'rev: claude · scelto dalla mod: squadra claude',
    'forzato: copilot · indicato',
  ])
  expect(m.claude()).toEqual(['api', 'doc', 'rev'])
  expect(esterni(amb)).toEqual(['copilot:forzato'])
  expect(testoDi(esito)).toContain('● api (claude · scelto dalla mod: squadra claude')
  expect(testoDi(esito)).toContain('● forzato (copilot · indicato')
  expect(testoDi(esito)).not.toContain('ripiego')

  // Anche un compito aggiunto dopo, e i tool diretti restano a chi li nomina.
  const id = sciami(amb)[0]?.id
  await chiama($, 'sciame_aggiungi', { sciame: id, compiti: [{ nome: 'altro', prompt: lungo('riassumi i moduli') }, { nome: 'voluto', prompt: lungo('riassumi i moduli'), esecutore: 'qwen' }] })
  expect(domande(amb)).toEqual([])
  expect(compiti(amb).altro).toMatchObject({ esecutore: 'claude', motivoEsecutore: 'scelto dalla mod: squadra claude' })
  expect(compiti(amb).voluto).toMatchObject({ esecutore: 'qwen', motivoEsecutore: 'indicato' })
  expect(testoDi(await chiama($, 'codex_avvia', { nome: 'x', cartella: WORKTREE, prompt: 'p', sforzo: 'low' }))).toContain('Lavoro Codex "x" avviato')
  expect(domande(amb)).toEqual([])
})

test('sciame con squadra mista (la predefinita): haiku propone, il tetto taglia, e sciame_aggiungi conta cio che lo sciame ha gia', async ($, on) => {
  const risposta = '{"feat":"codex","api":"copilot","doc":"qwen","rev":"codex","core":"claude","e":"qwen","f":"qwen","g":"qwen"}'
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, risposta: haiku(() => amb, risposta) })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', {
    obiettivo: 'prova',
    parallelo: 8,
    compiti: [
      { nome: 'feat', prompt: lungo('implementa la funzione'), scrive: true },
      { nome: 'api', prompt: lungo('implementa l\'endpoint'), scrive: true },
      { nome: 'doc', prompt: lungo('aggiorna la documentazione'), scrive: true },
      { nome: 'rev', prompt: lungo('rivedi il diff') },
      { nome: 'core', prompt: lungo('implementa il nucleo'), scrive: true },
      { nome: 'voluto', prompt: lungo('seconda implementazione'), esecutore: 'copilot', scrive: false },
    ],
  })

  // Una domanda sola, con il tetto: 5 compiti assegnati dalla mod, quota 50, al massimo 2.
  expect(domande(amb)).toHaveLength(1)
  expect(domande(amb)[0]).toContain('claude e la squadra di sviluppo principale')
  expect(domande(amb)[0]).toContain('Al massimo 2 compiti su 5 agli esecutori esterni.')
  expect(domande(amb)[0]).not.toContain('"voluto"')
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual([
    'feat: claude · scelto dalla mod: quota esterni raggiunta',
    'api: claude · scelto dalla mod: quota esterni raggiunta',
    'doc: qwen · scelto dalla mod: dal compito',
    'rev: codex · scelto dalla mod: dal compito',
    'core: claude · scelto dalla mod: dal compito',
    // Chi e indicato non entra nella quota.
    'voluto: copilot · indicato',
  ])
  expect(esterni(amb)).toEqual(['qwen:doc', 'codex:rev', 'copilot:voluto'])
  expect(m.claude()).toEqual(['feat', 'api', 'core'])
  expect(testoDi(esito)).toContain('● feat (claude · scelto dalla mod: quota esterni raggiunta')
  expect(testoDi(esito)).toContain('● doc (qwen · scelto dalla mod: dal compito')

  // Due compiti nuovi: 7 assegnati dalla mod in tutto, tetto 3, due posti gia presi: ne resta uno.
  const id = sciami(amb)[0]?.id
  await chiama($, 'sciame_aggiungi', { sciame: id, compiti: [{ nome: 'e', prompt: lungo('riassumi i moduli') }, { nome: 'f', prompt: lungo('elenca le rotte') }] })
  expect(domande(amb)).toHaveLength(2)
  expect(domande(amb)[1]).toContain('Al massimo 1 compito su 2 agli esecutori esterni.')
  expect(compiti(amb).e).toMatchObject({ esecutore: 'qwen', motivoEsecutore: 'scelto dalla mod: dal compito' })
  expect(compiti(amb).f).toMatchObject({ esecutore: 'claude', motivoEsecutore: 'scelto dalla mod: quota esterni raggiunta' })

  // Un altro ancora: 8 in tutto, tetto 4, tre gia presi: un posto.
  await chiama($, 'sciame_aggiungi', { sciame: id, compiti: [{ nome: 'g', prompt: lungo('riassumi i test') }] })
  expect(compiti(amb).g).toMatchObject({ esecutore: 'qwen' })
  // E poi basta: 9 in tutto, tetto 4, quattro gia presi. Nessuna domanda.
  const pieno = await chiama($, 'sciame_aggiungi', { sciame: id, compiti: [{ nome: 'h', prompt: lungo('riassumi le note') }] })
  expect(domande(amb)).toHaveLength(3)
  expect(compiti(amb).h).toMatchObject({ esecutore: 'claude', motivoEsecutore: 'scelto dalla mod: quota esterni raggiunta' })
  expect(testoDi(pieno)).toContain('h (claude · scelto dalla mod: quota esterni raggiunta')
})

test('sciame con squadra mista e haiku muto: fuori solo cio che sembra adatto, entro il tetto, e chi ha lanciato lo sa', async ($, on) => {
  const amb: Ambiente = ambiente(on, { agenti: () => m.agenti, config: { squadra: 'mixed', squadraQuota: 50 }, risposta: haiku(() => amb, undefined) })
  const m = motore($, on)
  await $.session.start({ cwd: PROGETTO, surface: 'terminal', isInteractive: true })

  const esito = await chiama($, 'sciame_avvia', {
    obiettivo: 'prova',
    parallelo: 8,
    compiti: [
      { nome: 'a', prompt: lungo('implementa a'), scrive: true },
      { nome: 'b', prompt: lungo('implementa b'), scrive: true },
      { nome: 'test', prompt: lungo('scrivi i test del parser'), scrive: true },
      { nome: 'doc', prompt: lungo('aggiorna la documentazione'), scrive: true },
      { nome: 'leggi', prompt: lungo('leggi c') },
      { nome: 'breve', prompt: 'una cosa breve' },
    ],
  })

  expect(domande(amb)).toHaveLength(1)
  expect(Object.values(compiti(amb)).map(c => `${c.nome}: ${c.esecutore} · ${c.motivoEsecutore}`)).toEqual([
    'a: claude · ripiego: sviluppo, resta a Claude',
    'b: claude · ripiego: sviluppo, resta a Claude',
    'test: codex · ripiego: lavoro adatto a un esterno',
    'doc: copilot · ripiego: lavoro adatto a un esterno',
    'leggi: qwen · ripiego: lavoro adatto a un esterno',
    'breve: claude · ripiego: compito breve',
  ])
  expect(esterni(amb)).toEqual(['codex:test', 'copilot:doc', 'qwen:leggi'])
  expect(m.claude()).toEqual(['a', 'b', 'breve'])
  expect(testoDi(esito)).toContain('Esecutori assegnati per ripiego: haiku non ha risposto (api-error).')
})
