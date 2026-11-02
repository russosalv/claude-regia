import { expect, test } from 'claude-code/testing'

import { ricordiAggiornati, ricordiDaMemoria, statoAgente } from '../hooks/agenti'
import { costruisciSnapshot, testoStato } from '../hooks/model'
import { AGENTE_FINITO, AGENTE_VIVO, ALTRA, SESSIONE, baseInput } from './fixture'

const ORA = 1_700_000_000_000

test('un subagente completato o idle non e in corso; un teammate idle si', () => {
  expect(statoAgente({ status: 'completed' })).toBe('fatto')
  expect(statoAgente({ status: 'idle' })).toBe('fatto')
  expect(statoAgente({ status: 'idle', teammateId: 'x@squadra' })).toBe('in_corso')
  expect(statoAgente({ status: 'running' })).toBe('in_corso')
  expect(statoAgente({ status: 'waiting' })).toBe('in_corso')
  expect(statoAgente({ status: 'failed' })).toBe('fallito')
  expect(statoAgente({ status: 'killed' })).toBe('interrotto')
})

test('un AgentInfo completato va nei fatti, senza durata finta', () => {
  const prima = costruisciSnapshot({
    ...baseInput(),
    processi: [],
    oraMs: ORA,
    isPrimaLettura: true,
    agenti: [AGENTE_FINITO, AGENTE_VIVO],
  })
  const vista = prima.viste.sessione

  expect(vista.inCorso.map(r => r.nome)).toEqual(['revisione heatmap'])
  const finito = vista.fatti.find(r => r.agenteId === 'a-finito')
  expect(finito?.stato).toBe('fatto')
  expect(finito?.esito).toBe('completato')
  expect(finito?.durataSec).toBeUndefined()
  // Era gia li alla prima lettura: la sua durata e solo un minimo.
  expect(vista.inCorso[0]?.isDurataCerta).toBe(false)

  // Un agente che compare dopo la prima lettura ha l'inizio noto.
  const dopo = costruisciSnapshot({
    ...baseInput(),
    processi: [],
    oraMs: ORA + 60_000,
    isPrimaLettura: false,
    tempiPrecedenti: prima.tempiAgenti,
    agenti: [AGENTE_FINITO, AGENTE_VIVO, { ...AGENTE_VIVO, id: 'a-nuovo', description: 'nuovo' }],
  })
  const nuovo = dopo.viste.sessione.inCorso.find(r => r.agenteId === 'a-nuovo')
  expect(nuovo?.isDurataCerta).toBe(true)
  expect(nuovo?.durataSec).toBe(0)
  expect(dopo.viste.sessione.inCorso.find(r => r.agenteId === 'a-vivo')?.durataSec).toBe(60)
})

test('la riga di stato non ripete il nome della mod e tace se non c e nulla', () => {
  const vuoto = costruisciSnapshot({ ...baseInput(), processi: [], nomiSessione: new Set(), log: [] })
  expect(testoStato(vuoto)).toBeUndefined()

  const pieno = costruisciSnapshot({ ...baseInput(), oraMs: ORA, agenti: [AGENTE_VIVO] })
  expect(testoStato(pieno)).toBe('● 1 codex · 1 claude')
})

test('la scaletta nella vista sessione: le voci di questa sessione e quelle senza sessione', () => {
  const voce = (id: string, sessione?: string) => ({ id, titolo: id, stato: 'scaletta' as const, ...(sessione === undefined ? {} : { sessione }) })
  const snap = costruisciSnapshot({ ...baseInput(), oraMs: ORA, sessioneId: SESSIONE, registro: [voce('mia', SESSIONE), voce('altrui', ALTRA), voce('a-mano')] })
  const nomi = (righe: readonly { nome: string }[]) => righe.map(r => r.nome)

  expect(nomi(snap.viste.sessione.scaletta)).toEqual(['mia', 'a-mano'])
  expect(nomi(snap.viste.tutti.scaletta)).toEqual(['mia', 'altrui', 'a-mano'])
})

test('i compiti di uno sciame in attesa stanno in scaletta, i bloccati segnati', () => {
  const snap = costruisciSnapshot({ ...baseInput(), oraMs: ORA, registro: [], attesaSciame: [
    { sciame: 's1', nome: 'test', esecutore: 'claude', isBloccato: false },
    { sciame: 's1', nome: 'rilascio', esecutore: 'codex', isBloccato: true },
  ] })

  expect(snap.viste.sessione.scaletta.map(r => `${r.nome}:${r.stato}:${r.note}`)).toEqual(['test:scaletta:sciame s1', 'rilascio:bloccato:sciame s1'])
})

test('i subagenti conclusi restano nei Fatti anche quando il motore li toglie', () => {
  const prima = costruisciSnapshot({ ...baseInput(), processi: [], oraMs: ORA, agenti: [AGENTE_FINITO, AGENTE_VIVO] })
  const ricordi = ricordiAggiornati(ricordiDaMemoria({ agenti: [{ rotto: true }] }), [AGENTE_FINITO, AGENTE_VIVO], prima.tempiAgenti, ORA)
  expect(ricordi.map(r => `${r.id}:${r.tipo}:${r.esito}:${r.fineMs}`)).toEqual([`a-finito:fork:completato:${ORA}`])
  // Lo store li rilegge uguali.
  expect(ricordiDaMemoria(JSON.parse(JSON.stringify({ nomi: [], agenti: ricordi })))).toEqual(ricordi)

  // Il motore non lo riporta piu: resta nei Fatti, senza tasto per aprirlo.
  const dopo = costruisciSnapshot({ ...baseInput(), processi: [], oraMs: ORA + 60_000, agenti: [AGENTE_VIVO], ricordiAgenti: ricordi })
  const fatto = dopo.viste.sessione.fatti.find(r => r.chiave === 'claude:a-finito')
  expect(fatto?.esito).toBe('completato')
  expect(fatto?.esecutore).toBe('claude:fork')
  expect(fatto?.agenteId).toBeUndefined()
  expect(dopo.viste.sessione.inCorso.map(r => r.nome)).toEqual(['revisione heatmap'])
  // Riconfermato da una lettura successiva, l'ora di fine resta la prima.
  expect(ricordiAggiornati(ricordi, [AGENTE_FINITO], {}, ORA + 99)[0]?.fineMs).toBe(ORA)
})
