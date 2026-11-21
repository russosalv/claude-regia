// Le modalita long/medio/quick, le domande per la persona con le notifiche, e
// il piano come tasklist nel pane.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { aCapo } from '../hooks/dettaglio'
import { conDomanda, domandeAperte, promptApprofondisci } from '../hooks/domande'
import { TESTI_ORCHESTRA } from '../hooks/orchestra'
import { leggiArgomentiProfilo, statoDaStore } from '../hooks/profilo'
import { conVoce } from '../hooks/scaletta'
import { cellWidth } from '../hooks/tavola'
import { HOME, PANE, SESSIONE } from './fixture'
import { ambiente } from './ambiente'
import { resa } from './resa'

const comando = ($: Engine, args: string) =>
  $.command.run({ command: 'regia', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

const INPUT_PROMPT = { model: 'm', promptModel: 'm', outputStyle: null, surfaces: ['terminal'], tools: ['Agent'], traits: [] } as const

test('il comando dice la modalita, con l\'obiettivo; il resto non e una modalita', () => {
  expect(leggiArgomentiProfilo('long porta avanti i 20 sviluppi')).toEqual({ nome: 'long', obiettivo: 'porta avanti i 20 sviluppi' })
  expect(leggiArgomentiProfilo(' QUICK ')).toEqual({ nome: 'quick', obiettivo: '' })
  expect(leggiArgomentiProfilo('away')).toEqual({ nome: 'via', obiettivo: '' })
  expect(leggiArgomentiProfilo('medium fai X')).toEqual({ nome: 'medio', obiettivo: 'fai X' })
  expect(leggiArgomentiProfilo('via')).toEqual({ nome: 'via', obiettivo: '' })
  expect(leggiArgomentiProfilo('tutti')).toBeUndefined()
  expect(leggiArgomentiProfilo('longevo')).toBeUndefined()
  expect(statoDaStore(undefined)).toEqual({ profilo: 'medio', isVia: false, aggiornatoMs: 0 })
  expect(statoDaStore({ profilo: 'boh', isVia: true }).profilo).toBe('medio')
})

const SQUADRE = ['claude', 'mista', 'esterni'] as const

test('le regole: long orchestra e fa da se le cose rapide, quick lavora da sola; ogni domanda col suo contesto', () => {
  for (const squadra of SQUADRE) {
    expect(TESTI_ORCHESTRA.long[squadra]).toContain('Le cose rapide falle tu')
    expect(TESTI_ORCHESTRA.long[squadra]).toContain('`descrizione`')
    expect(TESTI_ORCHESTRA.medio[squadra]).toContain('Lavori tu sul compito')
    expect(TESTI_ORCHESTRA.quick[squadra]).toContain('senza subagenti')
    for (const perSquadra of Object.values(TESTI_ORCHESTRA)) expect(perSquadra[squadra]).toContain('Mai "per la domanda 1 cosa facciamo?"')
    expect(TESTI_ORCHESTRA.quick[squadra]).not.toContain('domanda_scrivi')
  }
})

const riga = (profilo: 'long' | 'medio', squadra: (typeof SQUADRE)[number], pezzo: string) => TESTI_ORCHESTRA[profilo][squadra].split('\n').find(r => r.includes(pezzo)) ?? ''
const AGENT_PER_I_LAVORI_INDIPENDENTI = '- Lavori indipendenti: piu chiamate ad Agent nello stesso messaggio, senza aspettare l\'una per l\'altra.'
const SCIAME_DA_TRE = '- Tre o piu compiti, o compiti con dipendenze: `mcp__regia__sciame_avvia` (schema con ToolSearch). Gestisce coda, parallelismo, ripresa di chi fallisce e dipendenze; ti scrive lui alla fine, non controllarlo.'

test('squadra claude: in long sviluppa Claude e gli esterni si usano solo se la persona li nomina; in medio non se ne parla', () => {
  const long = TESTI_ORCHESTRA.long.claude

  // Le due righe di prima della 0.15, senza nulla sull'esecutore.
  expect(long.split('\n')).toContain(AGENT_PER_I_LAVORI_INDIPENDENTI)
  expect(long.split('\n')).toContain(SCIAME_DA_TRE)
  const squadra = riga('long', 'claude', 'La squadra di sviluppo e Claude')
  expect(squadra).toBe('- La squadra di sviluppo e Claude: i subagenti (Agent) e i compiti dello sciame. Gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) si usano solo quando la persona li nomina, con `esecutore` nello sciame o con `mcp__regia__codex_avvia`, `mcp__regia__qoder_avvia` (i modelli Qwen: preferito a `mcp__regia__qwen_avvia`, che resta per Qwen Code), `mcp__regia__qwen_avvia`, `mcp__regia__copilot_avvia`.')
  // Nulla dice alla principale di usare gli esterni da se, ne di lasciare l'esecutore alla mod.
  for (const pezzo of ['fanno parte della squadra', 'senza aspettare che la persona', 'Non indicare `esecutore`', 'lo sceglie la mod fra', 'sciame di un compito', 'quota']) expect(long).not.toContain(pezzo)
  expect(long.split('\n').filter(r => /Codex|Qwen|Copilot|codex_avvia/.test(r))).toEqual([squadra])

  expect(TESTI_ORCHESTRA.medio.claude).not.toContain('sciame_avvia')
  expect(TESTI_ORCHESTRA.medio.claude).not.toContain('esecutor')
})

test('squadra mista (la predefinita): in long Agent per i lavori indipendenti, lo sciame da tre compiti senza `esecutore`, gli esterni rinforzi entro la quota', () => {
  const long = TESTI_ORCHESTRA.long.mista

  // I subagenti sono il modo normale di fare in parallelo, non solo per cio che e legato alla sessione.
  expect(long.split('\n')).toContain(AGENT_PER_I_LAVORI_INDIPENDENTI)
  expect(long).not.toContain('legati a questa sessione')
  expect(riga('long', 'mista', '`mcp__regia__sciame_avvia`')).toBe(`${SCIAME_DA_TRE} Non indicare \`esecutore\`: la mod tiene lo sviluppo principale su Claude e da agli esecutori esterni accesi i compiti che gli si addicono (lavoro meccanico o in blocco, documentazione, test, revisioni indipendenti, seconde implementazioni), entro la quota. Indicalo solo se la persona lo chiede.`)
  expect(riga('long', 'mista', 'rinforzi')).toBe('- La squadra di sviluppo e Claude, come subagenti (Agent) e come compiti dello sciame; gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) sono rinforzi, non un sostituto.')
  for (const pezzo of ['fanno parte della squadra', 'senza aspettare che la persona', 'sciame di un compito', 'Due o piu compiti']) expect(long).not.toContain(pezzo)
  // La quota e nominata ma non il suo numero: la sezione non cambia quando cambia.
  expect(long).not.toMatch(/\d+%/)

  expect(riga('medio', 'mista', '`mcp__regia__sciame_avvia`')).toBe('- I pezzi indipendenti vanno a chiamate ad Agent; se li metti in uno sciame (`mcp__regia__sciame_avvia`, schema con ToolSearch) non indicare `esecutore`: la mod da quelli adatti agli esecutori esterni accesi (Codex, Qoder, Qwen Code, Copilot), entro la quota, e tiene gli altri su Claude.')
})

test('squadra esterni: il testo della 0.15, long li usa senza che la persona lo chieda e non indica l\'esecutore, medio li puo usare', () => {
  // Lo sciame: da due compiti indipendenti, senza `esecutore`, che sceglie la mod.
  expect(TESTI_ORCHESTRA.long.esterni.split('\n').slice(7, 10)).toEqual([
    '- Lavori indipendenti legati a questa sessione (i suoi tool e server MCP, una skill, un tipo di agente, cio che si e detto qui): piu chiamate ad Agent nello stesso messaggio, senza aspettare l\'una per l\'altra.',
    '- Due o piu compiti indipendenti e autosufficienti, o compiti con dipendenze: `mcp__regia__sciame_avvia` (schema con ToolSearch). Gestisce coda, parallelismo, ripresa di chi fallisce e dipendenze; ti scrive lui alla fine, non controllarlo. Non indicare `esecutore`: per ogni compito lo sceglie la mod fra Claude e gli esecutori esterni accesi, come fa per modello e sforzo.',
    // I tre esterni sono della squadra; i tool diretti solo se la persona nomina l'esecutore.
    '- Gli esecutori esterni (Codex, Qoder, Qwen Code, Copilot) fanno parte della squadra: usali senza aspettare che la persona lo chieda. Anche un solo compito lungo e autosufficiente lancialo come sciame di un compito, cosi riceve il suo esecutore. `mcp__regia__codex_avvia`, `mcp__regia__qoder_avvia` (i modelli Qwen: preferito a `mcp__regia__qwen_avvia`, che resta per Qwen Code), `mcp__regia__qwen_avvia` e `mcp__regia__copilot_avvia` servono quando la persona nomina l\'esecutore.',
  ])
  expect(TESTI_ORCHESTRA.long.esterni).not.toContain('fuori dalla sessione')
  expect(riga('medio', 'esterni', '`mcp__regia__sciame_avvia`')).toBe('- I pezzi indipendenti e autosufficienti possono andare anche in uno sciame (`mcp__regia__sciame_avvia`, schema con ToolSearch) senza indicare `esecutore`: la mod li distribuisce fra Claude e gli esecutori esterni accesi (Codex, Qoder, Qwen Code, Copilot).')
})

test('la regola cambia solo nelle righe della squadra, e quick e la stessa con ogni squadra', () => {
  // Quick lavora da sola: nessuno sciame e nessun esecutore nella sua regola.
  expect(TESTI_ORCHESTRA.quick.claude).toBe(TESTI_ORCHESTRA.quick.mista)
  expect(TESTI_ORCHESTRA.quick.esterni).toBe(TESTI_ORCHESTRA.quick.mista)
  expect(TESTI_ORCHESTRA.quick.mista).not.toContain('esecutor')
  expect(TESTI_ORCHESTRA.quick.mista).not.toContain('sciame')

  const fuori = (profilo: 'long' | 'medio', squadra: (typeof SQUADRE)[number]) => TESTI_ORCHESTRA[profilo][squadra].split('\n').filter(r => !TESTI_ORCHESTRA[profilo].claude.split('\n').includes(r)).length
  // Long: le tre righe della squadra (in mista la prima e quella di claude). Medio: una riga in piu.
  expect([fuori('long', 'mista'), fuori('long', 'esterni'), fuori('medio', 'mista'), fuori('medio', 'esterni')]).toEqual([2, 3, 1, 1])
  expect(new Set(SQUADRE.map(s => TESTI_ORCHESTRA.long[s])).size).toBe(3)
  expect(new Set(SQUADRE.map(s => TESTI_ORCHESTRA.medio[s])).size).toBe(3)
})

test('una domanda nuova vuole titolo e contesto, tiene 4 opzioni, si chiude; le aperte sono della sessione', () => {
  expect(conDomanda([], { id: 'db', stato: 'aperta', titolo: 'Quale database?' }, 'S', 10)).toBe('la domanda "db" e nuova: servono titolo e contesto')
  const aperta = conDomanda([], { id: 'db', stato: 'aperta', titolo: 'Quale database?', contesto: 'Serve per lo storico.', opzioni: ['a', 'b', 'c', 'd', 'e'], raccomandazione: 'a' }, 'S', 10)
  if (typeof aperta === 'string') throw new Error(aperta)
  expect(aperta[0]?.opzioni).toEqual(['a', 'b', 'c', 'd'])
  const altrui = conDomanda(aperta, { id: 'db', stato: 'aperta', titolo: 'Altra', contesto: 'x' }, 'T', 11)
  if (typeof altrui === 'string') throw new Error(altrui)
  expect(domandeAperte(altrui, 'S').map(d => d.titolo)).toEqual(['Quale database?'])

  const chiusa = conDomanda(altrui, { id: 'db', stato: 'risolta', risposta: 'b' }, 'S', 20)
  if (typeof chiusa === 'string') throw new Error(chiusa)
  expect(domandeAperte(chiusa, 'S')).toEqual([])
  expect(chiusa.find(d => d.sessione === 'S')).toMatchObject({ stato: 'risolta', risposta: 'b', creataMs: 10, raccomandazione: 'a' })
  expect(promptApprofondisci(domandeAperte(aperta, 'S')[0]!)).toContain('Non decidere tu')
})

test('una voce del piano aggiornata resta al suo posto e tiene descrizione e fase', () => {
  const prima = conVoce([], { id: 'a', titolo: 'A', stato: 'scaletta', descrizione: 'Che cosa e perche', fase: '1 · analisi' }, 'S', 't0')
  if (typeof prima === 'string') throw new Error(prima)
  const due = conVoce(prima, { id: 'b', titolo: 'B', stato: 'scaletta' }, 'S', 't1')
  if (typeof due === 'string') throw new Error(due)
  const dopo = conVoce(due, { id: 'a', stato: 'fatto', note: 'ok' }, 'S', 't2')
  if (typeof dopo === 'string') throw new Error(dopo)

  expect(dopo.map(v => v.id)).toEqual(['a', 'b'])
  expect(dopo[0]).toMatchObject({ stato: 'fatto', descrizione: 'Che cosa e perche', fase: '1 · analisi', note: 'ok' })
})

test('un testo lungo va a capo a parole entro la larghezza', () => {
  const righe = aCapo('una descrizione lunga che deve stare in una colonna stretta parolaccialunghissimadavvero\n\nfine', 20)

  for (const r of righe) expect(cellWidth(r)).toBeLessThanOrEqual(20)
  expect(righe).toContain('')
  expect(righe.at(-1)).toBe('fine')
})

test('/regia quick passa a sonnet e /regia medium rimette il modello di prima; la regola segue la modalita', async ($, on) => {
  const amb = ambiente(on)
  const modelli: string[] = []
  const inviati: string[] = []
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('session.model', () => ({ value: 'opus' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.run', { command: 'model' }, (_, e) => {
    modelli.push(e.args)

    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    inviati.push(e.text)

    return { text: e.text } as never
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' as const }] }))
  const regola = async () => (await $.prompt.compose(INPUT_PROMPT as never)).sections.find(s => s.id === 'regia:orchestra')?.text

  expect(await regola()).toBe(TESTI_ORCHESTRA.medio.mista)
  expect((await comando($, 'quick sistema il refuso nel README')).text).toContain('la principale passa a sonnet (prima: opus')
  await amb.clock?.advance(10)
  expect(modelli).toEqual(['sonnet'])
  expect(inviati).toEqual(['sistema il refuso nel README'])
  expect(await regola()).toBe(TESTI_ORCHESTRA.quick.mista)
  expect(amb.store.get(`regia.profilo.${SESSIONE}`)).toMatchObject({ profilo: 'quick', modelloPrima: 'opus' })

  expect((await comando($, 'medium')).text).toContain('La principale torna a opus')
  await amb.clock?.advance(10)
  expect(modelli).toEqual(['sonnet', 'opus'])
  expect(await regola()).toBe(TESTI_ORCHESTRA.medio.mista)
  await comando($, 'long')
  expect(await regola()).toBe(TESTI_ORCHESTRA.long.mista)
  expect((await comando($, '')).text).toContain('Mode long ·')
})

test('una domanda: notifica solo se la persona e via, nel pane col contesto, risposta con un tasto', async ($, on) => {
  const amb = ambiente(on)
  const notifiche: string[] = []
  const inviati: string[] = []
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', (_, e) => {
    notifiche.push(e.text)

    return { value: { isSent: true, channel: 'terminal' } as never }
  })
  on('prompt.submit', (_, e) => {
    inviati.push(e.text)

    return { text: e.text } as never
  })
  const domanda = (id: string) => $.tool.call({
    tool: 'mcp__regia__domanda_scrivi', id, stato: 'aperta', titolo: `Quale database per ${id}?`,
    contesto: 'Il modulo storico deve tenere tre anni di letture. Postgres e gia in casa; SQLite e piu semplice da distribuire ma regge male le scritture concorrenti.',
    opzioni: ['Postgres', 'SQLite'], raccomandazione: 'Postgres, perche e gia in casa',
  } as never) as Promise<{ result?: string; deny?: string }>

  expect((await domanda('uno')).result).toContain('registrata')
  expect(notifiche).toEqual([])
  await comando($, 'away')
  await domanda('due')
  expect(notifiche).toEqual(['Domanda per te: Quale database per due?'])
  await comando($, 'here')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // La lettura periodica (15 s) porta nel pane anche la domanda scritta dopo la prima lettura.
  await amb.clock?.advance(16_000)
  for (const larghezza of [40, 64, 100]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: larghezza } })
    const righe = resa(await ui.drawn(), larghezza)
    for (const riga of righe) expect(cellWidth(riga)).toBeLessThanOrEqual(larghezza)
    expect(righe.some(r => r.startsWith('── PER TE 2'))).toBe(true)

    await ui.press({ key: 'apri-domanda:uno' })
    const dettaglio = resa(await ui.drawn(), larghezza)
    for (const riga of dettaglio) expect(cellWidth(riga)).toBeLessThanOrEqual(larghezza)
    expect(dettaglio.join(' ')).toContain('Postgres e gia in casa')
    await ui.press({ key: 'indietro' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 64 } })
  await ui.press({ key: 'apri-domanda:uno' })
  await ui.press({ key: 'opzione-1' })
  expect(inviati.at(-1)).toContain('alla domanda "Quale database per uno?" (uno)]\nOpzione 2: SQLite')
  const file = JSON.parse(amb.scritti.get(`${HOME}/.claude/regia/domande.json`) ?? '{}') as { domande: { id: string; stato: string }[] }
  expect(file.domande.map(d => `${d.id}:${d.stato}`)).toEqual(['due:aperta', 'uno:risolta'])
  await ui.unmount()
})

test('il piano nel pane: aperte per fase, fatte chiuse in un gruppo, la descrizione con un clic', async ($, on) => {
  const piano = JSON.stringify({
    lavori: [
      { id: 'a', titolo: 'Analisi del dominio', stato: 'fatto', sessione: SESSIONE, fase: '1 · analisi', descrizione: 'Mappa delle entita e dei flussi.' },
      { id: 'b', titolo: 'Modulo storico', stato: 'in_corso', sessione: SESSIONE, fase: '2 · sviluppo', descrizione: 'Tabelle e API dello storico letture.' },
      { id: 'c', titolo: 'Report mensile', stato: 'scaletta', sessione: SESSIONE, fase: '2 · sviluppo' },
    ],
  })
  const amb = ambiente(on, { file: { [`${HOME}/.claude/regia/registro.json`]: piano } })
  on('session.surfaces', () => ({ value: ['terminal'] as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await amb.clock?.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 50 } })
  const righe = async () => resa(await ui.drawn(), 50)

  const chiuso = await righe()
  for (const riga of chiuso) expect(cellWidth(riga)).toBeLessThanOrEqual(50)
  expect(chiuso.some(r => r.startsWith('── PIANO 1/3'))).toBe(true)
  expect(chiuso.some(r => r.includes('Modulo storico'))).toBe(true)
  expect(chiuso.some(r => r.includes('Analisi del dominio'))).toBe(false)
  expect(chiuso.some(r => r.includes('▸ 1 fatte'))).toBe(true)
  // Le voci del piano non si ripetono nelle tabelle degli agenti.
  expect(chiuso.filter(r => r.includes('Report mensile')).length).toBe(1)

  await ui.press({ key: 'fatti-piano' })
  expect((await righe()).some(r => r.includes('Analisi del dominio'))).toBe(true)
  await ui.press({ key: 'apri-registro:b' })
  const dettaglio = await righe()
  expect(dettaglio[0]).toContain('◆ piano · Modulo storico')
  expect(dettaglio.join(' ')).toContain('Tabelle e API dello storico letture.')
  await ui.unmount()
})

test('con NONoise ogni modalita rimanda alle fasi di .nonoise/sdlc-flow.md e limita la validazione FPF', () => {
  for (const [profilo, modalita] of [['long', '`long`'], ['medio', '`medium`'], ['quick', '`quick`']] as const) {
    for (const squadra of SQUADRE) {
      const nonoise = TESTI_ORCHESTRA[profilo][squadra].split('\n').find(r => r.includes('.nonoise/sdlc-flow.md'))
      expect(nonoise).toContain(modalita)
      expect(nonoise).toContain('FPF')
    }
  }
  // In long le fasi vanno in scaletta; in quick non ce ne sono.
  expect(TESTI_ORCHESTRA.long.mista).toContain('mettile in scaletta')
  expect(TESTI_ORCHESTRA.quick.mista).toContain('nessuna fase')
})
