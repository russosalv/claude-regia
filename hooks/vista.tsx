import type { RegiaDettaglio, RegiaRiga, RegiaScrittura, RegiaSnapshot, RegiaVista, RegiaVistaDati } from '../types/index'
import { campoScrittura, sezionePosta } from './vista-posta'
import type { TastiScrittura, TavolaConCampo } from './vista-posta'
import { MASSIMO_FATTI } from './model'
import { colonnePane, conTitoloUltima, rigaTabella } from './layout'
import type { Azioni, Momento } from './layout'
import { vistaDettaglio } from './dettaglio'
import {
  ACCENTO,
  CELLE_RIQUADRO,
  cellWidth,
  pillole,
  regola,
  riquadro,
  tabella,
  tronca,
} from './tavola'
import type { Colonna, Pezzo, Tavola } from './tavola'

export type { Tavola } from './tavola'

const LARGHEZZA_MINIMA = 24

export type OpzioniVista = {
  vista: RegiaVista
  /** `bodyColumns` del pane. */
  colonne: number
  /** Ora corrente: muove durate vive e spinner. */
  oraMs: number
  /** Chiamata dal tasto di cambio vista. */
  onCambiaVista: () => void
  /** Tasti di riga (apri un subagente, log di un Codex). */
  azioni?: Azioni
  /** Il subagente la cui conversazione e ora in vista, se c'e. */
  agenteInVista?: string
  onTornaPrincipale?: () => void
  /** Il log aperto nel pane; `nome` vuoto se nessuno. */
  dettaglio?: RegiaDettaglio
  onChiudiDettaglio?: () => void
  onRileggiDettaglio?: () => void
  /** Il campo di testo aperto da `✉ scrivi` o `↻ riprendi`; `a` vuoto se chiuso. */
  scrittura?: RegiaScrittura
  tastiScrittura?: TastiScrittura
}

function dueCifre(n: number): string {
  return String(n).padStart(2, '0')
}

export function oraLocale(ms: number): string {
  const d = new Date(ms)

  return `${dueCifre(d.getHours())}:${dueCifre(d.getMinutes())}:${dueCifre(d.getSeconds())}`
}

const NOMI_VISTA: Readonly<Record<RegiaVista, string>> = {
  sessione: 'questa sessione',
  tutti: 'tutta la macchina',
}

/** Le pillole dell'intestazione, lunghe se ci stanno, altrimenti solo i numeri. */
export function pilloleConteggi(gruppi: RegiaVistaDati, spazio: number): Pezzo[] {
  const fatti = gruppi.fatti.length + gruppi.fattiExtra
  const falliti = gruppi.fatti.filter(r => r.stato === 'fallito').length
  const bloccati = gruppi.scaletta.filter(r => r.stato === 'bloccato').length
  const voci = (isLunga: boolean): Pezzo[] => [
    { testo: `● ${gruppi.inCorso.length}${isLunga ? ' in corso' : ''}`, colore: gruppi.inCorso.length > 0 ? ACCENTO : undefined, isAttenuato: gruppi.inCorso.length === 0, isGrassetto: true },
    { testo: `○ ${gruppi.scaletta.length}${isLunga ? ' in scaletta' : ''}`, isAttenuato: gruppi.scaletta.length === 0 },
    ...(bloccati > 0 ? [{ testo: `⊘ ${bloccati}${isLunga ? ' bloccati' : ''}`, colore: 'warning' }] : []),
    { testo: `✓ ${fatti}${isLunga ? ' fatti' : ''}`, colore: fatti > 0 ? 'success' : undefined, isAttenuato: fatti === 0 },
    ...(falliti > 0 ? [{ testo: `✗ ${falliti}${isLunga ? ' falliti' : ''}`, colore: 'error' }] : []),
  ]
  const lunghe = voci(true)
  const totale = lunghe.reduce((s, p) => s + cellWidth(p.testo), 0) + 3 * (lunghe.length - 1)

  return totale <= spazio ? lunghe : voci(false)
}

function intestazione(ui: Tavola, gruppi: RegiaVistaDati, opzioni: OpzioniVista, spazio: number) {
  const { Box, Text, Button } = ui
  const interno = spazio - CELLE_RIQUADRO
  const etichetta = opzioni.vista === 'tutti' ? '⇄ sessione' : '⇄ tutti'
  // Il tasto si disegna `[ etichetta ]`: il titolo prende solo quel che resta.
  const titolo = Math.max(1, interno - cellWidth(etichetta) - 4 - 1)

  return riquadro(
    ui,
    spazio,
    [
      <Box flexDirection="row" width={interno}>
        <Box width={titolo} flexShrink={0}>
          <Text bold color={ACCENTO} wrap="truncate-end">{tronca('◆ Regia agenti', titolo)}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Button key="vista" variant="primary" onPress={opzioni.onCambiaVista}>
            {etichetta}
          </Button>
        </Box>
      </Box>,
      <Box width={interno}>
        <Text wrap="truncate-end">
          <Text dimColor>vista </Text>
          <Text bold>{NOMI_VISTA[opzioni.vista]}</Text>
        </Text>
      </Box>,
      pillole(ui, pilloleConteggi(gruppi, interno), interno),
    ],
    ACCENTO,
  )
}

type Sezione = { titolo: string; ultima: string; vuoto: string; righe: readonly RegiaRiga[]; nota: string }

function sezione(ui: Tavola, s: Sezione, colonne: readonly Colonna[], momento: Momento, spazio: number, azioni?: Azioni) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" marginTop={1}>
      {regola(ui, s.titolo, String(s.righe.length), s.nota, spazio)}
      {s.righe.length === 0
        ? <Text dimColor wrap="truncate-end">{tronca(`  ${s.vuoto}`, spazio)}</Text>
        : tabella(ui, conTitoloUltima(colonne, s.ultima), s.righe.map(r => rigaTabella(r, momento, azioni)))}
    </Box>
  )
}

function statoVuoto(ui: Tavola, vista: RegiaVista, spazio: number) {
  const { Box, Text } = ui
  const interno = spazio - CELLE_RIQUADRO
  const righe = vista === 'sessione'
    ? ['Nessun agente al lavoro in questa sessione', '/regia tutti per vedere la macchina']
    : ['Nessun agente al lavoro sulla macchina', 'né lavori in scaletta o conclusi']

  return (
    <Box marginTop={1}>
      {riquadro(ui, spazio, righe.map(r => (
        <Text dimColor wrap="truncate-end">{tronca(r, interno)}</Text>
      )))}
    </Box>
  )
}

function piede(ui: Tavola, dati: RegiaSnapshot, spazio: number) {
  const { Box, Text } = ui
  const agg = `aggiornato ${oraLocale(dati.aggiornatoMs)}`

  return (
    <Box flexDirection="column" marginTop={1}>
      {dati.avvisi.length > 0 && (
        <Box width={spazio}>
          <Text wrap="truncate-end">
            <Text color="warning">⚠ </Text>
            <Text dimColor>{tronca(dati.avvisi.join(' · '), spazio - 2)}</Text>
          </Text>
        </Box>
      )}
      <Text dimColor wrap="truncate-end">{tronca(agg, spazio)}</Text>
    </Box>
  )
}

/** Mentre a sinistra c'e la conversazione di un subagente: il tasto per tornare. */
function ritorno(ui: Tavola, spazio: number, onPress: (() => void) | undefined) {
  const { Box, Text, Button } = ui

  return (
    <Box flexDirection="row" width={spazio}>
      <Button key="principale" variant="primary" onPress={onPress ?? (() => undefined)}>
        ← principale
      </Button>
      <Text dimColor wrap="truncate-end">{tronca(' stai guardando un subagente', Math.max(0, spazio - 18))}</Text>
    </Box>
  )
}

export function vistaRegia(dati: RegiaSnapshot, ui: TavolaConCampo, opzioni: OpzioniVista) {
  const { Box, Text } = ui
  const spazio = Math.max(LARGHEZZA_MINIMA, opzioni.colonne)

  if (dati.aggiornatoMs === 0) {
    return <Text dimColor>{`${tronca('◆ Regia agenti · lettura in corso…', spazio)}`}</Text>
  }
  if (opzioni.dettaglio !== undefined && opzioni.dettaglio.nome !== '') {
    return vistaDettaglio(ui, opzioni.dettaglio, spazio, {
      onChiudi: opzioni.onChiudiDettaglio ?? (() => undefined),
      onRileggi: opzioni.onRileggiDettaglio ?? (() => undefined),
    })
  }
  const gruppi = dati.viste[opzioni.vista]
  const momento: Momento = {
    fotogramma: Math.floor(opzioni.oraMs / 1000),
    trascorsiSec: Math.max(0, (opzioni.oraMs - dati.aggiornatoMs) / 1000),
  }
  const tutte = [...gruppi.inCorso, ...gruppi.scaletta, ...gruppi.fatti]
  const colonne = colonnePane(tutte.map(r => rigaTabella(r, momento, opzioni.azioni)), spazio)
  const extra = gruppi.fattiExtra > 0 ? ` (+${gruppi.fattiExtra})` : ''
  const altriDaFare = gruppi.scalettaExtra > 0 ? `+${gruppi.scalettaExtra} non mostrati` : ''
  const sezioni: Sezione[] = [
    { titolo: 'IN CORSO', ultima: 'Dove', vuoto: 'nulla in esecuzione', righe: gruppi.inCorso, nota: '' },
    { titolo: 'IN SCALETTA', ultima: 'Dove', vuoto: 'scaletta vuota', righe: gruppi.scaletta, nota: altriDaFare },
    { titolo: 'FATTI', ultima: 'Esito', vuoto: 'ancora nessuno', righe: gruppi.fatti, nota: `ultimi ${MASSIMO_FATTI}${extra}` },
  ]

  const posta = dati.posta[opzioni.vista]
  const { scrittura, tastiScrittura } = opzioni

  return (
    <Box flexDirection="column" width={spazio}>
      {opzioni.agenteInVista !== undefined && ritorno(ui, spazio, opzioni.onTornaPrincipale)}
      {intestazione(ui, gruppi, opzioni, spazio)}
      {scrittura !== undefined && scrittura.a !== '' && tastiScrittura !== undefined && campoScrittura(ui, scrittura, spazio, tastiScrittura)}
      {tutte.length === 0
        ? statoVuoto(ui, opzioni.vista, spazio)
        : sezioni.map(s => sezione(ui, s, colonne, momento, spazio, opzioni.azioni))}
      {(tutte.length > 0 || posta.length > 0) && sezionePosta(ui, posta, spazio)}
      {piede(ui, dati, spazio)}
    </Box>
  )
}
