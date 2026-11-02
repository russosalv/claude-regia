// Mattoni di disegno del pane: tabella a colonne con priorità, regola di
// sezione, riquadro arrotondato, pillole. Tecniche di layout riprese da
// cc-vitals di naicud (MIT, https://github.com/naicud/cc-vitals): `cellWidth`,
// `fitColumns`, la tabella con `│` e la regola `─┼─`, la regola di sezione
// `── TITOLO ────`, le tacche ▰▱ e lo spinner braille.

import type { Elements, RenderChildren } from 'claude-code'

/** Gli elementi che il pane usa, uguali su ogni superficie in cui ha un Button. */
export type Tavola = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export const ACCENTO = 'claude'
export const SEPARATORE = ' │ '

/** Un pezzo colorato di una cella: una cella ne ha uno o più, in fila. */
export type Pezzo = { testo: string; colore?: string; isAttenuato?: boolean; isGrassetto?: boolean }
export type Cella = readonly Pezzo[]

/**
 * Una colonna: `larghezza` in celle (la minima, per quella che `cresce`),
 * `priorita` l'ordine in cui le colonne cedono quando manca spazio (prima la
 * più bassa; senza priorità non cede mai).
 */
export type Colonna = {
  id: string
  titolo: string
  larghezza: number
  isADestra?: boolean
  cresce?: boolean
  priorita?: number
}

// Simboli che il terminale disegna larghi due celle pur stando sotto i piani emoji.
const LARGHI = new Set([0x23f3, 0x231b, 0x26a1, 0x26fd, 0x2705, 0x274c, 0x2b50])

/** Celle occupate nel terminale: le emoji contano due, giuntori e selettori zero. */
export function cellWidth(testo: string): number {
  let larghezza = 0
  for (const ch of testo) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0x200d) continue
    larghezza += cp >= 0x1f000 || LARGHI.has(cp) ? 2 : 1
  }

  return larghezza
}

export function larghezzaTabella(colonne: readonly Colonna[]): number {
  const somma = colonne.reduce((s, c) => s + c.larghezza, 0)

  return somma + SEPARATORE.length * Math.max(0, colonne.length - 1)
}

/** Toglie le colonne a priorità più bassa finché la tabella sta in `spazio`. */
export function fitColumns(colonne: readonly Colonna[], spazio: number): Colonna[] {
  let tenute = [...colonne]
  while (larghezzaTabella(tenute) > spazio) {
    const cedibili = tenute.filter(c => c.priorita !== undefined)
    if (cedibili.length === 0) break
    const minima = cedibili.reduce((a, b) => ((a.priorita ?? 0) <= (b.priorita ?? 0) ? a : b))
    tenute = tenute.filter(c => c !== minima)
  }
  const avanzo = Math.max(0, spazio - larghezzaTabella(tenute))

  return tenute.map(c => (c.cresce === true ? { ...c, larghezza: c.larghezza + avanzo } : c))
}

/** Taglia `testo` a `massimo` celle, con `…` in fondo se serve. */
export function tronca(testo: string, massimo: number): string {
  if (massimo <= 0) return ''
  if (cellWidth(testo) <= massimo) return testo
  let fuori = ''
  for (const ch of testo) {
    if (cellWidth(fuori + ch) > massimo - 1) break
    fuori += ch
  }

  return `${fuori}…`
}

/** I pezzi di una cella tagliati insieme a `larghezza` celle. */
export function taglia(cella: Cella, larghezza: number): Pezzo[] {
  const totale = cella.reduce((s, p) => s + cellWidth(p.testo), 0)
  if (totale <= larghezza) return [...cella]
  const fuori: Pezzo[] = []
  let resta = larghezza
  for (const p of cella) {
    const w = cellWidth(p.testo)
    if (w < resta) {
      fuori.push(p)
      resta -= w
      continue
    }
    fuori.push({ ...p, testo: tronca(p.testo, resta) })
    break
  }

  return fuori
}

function pezzi(ui: Tavola, lista: readonly Pezzo[]) {
  const { Text } = ui

  return lista.map(p => (
    <Text color={p.colore} dimColor={p.isAttenuato} bold={p.isGrassetto}>
      {p.testo}
    </Text>
  ))
}

/** Un tasto di riga: `▸ apri`, `▸ log`. */
export type Azione = { chiave: string; etichetta: string; onPress: () => void }

function cellaBox(ui: Tavola, colonna: Colonna, cella: Cella, azione?: Azione) {
  const { Box, Text, Button } = ui
  // La cella del Lavoro usata come tasto si annuncia con la stessa freccia.
  const segnata: Cella = azione !== undefined && colonna.id === 'lavoro' ? [{ testo: '▸ ', colore: ACCENTO }, ...cella] : cella
  const contenuto = pezzi(ui, taglia(segnata, colonna.larghezza))

  return (
    <Box width={colonna.larghezza} flexShrink={0} justifyContent={colonna.isADestra === true ? 'flex-end' : 'flex-start'}>
      {azione === undefined
        ? <Text wrap="truncate-end">{contenuto}</Text>
        : <Button key={azione.chiave} plain onPress={azione.onPress}>{contenuto}</Button>}
    </Box>
  )
}

/**
 * Dove va il tasto di una riga: nella colonna `azione` se c'e, altrimenti
 * (pane stretto) e la cella del Lavoro a diventare cliccabile.
 */
function azioneDi(colonne: readonly Colonna[], colonna: Colonna, azione: Azione | undefined) {
  if (azione === undefined) return undefined
  const conColonna = colonne.some(c => c.id === 'azione')
  if (colonna.id === 'azione') return azione
  if (colonna.id === 'lavoro' && !conColonna) return azione

  return undefined
}

/** La colonna dei tasti: il tasto principale e gli altri (`✉ scrivi`, `↻ riprendi`) in fila. */
function cellaTasti(ui: Tavola, colonna: Colonna, tasti: readonly Azione[]) {
  const { Box, Text, Button } = ui

  return (
    <Box width={colonna.larghezza} flexShrink={0} flexDirection="row">
      {tasti.map((t, i) => (
        <Box flexDirection="row" flexShrink={0}>
          {i > 0 && <Text> </Text>}
          <Button key={t.chiave} plain onPress={t.onPress}><Text color={ACCENTO}>{t.etichetta}</Text></Button>
        </Box>
      ))}
    </Box>
  )
}

function rigaTabella(ui: Tavola, colonne: readonly Colonna[], celle: (c: Colonna) => Cella, chiave?: string, r?: RigaTabella) {
  const { Box, Text } = ui
  const tasti = r === undefined ? [] : [...(r.azione === undefined ? [] : [r.azione]), ...(r.altre ?? [])]

  return (
    <Box key={chiave} flexDirection="row">
      {colonne.map((c, i) => (
        <Box flexDirection="row">
          {i > 0 && <Text dimColor>{SEPARATORE}</Text>}
          {c.id === 'azione' && tasti.length > 0
            ? cellaTasti(ui, c, tasti)
            : cellaBox(ui, c, celle(c), azioneDi(colonne, c, r?.azione))}
        </Box>
      ))}
    </Box>
  )
}

/**
 * Una riga: `azione` e il tasto principale (a pane stretto lo diventa il
 * nome del lavoro), `altre` i tasti che stanno solo nella colonna dei tasti.
 */
export type RigaTabella = { chiave: string; celle: Readonly<Record<string, Cella>>; azione?: Azione; altre?: readonly Azione[] }

/**
 * Una tabella con intestazione in grassetto, una regola `─┼─` e una riga per
 * voce; ogni cella tagliata alla sua colonna. Le colonne arrivano già adattate.
 */
export function tabella(ui: Tavola, colonne: readonly Colonna[], righe: readonly RigaTabella[]) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column">
      {rigaTabella(ui, colonne, c => [{ testo: c.titolo, isGrassetto: true, isAttenuato: true }])}
      <Box flexDirection="row">
        {colonne.map((c, i) => (
          <Box flexDirection="row">
            {i > 0 && <Text dimColor>{'─┼─'}</Text>}
            <Box width={c.larghezza} flexShrink={0}>
              <Text dimColor wrap="truncate-end">{'─'.repeat(c.larghezza)}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      {righe.map(r => rigaTabella(ui, colonne, c => r.celle[c.id] ?? [], `riga:${r.chiave}`, r))}
    </Box>
  )
}

/** Regola di sezione larga `spazio`: `── IN CORSO 3 ───────────── nota ──`. */
export function regola(ui: Tavola, titolo: string, conteggio: string, nota: string, spazio: number) {
  const { Box, Text } = ui
  const coda = nota === '' ? '──' : ` ${nota} ──`
  const testa = `── ${titolo} ${conteggio} `
  const riempi = Math.max(2, spazio - cellWidth(testa) - cellWidth(coda))
  const resto = cellWidth(testa) + riempi + cellWidth(coda) > spazio ? ' ──' : ` ${'─'.repeat(riempi)}${coda}`

  return (
    <Box flexDirection="row" width={spazio} flexShrink={0}>
      <Text wrap="truncate-end">
        <Text dimColor>{'── '}</Text>
        <Text bold color={ACCENTO}>{titolo}</Text>
        <Text bold>{` ${conteggio}`}</Text>
        <Text dimColor>{resto}</Text>
      </Text>
    </Box>
  )
}

/** Celle che un riquadro toglie al suo corpo: bordo e un margine per lato. */
export const CELLE_RIQUADRO = 4

/** Un riquadro arrotondato largo `spazio`, il corpo disposto in `spazio - 4`. */
export function riquadro(ui: Tavola, spazio: number, corpo: RenderChildren, coloreBordo = 'subtle') {
  const { Box } = ui

  return (
    <Box flexDirection="column" width={spazio} flexShrink={0} borderStyle="round" borderColor={coloreBordo} paddingX={1}>
      {corpo}
    </Box>
  )
}

/** Pillole separate da `·` attenuati, su una riga sola tagliata a `spazio`. */
export function pillole(ui: Tavola, lista: readonly Pezzo[], spazio: number) {
  const { Box, Text } = ui
  const conPunti = lista.flatMap((p, i): Pezzo[] => (i === 0 ? [p] : [{ testo: ' · ', isAttenuato: true }, p]))

  return (
    <Box width={spazio} flexShrink={0}>
      <Text wrap="truncate-end">{pezzi(ui, taglia(conPunti, spazio))}</Text>
    </Box>
  )
}

const LIVELLI_SFORZO = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const COLORI_SFORZO: Readonly<Record<string, string>> = {
  minimal: 'subtle',
  low: 'success',
  medium: 'suggestion',
  high: ACCENTO,
  xhigh: 'warning',
  max: 'error',
}

/** Lo sforzo come tre tacche: low `▰▱▱`, medium `▰▰▱`, high e oltre `▰▰▰`. */
export function tacche(livello: string): Pezzo | undefined {
  const i = LIVELLI_SFORZO.indexOf(livello)
  if (i < 0) return undefined
  const piene = Math.min(3, Math.max(0, i))

  return { testo: '▰'.repeat(piene) + '▱'.repeat(3 - piene), colore: COLORI_SFORZO[livello] }
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function spinner(fotogramma: number): string {
  return SPINNER[((fotogramma % SPINNER.length) + SPINNER.length) % SPINNER.length] ?? '●'
}

/** Indicatore di attività senza fine nota: un tratto che scorre su `celle` celle. */
export function scorrimento(fotogramma: number, celle: number): Pezzo[] {
  const giro = Math.max(1, (celle - 1) * 2)
  const passo = ((fotogramma % giro) + giro) % giro
  const pos = passo < celle ? passo : giro - passo

  return [
    { testo: '▱'.repeat(pos), isAttenuato: true },
    { testo: '▰', colore: ACCENTO },
    { testo: '▱'.repeat(Math.max(0, celle - pos - 1)), isAttenuato: true },
  ].filter(p => p.testo !== '')
}
