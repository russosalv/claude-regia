// La compattazione: le istruzioni per il riassunto, quando si compatta, quando
// la principale riprende; poi la mod intera, con un motore finto.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CRESCITA_MINIMA, INTESTAZIONE, MASSIMO_ISTRUZIONI, MASSIMO_PIANO, MASSIMO_VOCI, STATO_COMPATTA_VUOTO, avvisoCompattato, conCompattazione, decidiCompatta, decidiRipresa, haIstruzioniRegia, leggiArgomentiCompatta, righePiano, rigaDoctorCompatta, statoCompattaDaStore, testoCompatta, testoIstruzioni, testoRipresa, unisciIstruzioni } from '../hooks/compatta'
import type { FattiRegia, StatoCompatta } from '../hooks/compatta'
import { rigaModi, testoDoctor } from '../hooks/doctor'
import { parseConfig } from '../hooks/registro'
import type { VoceRegistro } from '../hooks/registro'
import { creaSciame } from '../hooks/sciame'
import type { Sciame } from '../hooks/sciame'
import { CONFIG, HOME, REGISTRO, SESSIONE } from './fixture'
import { ambiente } from './ambiente'
import type { Ambiente } from './ambiente'

const voce = (id: string, stato: VoceRegistro['stato'], extra: Partial<VoceRegistro> = {}): VoceRegistro => ({ id, titolo: `Titolo di ${id}`, stato, ...extra })

const PIANO: VoceRegistro[] = [
  voce('studio-api', 'fatto', { fase: '1 · analisi', descrizione: 'Leggere le API del gestionale\ne scrivere che cosa manca.' }),
  voce('sviluppo-04', 'in_corso', { fase: '2 · sviluppo', descrizione: 'Il modulo storico: tre anni di letture, con i test.' }),
]
const DOMANDA = { id: 'db', titolo: 'Quale database per lo storico?', opzioni: ['Postgres', 'SQLite'] }

function sciame(): Sciame {
  const s = creaSciame({ id: 's1', obiettivo: 'migrare i moduli', compiti: [{ nome: 'alfa', prompt: 'p' }, { nome: 'beta', prompt: 'p', dopo: ['alfa'] }], parallelo: 2, oraMs: 1, predefinito: 4 })
  if (typeof s === 'string') throw new Error(s)

  return s
}

const FATTI: FattiRegia = { profilo: 'long', isVia: true, piano: PIANO, domande: [DOMANDA], sciami: [], esecutori: ['codex', 'qwen'] }

test('le istruzioni: che cosa tenere, poi i fatti della regia cosi come sono', () => {
  expect(testoIstruzioni(FATTI)).toBe([
    '[regia · compattazione] Istruzioni della mod Regia per il riassunto.',
    'Tieni:',
    '- l\'obiettivo che la persona ha dato e ogni vincolo o preferenza che ha espresso, con le sue parole;',
    '- le decisioni gia prese e il perche;',
    '- che cosa e stato fatto e verificato (test, build, comandi, con l\'esito), distinto da cio che e solo affermato;',
    '- i file e i rami toccati, con i percorsi;',
    '- che cosa e in corso adesso e il passo subito successivo;',
    '- gli errori incontrati e come sono stati risolti;',
    '- cio che la persona sta aspettando.',
    'Lascia fuori le uscite degli strumenti riportate per intero e le esplorazioni che non hanno portato a nulla.',
    '',
    'Fatti che la regia tiene fuori dalla conversazione, letti adesso dai suoi archivi: sono lo stato attuale. Riportali nel riassunto cosi come sono, in un elenco a parte, anche dove la conversazione dice altro.',
    'Modalita: long; la persona e via (away): le domande le arrivano come notifica.',
    'Piano (2 voci), nell\'ordine in cui va fatto:',
    '- studio-api [1 · analisi] fatto: Titolo di studio-api — Leggere le API del gestionale e scrivere che cosa manca.',
    '- sviluppo-04 [2 · sviluppo] in_corso: Titolo di sviluppo-04 — Il modulo storico: tre anni di letture, con i test.',
    'Domande aperte per la persona (1), ancora senza risposta:',
    '- Quale database per lo storico? (id db) — opzioni: 1) Postgres; 2) SQLite',
    'Sciami di questa sessione in corsa o in attesa: nessuno.',
    'Esecutori esterni usabili: codex, qwen.',
  ].join('\n'))
})

test('le istruzioni portano gli sciami, il motivo di una voce bloccata, e tacciono su cio che non si e potuto leggere', () => {
  const testo = testoIstruzioni({ profilo: 'medio', isVia: false, piano: [voce('deploy', 'bloccato', { note: 'manca la chiave\ndi produzione' })], domande: [], sciami: [sciame()], esecutori: [] })
  expect(testo).toContain('Modalita: medium; la persona e qui (here).')
  expect(testo).toContain('- deploy bloccato: Titolo di deploy (motivo: manca la chiave di produzione)')
  expect(testo).toContain('Domande aperte per la persona: nessuna.')
  expect(testo).toContain('Sciami di questa sessione in corsa o in attesa (1); alla fine ognuno scrive alla principale:')
  expect(testo).toContain('Sciame s1 — migrare i moduli: 0 fatti, 0 in corsa, 2 in attesa, 0 falliti, 0 bloccati.')
  expect(testo).toContain('○ alfa (claude)')
  expect(testo).toContain('Esecutori esterni usabili: nessuno, lavora solo Claude.')

  // Una fonte illeggibile non diventa un fatto: la sua riga manca.
  const senza = testoIstruzioni({ profilo: 'quick', isVia: false })
  expect(senza).toContain('Modalita: quick')
  for (const riga of ['Piano', 'Domande aperte', 'Sciami', 'Esecutori']) expect(senza).not.toContain(riga)
})

test('i tetti: al piu 40 voci e 4000 caratteri di piano, 6000 in tutto, dicendo quante voci restano fuori', () => {
  const lunga = 'x'.repeat(400)
  const tante = [
    ...Array.from({ length: 30 }, (_, i) => voce(`fatta-${i}`, 'fatto', { descrizione: 'breve' })),
    ...Array.from({ length: 35 }, (_, i) => voce(`aperta-${i}`, 'scaletta', { descrizione: 'breve' })),
  ]
  const righe = righePiano(tante)
  // Escono prima le voci fatte, dalle piu vecchie: resta cio che c'e ancora da fare.
  expect(righe[0]).toBe('Piano (65 voci, 40 elencate), nell\'ordine in cui va fatto:')
  expect(righe.filter(r => r.startsWith('- '))).toHaveLength(MASSIMO_VOCI)
  expect(righe.filter(r => r.startsWith('- aperta-'))).toHaveLength(35)
  expect(righe[1]).toContain('- fatta-25 ')
  expect(righe.at(-1)).toBe('(lasciate fuori 25 voci: 25 gia fatte, 0 ancora aperte in fondo al piano; il piano intero e in ~/.claude/regia/registro.json)')

  // Voci lunghe: il tetto e quello dei caratteri, e le aperte in fondo restano fuori contate.
  const grosse = Array.from({ length: 40 }, (_, i) => voce(`voce-${i}`, 'scaletta', { fase: 'fase lunga', descrizione: lunga }))
  const piano = righePiano(grosse)
  expect(piano.join('\n').length).toBeLessThanOrEqual(MASSIMO_PIANO)
  expect(piano.at(-1)).toMatch(/^\(lasciate fuori \d+ voci: 0 gia fatte, \d+ ancora aperte/)
  expect(piano[1]).toContain('- voce-0 ')

  const domande = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, titolo: lunga, opzioni: [lunga, lunga, lunga, lunga] }))
  const sciami = Array.from({ length: 5 }, () => ({ ...sciame(), obiettivo: lunga, compiti: Array.from({ length: 40 }, (_, i) => ({ ...sciame().compiti[0]!, nome: `c${i}`, esito: lunga })) }))
  const tutto = testoIstruzioni({ profilo: 'long', isVia: false, piano: grosse, domande, sciami, esecutori: ['codex', 'qwen', 'copilot'] })
  expect(tutto.length).toBeLessThanOrEqual(MASSIMO_ISTRUZIONI)
  expect(tutto).toContain('(e altre 29: sono nel pane della regia)')
  expect(tutto).toContain('la lavagna intera la da mcp__regia__sciame_stato')
  expect(tutto).toContain('Esecutori esterni usabili: codex, qwen, copilot.')
  expect(tutto.endsWith('…')).toBe(false)
  expect(righePiano([])).toEqual(['Piano: nessuna voce.'])
})

test('le istruzioni della persona restano in testa; quelle della regia non si aggiungono due volte', () => {
  const regia = testoIstruzioni(FATTI)
  expect(unisciIstruzioni('tieni soprattutto il numero 42', regia)).toBe(`tieni soprattutto il numero 42\n\n${regia}`)
  expect(unisciIstruzioni(undefined, regia)).toBe(regia)
  expect(unisciIstruzioni('  ', regia)).toBe(regia)
  expect(haIstruzioniRegia(unisciIstruzioni('mie', regia))).toBe(true)
  expect(haIstruzioniRegia('tieni il piano')).toBe(false)
  expect(haIstruzioniRegia(undefined)).toBe(false)
  expect(regia.startsWith(INTESTAZIONE)).toBe(true)
})

const decidi = (pieno: number | undefined, stato: StatoCompatta = STATO_COMPATTA_VUOTO, extra: { isAccesa?: boolean; turno?: string; soglia?: number } = {}) =>
  decidiCompatta({ isAccesa: extra.isAccesa ?? true, soglia: extra.soglia ?? 60, pieno, turno: extra.turno ?? 't1', stato })

test('si compatta alla soglia o oltre, non sotto, non da spenta, non senza misura, non due volte alla fine dello stesso turno', () => {
  expect(decidi(59).azione).toBe('nulla')
  expect(decidi(60).azione).toBe('compatta')
  expect(decidi(85).azione).toBe('compatta')
  expect(decidi(85, STATO_COMPATTA_VUOTO, { isAccesa: false }).azione).toBe('nulla')
  // Sessione nuova o appena compattata: il motore non ha ancora una misura.
  expect(decidi(undefined).azione).toBe('nulla')
  expect(decidi(75, STATO_COMPATTA_VUOTO, { soglia: 80 }).azione).toBe('nulla')

  const provata = decidi(70).stato
  expect(provata.turno).toBe('t1')
  expect(decidi(70, provata).azione).toBe('nulla')
  // Se il motore ha rifiutato (un turno era partito) si riprova alla fine del turno dopo.
  expect(decidi(70, provata, { turno: 't2' }).azione).toBe('compatta')
})

test('la guardia: se dopo la compattazione il contesto resta alla soglia o oltre non si riprova finche non cresce di 10 punti', () => {
  const fatta = conCompattazione(decidi(65).stato, { oraMs: 1, origine: 'soglia', primaPct: 65, tokensDopo: 9_000 })
  expect(fatta.ultima?.dopoPct).toBeUndefined()

  // Il turno dopo il motore misura 63%: e la misura del dopo, la soglia non si raggiunge. Avviso una volta.
  const ferma = decidi(63, fatta, { turno: 't2' })
  expect(ferma.azione).toBe('irraggiungibile')
  expect(ferma.stato.ultima?.dopoPct).toBe(63)
  expect(fatta.isAvvisato).toBe(false)
  expect(ferma.stato.isAvvisato).toBe(true)
  const ancora = decidi(63 + CRESCITA_MINIMA - 1, ferma.stato, { turno: 't3' })
  expect(ancora.azione).toBe('irraggiungibile')
  expect(ancora.stato.isAvvisato).toBe(true)
  // Cresciuto di 10 punti: si riprova.
  expect(decidi(63 + CRESCITA_MINIMA, ancora.stato, { turno: 't4' }).azione).toBe('compatta')
  // Una soglia piu alta di cio che e rimasto toglie la guardia.
  expect(decidi(70, ferma.stato, { turno: 't3', soglia: 65 }).azione).toBe('compatta')

  // La compattazione ha funzionato: 20% al turno dopo, e quando torna alla soglia si compatta di nuovo.
  const scesa = decidi(20, fatta, { turno: 't2' })
  expect(scesa.azione).toBe('nulla')
  expect(scesa.stato.ultima?.dopoPct).toBe(20)
  expect(decidi(61, scesa.stato, { turno: 't9' }).azione).toBe('compatta')
  // Se nel frattempo e sceso sotto la soglia (un /compact, un /clear) la guardia cade e l'avviso si riarma.
  const sotto = decidi(30, ferma.stato, { turno: 't5' })
  expect(sotto.stato).toMatchObject({ isAvvisato: false, ultima: { dopoPct: 30 } })
  expect(decidi(62, sotto.stato, { turno: 't6' }).azione).toBe('compatta')
})

test('la memoria dallo store: solo cio che e valido', () => {
  expect(statoCompattaDaStore(undefined)).toEqual(STATO_COMPATTA_VUOTO)
  expect(statoCompattaDaStore({ ultima: { oraMs: 5, origine: 'comando', primaPct: 70, dopoPct: 'x', tokensDopo: 9000 }, turno: 't', isAvvisato: true, aggiornatoMs: 9 }))
    .toEqual({ ultima: { oraMs: 5, origine: 'comando', primaPct: 70, tokensDopo: 9000 }, turno: 't', isAvvisato: true, aggiornatoMs: 9 })
  expect(statoCompattaDaStore({ ultima: { origine: 'soglia' }, turno: 7 })).toEqual(STATO_COMPATTA_VUOTO)
})

test('la ripresa: solo in long, con voci da fare, e non mentre uno sciame o un agente lavora', () => {
  const base = { piano: PIANO, sciamiAttivi: 0, agentiInCorso: 0 }
  expect(decidiRipresa({ ...base, profilo: 'long' })).toBe(true)
  expect(decidiRipresa({ ...base, profilo: 'medio' })).toBe(false)
  expect(decidiRipresa({ ...base, profilo: 'quick' })).toBe(false)
  // Lo sciame scrive lui alla principale quando finisce; un agente che finisce la fa girare.
  expect(decidiRipresa({ ...base, profilo: 'long', sciamiAttivi: 1 })).toBe(false)
  expect(decidiRipresa({ ...base, profilo: 'long', agentiInCorso: 2 })).toBe(false)
  // Piano chiuso, o fermo su voci bloccate (in attesa di una risposta della persona): nulla da riprendere.
  expect(decidiRipresa({ ...base, profilo: 'long', piano: [voce('a', 'fatto')] })).toBe(false)
  expect(decidiRipresa({ ...base, profilo: 'long', piano: [voce('a', 'fatto'), voce('b', 'bloccato'), voce('c', 'bloccato')] })).toBe(false)
  expect(decidiRipresa({ ...base, profilo: 'long', piano: [voce('b', 'bloccato'), voce('c', 'scaletta')] })).toBe(true)
  expect(decidiRipresa({ ...base, profilo: 'long', piano: [] })).toBe(false)
})

test('il messaggio di ripresa: corto, con le voci da fare e le domande dagli archivi', () => {
  const testo = testoRipresa({ piano: [...PIANO, voce('deploy', 'bloccato'), voce('rilascio', 'scaletta')], domande: [DOMANDA] })
  expect(testo).toBe([
    '[regia · ripresa] La regia ha compattato il contesto di questa conversazione: sopra hai il riassunto, non piu i messaggi.',
    'Voci del piano ancora da fare (2):',
    '- sviluppo-04 [2 · sviluppo] in_corso: Titolo di sviluppo-04',
    '- rilascio scaletta: Titolo di rilascio',
    'Voci bloccate, da lasciare ferme finche il motivo resta: deploy.',
    'Domande aperte per la persona, non ripeterle: Quale database per lo storico? (db).',
    'Riprendi dalla prima voce ancora da fare e vai avanti da sola col piano, senza chiedere il permesso. Per i dettagli (codice, percorsi, esiti) rileggi i file invece di fidarti del riassunto. Aggiorna il piano con scaletta_scrivi e segna `bloccato` con il motivo cio che non puoi fare.',
  ].join('\n'))
  const tante = testoRipresa({ piano: Array.from({ length: 30 }, (_, i) => voce(`v${i}`, 'scaletta')), domande: [] })
  expect(tante).toContain('Voci del piano ancora da fare (30):')
  expect(tante).toContain('- e altre 18')
  expect(tante).not.toContain('Domande aperte')
})

test('il comando, la config, il doctor e la riga dei modi', () => {
  expect(leggiArgomentiCompatta('compact')).toEqual({ azione: 'mostra' })
  expect(leggiArgomentiCompatta(' Compatta OFF ')).toEqual({ azione: 'accendi', valore: false })
  expect(leggiArgomentiCompatta('compact on')).toEqual({ azione: 'accendi', valore: true })
  expect(leggiArgomentiCompatta('compact 70')).toEqual({ azione: 'soglia', valore: 70 })
  expect(leggiArgomentiCompatta('compact 45%')).toEqual({ azione: 'soglia', valore: 45 })
  expect(leggiArgomentiCompatta('compact now')).toEqual({ azione: 'ora' })
  for (const sbagliato of ['compact 29', 'compact 91', 'compact 60.5', 'compact boh', 'compact on subito']) expect(leggiArgomentiCompatta(sbagliato)).toEqual({ azione: 'sbagliato' })
  expect(leggiArgomentiCompatta('compattatore')).toBeUndefined()
  expect(leggiArgomentiCompatta('wake')).toBeUndefined()

  expect(parseConfig({}, HOME).config).toMatchObject({ compatta: true, compattaSoglia: 60 })
  expect(parseConfig({ compatta: false, compattaSoglia: 30 }, HOME)).toMatchObject({ config: { compatta: false, compattaSoglia: 30 }, avvisi: [] })
  expect(parseConfig({ compattaSoglia: 90 }, HOME).config.compattaSoglia).toBe(90)
  for (const fuori of [29, 91, 60.5, '70']) {
    expect(parseConfig({ compattaSoglia: fuori }, HOME)).toMatchObject({ config: { compattaSoglia: 60 }, avvisi: ['config.json: "compattaSoglia" deve essere un intero da 30 a 90'] })
  }
  expect(parseConfig({ compatta: 'si' }, HOME)).toMatchObject({ config: { compatta: true }, avvisi: ['config.json: "compatta" deve essere true o false'] })

  const config = parseConfig({ compattaSoglia: 70 }, HOME).config
  expect(rigaDoctorCompatta(config, { percent: 43, tokens: 86_000, window: 200_000 })).toBe('Compattazione: ACCESA, soglia 70% — contesto ora al 43% (/regia compact).')
  expect(rigaDoctorCompatta({ compatta: false, compattaSoglia: 60 }, { window: 200_000 })).toBe('Compattazione: SPENTA, soglia 60% — contesto non ancora misurato (/regia compact).')
  const doctor = testoDoctor({ versione: '1', radice: '/p', config, isConfigPresente: true, percorsoConfig: '/c.json', avvisi: [], haSuperficie: true, haAgent: true, isPonytail: false, sciamiAttivi: 0, contesto: { percent: 43, window: 200_000 } })
  expect(doctor).toContain('Compattazione: ACCESA, soglia 70% — contesto ora al 43% (/regia compact).')
  expect(doctor).toContain('/regia compact on|off|<soglia>')
  expect(rigaModi(config, { profilo: 'medio', isVia: false })).toContain('· wake on · compact 70% —')
  expect(rigaModi({ ...config, compatta: false }, { profilo: 'medio', isVia: false })).toContain('· compact off —')
})

test('/regia compact dice lo stato: soglia, contesto, ultima compattazione, e se e da compattare', () => {
  const config = { compatta: true, compattaSoglia: 60 }
  const nuovo = testoCompatta({ config, contesto: { window: 200_000 }, stato: STATO_COMPATTA_VUOTO })
  expect(nuovo).toContain('Compattazione: ACCESA, soglia 60%.')
  expect(nuovo).toContain('Contesto adesso: non ancora misurato')
  expect(nuovo).toContain('Ultima compattazione della mod in questa sessione: nessuna.')
  expect(nuovo).not.toContain('Da compattare')

  // Sopra la soglia a turno in corso: lo dice, e compatta alla fine del turno.
  const sopra = testoCompatta({ config, contesto: { percent: 72, tokens: 144_000, window: 200_000 }, stato: { ...STATO_COMPATTA_VUOTO, turno: 'gia-visto' } })
  expect(sopra).toContain('Contesto adesso: 72% (144k di 200k token).')
  expect(sopra).toContain('Da compattare: il contesto e alla soglia o oltre. Il motore compatta solo fra un turno e l\'altro: parte alla prossima fine di turno.')
  expect(testoCompatta({ config: { ...config, compatta: false }, contesto: { percent: 72 }, stato: STATO_COMPATTA_VUOTO })).not.toContain('Da compattare')

  const ora = new Date(2026, 10, 15, 14, 32).getTime()
  const dopo = testoCompatta({ config, contesto: { percent: 64 }, stato: { ...STATO_COMPATTA_VUOTO, ultima: { oraMs: ora, origine: 'soglia', primaPct: 65, dopoPct: 63, tokensDopo: 9_400 } } })
  expect(dopo).toContain('alle 14:32 (soglia superata), il contesto era al 65%, la conversazione e scesa a circa 9k token, ai turni dopo il contesto e sceso fino al 63%.')
  expect(dopo).toContain('La soglia non si raggiunge: dopo l\'ultima compattazione il contesto e rimasto al 63%.')
  expect(avvisoCompattato(65, 9_400)).toBe('regia: contesto compattato, era al 65%; la conversazione ora pesa circa 9k token')
  expect(avvisoCompattato(undefined, undefined)).toBe('regia: contesto compattato')
})

// ── la mod intera, con un motore finto ──

const DOMANDE = `${HOME}/.claude/regia/domande.json`
const CHIAVE_STATO = `regia.compatta.${SESSIONE}`
const REGISTRO_PIANO = JSON.stringify({ lavori: PIANO.map(v => ({ ...v, sessione: SESSIONE })) })
const DOMANDE_APERTE = JSON.stringify({ domande: [{ ...DOMANDA, contesto: 'Tre anni di letture.', stato: 'aperta', sessione: SESSIONE, creataMs: 1, aggiornataMs: 1 }] })

type Finto = {
  /** Il riempimento che il motore dice; `undefined` come dopo una compattazione. */
  pieno: number | undefined
  /** Il riempimento che il motore misura al turno dopo una compattazione. */
  pienoDopo?: number
  compattazioni: { trigger: string; instructions?: string; agentId?: string }[]
  inviati: string[]
  bozza: string
  rifiuto?: string
}

const RIASSUNTO = { role: 'user' as const, text: 'riassunto', toolUses: [] }

/**
 * Cio che la compattazione chiede al motore e che `ambiente` non ha: il contesto (`session.usage`),
 * la compattazione (`session.compact`), le superfici, il campo del prompt e l'invio di un prompt.
 */
function motore(on: On, superfici: string[] = ['terminal'], pieno?: number): Finto {
  const f: Finto = { pieno, compattazioni: [], inviati: [], bozza: '' }
  on('session.surfaces', () => ({ value: superfici as never }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 200_000, ...(f.pieno === undefined ? {} : { percent: f.pieno, tokens: f.pieno * 2_000 }) } } }))
  on('session.compact', (_, e) => {
    if (f.rifiuto !== undefined) throw new Error(f.rifiuto)
    f.compattazioni.push({ trigger: e.trigger, ...(e.instructions === undefined ? {} : { instructions: e.instructions }), ...(e.agentId === undefined ? {} : { agentId: e.agentId }) })
    // Subito dopo il motore non sa il riempimento: lo dice la risposta successiva.
    f.pieno = undefined

    return { messages: [RIASSUNTO], tokensBefore: 130_000, tokensAfter: 9_400 }
  })
  on('prompt.read', () => ({ value: { text: f.bozza, cursor: 0 } }))
  on('prompt.submit', (_, e) => {
    f.inviati.push(e.text)

    return { text: e.text } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)

  return f
}

/** La principale chiude un turno; poi il timer con cui la mod compatta fuori dall'hook. */
async function fineTurno($: Engine, amb: Ambiente, turnId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer', ...extra } as never)
  await amb.clock?.advance(10)
}

const conPiano = { file: { [REGISTRO]: REGISTRO_PIANO, [DOMANDE]: DOMANDE_APERTE } }
const modalita = (amb: Ambiente, profilo: string) => amb.store.set(`regia.profilo.${SESSIONE}`, { profilo, isVia: false, aggiornatoMs: 1 })

test('un turno che finisce al 65% fa una compattazione sola, con le istruzioni della regia; al 40% nessuna', async ($, on) => {
  const amb = ambiente(on, conPiano)
  const f = motore(on, ['terminal'], 40)

  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toEqual([])

  f.pieno = 65
  await fineTurno($, amb, 't2')
  expect(f.compattazioni).toHaveLength(1)
  expect(f.compattazioni[0]?.trigger).toBe('plugin')
  const istruzioni = f.compattazioni[0]?.instructions ?? ''
  // Una volta sola: la chiamata le porta gia, e l'hook della mod non le raddoppia.
  expect(istruzioni.split(INTESTAZIONE)).toHaveLength(2)
  expect(istruzioni.startsWith(INTESTAZIONE)).toBe(true)
  expect(istruzioni).toContain('- sviluppo-04 [2 · sviluppo] in_corso: Titolo di sviluppo-04 — Il modulo storico')
  expect(istruzioni).toContain('- Quale database per lo storico? (id db) — opzioni: 1) Postgres; 2) SQLite')
  expect(istruzioni).toContain('Modalita: medium; la persona e qui (here).')
  expect(amb.avvisi).toContain('regia: contesto compattato, era al 65%; la conversazione ora pesa circa 9k token')
  expect(amb.store.get(CHIAVE_STATO)).toMatchObject({ turno: 't2', isAvvisato: false, ultima: { origine: 'soglia', primaPct: 65, tokensPrima: 130_000, tokensDopo: 9_400, oraMs: 1_700_000_000_010 } })
  // In medium nessun messaggio alla principale: continua la persona, sul riassunto.
  expect(f.inviati).toEqual([])

  // Appena compattato il motore non ha una misura: nulla, e nulla per un subagente o dopo un Esc.
  await fineTurno($, amb, 't3')
  f.pieno = 80
  await fineTurno($, amb, 't4', { agentId: 'a1' })
  await fineTurno($, amb, 't5', { reason: 'aborted', isAborted: true })
  expect(f.compattazioni).toHaveLength(1)
})

test('con compatta spenta, o senza superficie, a fine turno non si compatta', async ($, on) => {
  const amb = ambiente(on, { config: { compatta: false } })
  const f = motore(on, ['terminal'], 85)
  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toEqual([])
  expect(amb.store.has(CHIAVE_STATO)).toBe(false)
})

test('claude -p e gli SDK (nessuna superficie) non compattano a fine turno', async ($, on) => {
  const amb = ambiente(on)
  const f = motore(on, [], 85)
  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toEqual([])
})

test('la guardia nella mod: se il contesto resta alla soglia non si compatta di nuovo, e lo si dice una volta', async ($, on) => {
  const amb = ambiente(on, { config: { compattaSoglia: 50 } })
  const f = motore(on, ['terminal'], 55)

  await fineTurno($, amb, 't1')
  // La fine dello stesso turno sentita due volte non compatta due volte.
  f.pieno = 55
  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toHaveLength(1)

  // Il contesto lo riempie qualcosa che il riassunto non riduce: al turno dopo e ancora al 54%.
  f.pieno = 54
  await fineTurno($, amb, 't2')
  f.pieno = 58
  await fineTurno($, amb, 't3')
  expect(f.compattazioni).toHaveLength(1)
  expect(amb.avvisi.filter(a => a.includes('non si raggiunge'))).toEqual(['regia: il contesto resta al 54% anche dopo la compattazione, la soglia del 50% non si raggiunge: alzala con /regia compact <numero>'])
  expect(amb.store.get(CHIAVE_STATO)).toMatchObject({ isAvvisato: true, ultima: { dopoPct: 54 } })

  // Cresciuto di 10 punti da allora: si riprova.
  f.pieno = 64
  await fineTurno($, amb, 't4')
  expect(f.compattazioni).toHaveLength(2)
})

test('se il motore rifiuta perche un turno e partito non si dice nulla e si riprova alla fine del turno dopo', async ($, on) => {
  const amb = ambiente(on)
  const f = motore(on, ['terminal'], 70)
  f.rifiuto = '$.session.compact: a turn is running (abc); the conversation compacts between turns, so call it from turn.complete or later'

  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toEqual([])
  expect(amb.avvisi).toEqual([])
  expect(amb.store.get(CHIAVE_STATO)).toMatchObject({ turno: 't1' })
  expect((amb.store.get(CHIAVE_STATO) as StatoCompatta).ultima).toBeUndefined()

  f.rifiuto = undefined
  await fineTurno($, amb, 't2')
  expect(f.compattazioni).toHaveLength(1)

  // Un altro guasto invece si dice, una volta.
  f.pieno = 90
  f.rifiuto = 'il riassunto non e arrivato'
  await fineTurno($, amb, 't3')
  f.pieno = 90
  await fineTurno($, amb, 't4')
  expect(amb.avvisi.filter(a => a.includes('non riuscita'))).toEqual(['regia: compattazione non riuscita (il riassunto non e arrivato)'])
})

const evento = (extra: Record<string, unknown>) => ({ trigger: 'manual', messages: [RIASSUNTO], ...extra }) as never

test('ogni compattazione della principale riceve le istruzioni della regia dopo quelle della persona; quella di un subagente no', async ($, on) => {
  const amb = ambiente(on, conPiano)
  const f = motore(on)
  modalita(amb, 'long')

  await $.session.compact(evento({ instructions: 'tieni soprattutto il numero 42' }))
  const manuale = f.compattazioni[0]?.instructions ?? ''
  expect(manuale.startsWith(`tieni soprattutto il numero 42\n\n${INTESTAZIONE}`)).toBe(true)
  expect(manuale).toContain('Modalita: long; la persona e qui (here).')
  expect(manuale).toContain('- studio-api [1 · analisi] fatto: Titolo di studio-api')
  expect(manuale).toContain('Domande aperte per la persona (1), ancora senza risposta:')
  expect(manuale.length).toBeLessThanOrEqual(MASSIMO_ISTRUZIONI + 40)

  // La soglia del motore, e il riassunto fatto in anticipo che il motore riusa: senza istruzioni di nessuno, quelle della regia.
  await $.session.compact(evento({ trigger: 'auto' }))
  await $.session.compact(evento({ trigger: 'precompute' }))
  expect(f.compattazioni[1]?.instructions?.startsWith(INTESTAZIONE)).toBe(true)
  expect(f.compattazioni[2]).toMatchObject({ trigger: 'precompute' })
  expect(f.compattazioni[2]?.instructions?.startsWith(INTESTAZIONE)).toBe(true)

  // Un subagente compatta la sua conversazione: non si tocca.
  await $.session.compact(evento({ agentId: 'a1', instructions: 'sue' }))
  await $.session.compact(evento({ agentId: 'a1' }))
  expect(f.compattazioni[3]).toEqual({ trigger: 'manual', instructions: 'sue', agentId: 'a1' })
  expect(f.compattazioni[4]).toEqual({ trigger: 'manual', agentId: 'a1' })

  // Istruzioni che le portano gia (la chiamata di una mod): non due volte.
  await $.session.compact(evento({ trigger: 'plugin', instructions: manuale }))
  expect(f.compattazioni[5]?.instructions).toBe(manuale)
  // Una compattazione che non e della mod non fa riprendere nessuno.
  expect(f.inviati).toEqual([])
})

test('con compatta spenta l\'hook non aggiunge nulla', async ($, on) => {
  ambiente(on, { ...conPiano, config: { compatta: false } })
  const f = motore(on)
  await $.session.compact(evento({ instructions: 'mie' }))
  await $.session.compact(evento({}))
  expect(f.compattazioni).toEqual([{ trigger: 'manual', instructions: 'mie' }, { trigger: 'manual' }])
})

test('in long col piano aperto, dopo la compattazione la principale riprende con un messaggio solo; in medium nessuno', async ($, on) => {
  const amb = ambiente(on, conPiano)
  const f = motore(on, ['terminal'], 65)
  modalita(amb, 'long')

  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toHaveLength(1)
  expect(f.compattazioni[0]?.instructions).toContain('Modalita: long')
  expect(f.inviati).toEqual([testoRipresa({ piano: PIANO.map(v => ({ ...v, sessione: SESSIONE })), domande: [DOMANDA] })])
  expect(f.inviati[0]).toContain('- sviluppo-04 [2 · sviluppo] in_corso: Titolo di sviluppo-04')
  expect(f.inviati[0]).toContain('Domande aperte per la persona, non ripeterle: Quale database per lo storico? (db).')
  // Altri turni senza una nuova compattazione: nessun altro messaggio.
  await fineTurno($, amb, 't2')
  f.pieno = 30
  await fineTurno($, amb, 't3')
  expect(f.inviati).toHaveLength(1)

  // In medium, la stessa cosa non manda nulla.
  modalita(amb, 'medio')
  f.pieno = 66
  await fineTurno($, amb, 't4')
  expect(f.compattazioni).toHaveLength(2)
  expect(f.inviati).toHaveLength(1)
})

test('in long non si riprende col piano fermo su voci bloccate, ne sopra la bozza della persona', async ($, on) => {
  const bloccato = JSON.stringify({ lavori: [{ id: 'deploy', titolo: 'Deploy', stato: 'bloccato', note: 'aspetta la risposta sul database', sessione: SESSIONE }] })
  const amb = ambiente(on, { file: { [REGISTRO]: bloccato, [DOMANDE]: DOMANDE_APERTE } })
  const f = motore(on, ['terminal'], 65)
  modalita(amb, 'long')

  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toHaveLength(1)
  expect(f.compattazioni[0]?.instructions).toContain('- deploy bloccato: Deploy (motivo: aspetta la risposta sul database)')
  expect(f.inviati).toEqual([])
})

test('in long la ripresa non passa davanti alla persona che sta scrivendo', async ($, on) => {
  const amb = ambiente(on, conPiano)
  const f = motore(on, ['terminal'], 65)
  modalita(amb, 'long')
  f.bozza = 'sto scrivendo'

  await fineTurno($, amb, 't1')
  expect(f.compattazioni).toHaveLength(1)
  expect(f.inviati).toEqual([])
})

const comando = ($: Engine, args: string) =>
  $.command.run({ command: 'regia', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

test('/regia compact mostra e cambia; now compatta dopo il comando, senza ripresa, e dice se il motore rifiuta', async ($, on) => {
  const amb = ambiente(on, conPiano)
  const f = motore(on, ['terminal'], 43)
  modalita(amb, 'long')
  const config = () => JSON.parse(amb.scritti.get(CONFIG) ?? '{}') as Record<string, unknown>

  const stato = (await comando($, 'compact')).text
  expect(stato).toContain('Compattazione: ACCESA, soglia 60%.')
  expect(stato).toContain('Contesto adesso: 43% (86k di 200k token).')
  expect(stato).toContain('Ultima compattazione della mod in questa sessione: nessuna.')

  expect((await comando($, 'compact 75')).text).toContain('soglia 75%.')
  expect(config().compattaSoglia).toBe(75)
  expect((await comando($, 'compatta off')).text).toContain('Compattazione: SPENTA, soglia 75%.')
  expect(config()).toMatchObject({ compatta: false, compattaSoglia: 75 })
  expect((await comando($, 'compact 95')).text).toContain('da 30 a 90')
  expect(config().compattaSoglia).toBe(75)

  // Anche da spenta: e la persona che la chiede. Dentro l'hook del comando il motore rifiuta, quindi parte dopo.
  expect((await comando($, 'compact now')).text).toContain('Compatto adesso con le istruzioni della regia')
  expect(f.compattazioni).toEqual([])
  await amb.clock?.advance(10)
  expect(f.compattazioni).toHaveLength(1)
  expect(f.compattazioni[0]?.instructions?.split(INTESTAZIONE)).toHaveLength(2)
  expect(amb.avvisi).toContain('regia: contesto compattato, era al 43%; la conversazione ora pesa circa 9k token')
  expect(amb.store.get(CHIAVE_STATO)).toMatchObject({ ultima: { origine: 'comando', primaPct: 43 } })
  // La compattazione chiesta dalla persona non fa ripartire la principale.
  expect(f.inviati).toEqual([])
  expect((await comando($, 'compact')).text).toContain('(/regia compact now), il contesto era al 43%')

  f.rifiuto = '$.session.compact: a turn is running (abc); the conversation compacts between turns'
  await comando($, 'compact now')
  await amb.clock?.advance(10)
  expect(amb.avvisi).toContain('regia: il motore non compatta adesso, un turno e in corso: riprova a turno finito')
  expect((await comando($, 'doctor')).text).toContain('Compattazione: SPENTA, soglia 75% — contesto non ancora misurato (/regia compact).')
})
