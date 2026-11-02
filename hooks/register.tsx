import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { RegiaDettaglio, RegiaScrittura } from '../types/index'
import { avvia, ferma, leggiOra } from './ciclo'
import { codexAvvia } from './codex-avvia'
import { codexRiprendi } from './codex-riprendi'
import { comandoOpzione, leggiArgomentiOpzione } from './comando-opzioni'
import { comandoDoctor, rigaModi } from './doctor'
import { inviaDaUtente, specchiaSendMessage, toolInvia, toolLeggi } from './posta-azioni'
import { avviaPostino, fermaPostino, installaPosta, registraStrumenti } from './strumenti'
import { comandoPonytail, installaDipendenze, leggiArgomentiPonytail } from './ponytail'
import { contaToken, notaPasso, preparaAgent, sforzoDelPasso, suSpawn } from './modelli'
import { ID_SEZIONE, motivoRifiuto, sezioniConOrchestra } from './orchestra'
import { scalettaScrivi } from './scaletta'
import { avviaSciami, fermaSciami, giro, notaFine, sciameAggiungi, sciameAvvia, sciameFerma, sciameStato } from './sciame-motore'
import { RIGHE_LOG, codaLog } from './dettaglio'
import { leggiConfig, leggiCoda, leggiHome } from './fonti'
import { SNAPSHOT_VUOTO, riepilogoTestuale } from './model'
import { accorciaPercorso, messaggioErrore } from './parsers'
import { vistaRegia } from './vista'

// Dichiarato qui (e non importato) perché `claude plugin validate` legge lo
// stato solo dalle `atom` scritte nel file che le usa. Stesso tag in ogni file;
// cambialo quando cambiano i campi dello snapshot.
const snapshot = atom(
  { plugin: 'regia', key: 'snapshot' } as const,
  SNAPSHOT_VUOTO,
  { shape: 'snapshot-4' },
)

const vista = atom(
  { plugin: 'regia', key: 'vista' } as const,
  'sessione',
  { shape: 'vista-1' },
)

const NESSUN_DETTAGLIO: RegiaDettaglio = { nome: '', percorso: '', righe: [], lettoMs: 0 }

const dettaglio = atom(
  { plugin: 'regia', key: 'dettaglio' } as const,
  NESSUN_DETTAGLIO,
  { shape: 'dettaglio-1' },
)

const NESSUNA_SCRITTURA: RegiaScrittura = { a: '', etichetta: '', modo: 'posta' }

const scrittura = atom(
  { plugin: 'regia', key: 'scrittura' } as const,
  NESSUNA_SCRITTURA,
  { shape: 'scrittura-1' },
)

const PANE = 'regia'
const TITOLO = 'Regia agenti'
const BATTITO_MS = 1000

// Ridisegna una volta al secondo mentre qualcosa è in corso, così spinner e
// durate si muovono; fermo, nulla. Vive col modulo come il ciclo delle letture.
let battito: Timer | undefined

function avviaBattito($: EngineInterface): void {
  if (battito !== undefined) return
  battito = $.clock.every(BATTITO_MS, async () => {
    const dati = await read($, snapshot)
    const isAttivo = dati.viste.sessione.inCorso.length + dati.viste.tutti.inCorso.length > 0
    if (isAttivo) $.ui.invalidate('ui.render')
  })
}

function fermaBattito(): void {
  battito?.cancel()
  battito = undefined
}

/** Legge le ultime righe del log e le mette nella vista di dettaglio del pane. */
async function apriLog($: EngineInterface, nome: string, percorso: string): Promise<void> {
  const [coda, oraMs, home] = await Promise.all([
    leggiCoda($, percorso, RIGHE_LOG),
    $.clock.now(),
    $.env.get('HOME'),
  ])
  const visto = home === undefined ? percorso : accorciaPercorso(percorso, home, 60)
  await update($, dettaglio, () => ({
    nome,
    percorso: visto,
    percorsoPieno: percorso,
    righe: coda.dati === undefined ? [] : codaLog(coda.dati),
    errore: coda.avvisi[0],
    lettoMs: oraMs,
  }))
}

/** Porta nella vista principale la conversazione di un subagente, dove gli si puo scrivere. */
async function apriAgente($: EngineInterface, agenteId: string): Promise<void> {
  try {
    const esito = await $.ui.view({ agentId: agenteId })
    if (esito.deny !== undefined) $.ui.toast(`regia: non riesco ad aprire il subagente (${esito.deny})`)
  } catch (errore) {
    $.ui.toast(`regia: non riesco ad aprire il subagente (${messaggioErrore(errore)})`)
  }
}

/** Il campo del pane: manda la posta da utente, o riprende un Codex. */
async function inviaScrittura($: EngineInterface, testo: string): Promise<void> {
  const aperta = await read($, scrittura)
  if (aperta.a === '' || testo.trim() === '') return
  await update($, scrittura, () => NESSUNA_SCRITTURA)
  if (aperta.modo === 'posta') {
    await inviaDaUtente($, aperta.a, testo)
  } else {
    const esito = await codexRiprendi($, { nome: aperta.a, messaggio: testo })
    $.ui.toast('deny' in esito ? esito.deny : `↻ ${esito.result}`, { timeoutMs: 8_000 })
  }
  await leggiOra($)
}

/** Tutto cio che deve girare in una sessione: tool, CLI, letture, battito, postino. */
async function accendi($: EngineInterface): Promise<void> {
  void avvia($)
  avviaBattito($)
  avviaPostino($, () => void leggiOra($))
  avviaSciami($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'regia',
      description: 'Apre il pane Regia agenti e riassume lavori in corso, scaletta e fatti',
      argumentHint: '[tutti | doctor | ponytail [on|off] | sciame | modelli [on|off] | orchestra [stretta|guida|off] | risparmio [on|off]]',
    })
    await registraStrumenti($)
    await installaPosta($)
    await accendi($)
    // Solo con una persona davanti: `claude -p` e gli SDK non installano nulla.
    if (e.isInteractive) void installaDipendenze($)

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    // Dopo un ricaricamento a caldo session.start non scatta di nuovo.
    void accendi($)

    return next(e)
  })

  on('session.end', ($, e, next) => {
    ferma()
    fermaBattito()
    fermaPostino()
    fermaSciami()
    $.ui.status(undefined)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__regia__codex_avvia' }, async ($, e) => {
    const esito = await codexAvvia($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'codex_avvia: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__codex_riprendi' }, async ($, e) => {
    const esito = await codexRiprendi($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'codex_riprendi: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__posta_invia' }, async ($, e) => {
    const esito = await toolInvia($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'posta_invia: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__posta_leggi' }, ($, e) => toolLeggi($, e))
    .catch(($, e, next) => (next.called ? next(e) : { deny: 'posta_leggi: errore interno della mod regia' }))

  // Specchio in posta dei messaggi fra agenti Claude mandati con SendMessage.
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const esito = await next(e)
    await specchiaSendMessage($, e, esito.deny === undefined && esito.isError !== true)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__regia__scaletta_scrivi' }, async ($, e) => {
    const esito = await scalettaScrivi($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'scaletta_scrivi: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__sciame_avvia' }, async ($, e) => {
    const esito = await sciameAvvia($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'sciame_avvia: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__sciame_stato' }, async ($, e) => {
    const esito = await sciameStato($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'sciame_stato: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__sciame_aggiungi' }, async ($, e) => {
    const esito = await sciameAggiungi($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'sciame_aggiungi: errore interno della mod regia' }))

  on('tool.call', { tool: 'mcp__regia__sciame_ferma' }, async ($, e) => {
    const esito = await sciameFerma($, e)
    void leggiOra($)

    return esito
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'sciame_ferma: errore interno della mod regia' }))

  // La regola della delega: nel prompt, e in modo `stretta` anche qui.
  on('prompt.compose', async ($, e, next) => {
    const esito = await next(e)
    const sezioni = await sezioniConOrchestra($, e, esito.sections, text => ({ id: ID_SEZIONE, text, scope: 'session' as const }))

    return { ...esito, sections: sezioni }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const motivo = await motivoRifiuto($, e)

    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const motivo = await motivoRifiuto($, e)

    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const motivo = await motivoRifiuto($, e)

    return motivo === undefined ? next(e) : { deny: motivo }
  }).catch(($, e, next) => next(e))

  // Modello e sforzo di ogni delegato, decisi sul suo compito (vedi instradamento.ts).
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => next(await preparaAgent($, e)))
    .catch(($, e, next) => next(e))

  on('agent.spawn', ($, e, next) => suSpawn($, e, next)).catch(($, e, next) => next(e))

  // Come fa Vitals: ogni richiesta dice il modello e lo sforzo veri del subagente.
  on('turn.step', async function* ($, e, next) {
    const sforzo = await sforzoDelPasso($, e.agentId).catch(() => undefined)
    const passo = sforzo === undefined ? e : { ...e, effort: sforzo as typeof e.effort }
    await notaPasso($, passo.agentId, passo.model, passo.effort).catch(() => undefined)

    return yield* next(passo)
  })

  on('turn.complete', async ($, e, next) => {
    const esito = await next(e)
    await contaToken($, e)
    if (e.agentId !== undefined) await notaFine($, e.agentId, e.reason, e.answer)

    return esito
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'regia' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'doctor') return { text: await comandoDoctor($) }
    const ponytail = leggiArgomentiPonytail(e.args)
    if (ponytail !== undefined) return { text: await comandoPonytail($, ponytail) }
    const opzione = leggiArgomentiOpzione(e.args)
    if (opzione !== undefined) return { text: await comandoOpzione($, opzione) }
    if (e.args.trim().toLowerCase() === 'sciame') {
      await giro($)
      const stato = await sciameStato($, {})

      return { text: 'deny' in stato ? stato.deny : stato.result }
    }
    const scelta = e.args.trim().toLowerCase() === 'tutti' ? 'tutti' : 'sessione'
    await update($, vista, () => scelta)
    await update($, dettaglio, () => NESSUN_DETTAGLIO)
    // /regia riporta anche alla conversazione principale (se si guardava un
    // subagente). Dove la superficie non ha viste non c'e nulla da riportare.
    await $.ui.view({}).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITOLO })
    await accendi($)
    await avvia($)
    await leggiOra($)

    const home = await leggiHome($)
    const modi = home === undefined ? [] : [rigaModi((await leggiConfig($, home)).dati)]

    return { text: [riepilogoTestuale(await read($, snapshot), scelta), ...modi].join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const dati = await read($, snapshot)
    const corrente = await read($, vista)
    const oraMs = await $.clock.now()
    const aperto = await read($, dettaglio)
    const campo = await read($, scrittura)
    const onCambiaVista = () =>
      update($, vista, v => (v === 'tutti' ? 'sessione' : 'tutti'))

    return vistaRegia(dati, $.ui.resolve(e), {
      vista: corrente,
      colonne: e.props.bodyColumns,
      oraMs,
      onCambiaVista,
      azioni: {
        apriAgente: id => void apriAgente($, id),
        apriLog: (nome, percorso) => void apriLog($, nome, percorso),
        scrivi: (a, etichetta) => void update($, scrittura, () => ({ a, etichetta, modo: 'posta' as const })),
        riprendi: nome => void update($, scrittura, () => ({ a: nome, etichetta: nome, modo: 'riprendi' as const })),
      },
      agenteInVista: e.props.view.agentId,
      onTornaPrincipale: () => void $.ui.view({}).catch(() => undefined),
      dettaglio: aperto,
      onChiudiDettaglio: () => void update($, dettaglio, () => NESSUN_DETTAGLIO),
      onRileggiDettaglio: () => void apriLog($, aperto.nome, aperto.percorsoPieno ?? aperto.percorso),
      scrittura: campo,
      tastiScrittura: {
        onInvia: testo => void inviaScrittura($, testo),
        onAnnulla: () => void update($, scrittura, () => NESSUNA_SCRITTURA),
      },
    })
  })
}
