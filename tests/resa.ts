// Resa testuale approssimata di un albero disegnato (`ui.drawn()`), per i test
// di layout: Box in riga o colonna, larghezze fisse, bordo arrotondato,
// paddingX, marginTop, justifyContent. Un Box più largo dello spazio che ha
// sfora davvero: la riga risulta più lunga e il test lo vede.

import { cellWidth, tronca } from '../hooks/tavola'

type Nodo = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const spazi = (n: number) => ' '.repeat(Math.max(0, n))
const allarga = (riga: string, w: number) => riga + spazi(w - cellWidth(riga))

function testoDi(nodo: unknown): string {
  if (typeof nodo === 'string') return nodo
  const n = nodo as Nodo
  if (n.type === 'Button') {
    const etichetta = typeof n.props?.label === 'string' ? n.props.label : (n.children ?? []).map(testoDi).join('')

    return n.props?.plain === true ? etichetta : `[ ${etichetta} ]`
  }

  return (n.children ?? []).map(testoDi).join('')
}

function numero(v: unknown, predefinito: number): number {
  return typeof v === 'number' ? v : predefinito
}

function riga(figli: Nodo[], w: number, giustifica: unknown): string[] {
  const blocchi: string[][] = []
  let resto = w
  for (const f of figli) {
    const b = disegna(f, resto)
    blocchi.push(b)
    resto -= Math.max(0, ...b.map(cellWidth))
  }
  const larghezze = blocchi.map(b => Math.max(0, ...b.map(cellWidth)))
  const usato = larghezze.reduce((s, x) => s + x, 0)
  const libero = Math.max(0, w - usato)
  const altezza = Math.max(0, ...blocchi.map(b => b.length))
  const fuori: string[] = []
  for (let y = 0; y < altezza; y++) {
    const pezzi = blocchi.map((b, i) => allarga(b[y] ?? '', larghezze[i] ?? 0))
    if (giustifica === 'space-between' && pezzi.length > 1) {
      fuori.push(pezzi.slice(0, -1).join('') + spazi(libero) + pezzi.at(-1))
    } else if (giustifica === 'flex-end') {
      fuori.push(spazi(libero) + pezzi.join(''))
    } else {
      fuori.push(pezzi.join(''))
    }
  }

  return fuori
}

/** Le righe di `nodo` disegnato in `spazio` celle, senza spazi in coda. */
export function disegna(nodo: unknown, spazio: number): string[] {
  const n = nodo as Nodo
  if (typeof nodo === 'string' || n.type === 'Text' || n.type === 'Button') {
    const t = testoDi(nodo)

    return [n.props?.wrap === 'truncate-end' ? tronca(t, spazio) : t]
  }
  const p = n.props ?? {}
  const w = numero(p.width, spazio)
  const bordo = p.borderStyle === 'round' ? 1 : 0
  const pad = numero(p.paddingX, 0)
  const sinistra = numero(p.marginLeft, 0)
  const interno = w - 2 * bordo - 2 * pad
  const figli = (n.children ?? []).filter(f => f !== null && f !== undefined && f !== false) as Nodo[]
  let corpo = p.flexDirection === 'column'
    ? figli.flatMap(f => disegna(f, interno))
    : riga(figli, interno, p.justifyContent)
  if (typeof p.width === 'number' && bordo === 0) corpo = corpo.map(r => allarga(r, interno))
  if (pad > 0) corpo = corpo.map(r => spazi(pad) + allarga(r, interno) + spazi(pad))
  if (bordo > 0) {
    corpo = [
      `╭${'─'.repeat(w - 2)}╮`,
      ...corpo.map(r => `│${allarga(r, w - 2)}│`),
      `╰${'─'.repeat(w - 2)}╯`,
    ]
  }

  if (sinistra > 0) corpo = corpo.map(r => spazi(sinistra) + r)

  return [...Array.from({ length: numero(p.marginTop, 0) }, () => ''), ...corpo]
}

export function resa(albero: unknown, spazio: number): string[] {
  return disegna(albero, spazio).map(r => r.trimEnd())
}
