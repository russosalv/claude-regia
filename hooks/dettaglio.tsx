// Vista di dettaglio dentro il pane: le ultime righe del `.log` di un lavoro
// Codex, con i tasti per tornare al cruscotto e per rileggerle.

import type { RegiaDettaglio } from '../types/index'
import { ACCENTO, cellWidth, regola, tronca } from './tavola'
import type { Tavola } from './tavola'

export const RIGHE_LOG = 30

/** Le ultime `RIGHE_LOG` righe non vuote di un testo, senza ritorni a capo Windows. */
export function codaLog(testo: string): string[] {
  // Via colori ANSI, tabulazioni e altri caratteri di controllo: una riga
  // deve occupare esattamente le celle che conta.
  const pulito = testo
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
  const righe = pulito.split('\n')
  while (righe.length > 0 && righe[righe.length - 1]?.trim() === '') righe.pop()

  return righe.slice(-RIGHE_LOG)
}

function dueCifre(n: number): string {
  return String(n).padStart(2, '0')
}

function ora(ms: number): string {
  const d = new Date(ms)

  return `${dueCifre(d.getHours())}:${dueCifre(d.getMinutes())}:${dueCifre(d.getSeconds())}`
}

export type TastiDettaglio = { onChiudi: () => void; onRileggi: () => void }

export function vistaDettaglio(ui: Tavola, d: RegiaDettaglio, spazio: number, tasti: TastiDettaglio) {
  const { Box, Text, Button } = ui
  const tastiLarghi = cellWidth('[ ← indietro ]') + 1 + cellWidth('[ ↻ ]')
  const titolo = Math.max(1, spazio - tastiLarghi - 2)

  return (
    <Box flexDirection="column" width={spazio}>
      <Box flexDirection="row" width={spazio}>
        <Box width={titolo} flexShrink={0}>
          <Text bold color={ACCENTO} wrap="truncate-end">{tronca(`◆ log · ${d.nome}`, titolo)}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Button key="indietro" variant="primary" onPress={tasti.onChiudi}>← indietro</Button>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Button key="rileggi" onPress={tasti.onRileggi}>↻</Button>
        </Box>
      </Box>
      <Text dimColor wrap="truncate-end">{tronca(`${d.percorso} · letto ${ora(d.lettoMs)}`, spazio)}</Text>
      <Box marginTop={1}>{regola(ui, 'ULTIME RIGHE', String(d.righe.length), '', spazio)}</Box>
      {d.errore !== undefined && <Text color="warning" wrap="truncate-end">{tronca(`⚠ ${d.errore}`, spazio)}</Text>}
      {d.errore === undefined && d.righe.length === 0 && <Text dimColor>  log vuoto</Text>}
      {d.righe.map(r => <Text wrap="truncate-end">{tronca(r === '' ? ' ' : r, spazio)}</Text>)}
    </Box>
  )
}
