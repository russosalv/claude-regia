// Il pane e la posta: la sezione POSTA con gli ultimi messaggi e il campo di
// testo che si apre con `✉ scrivi` o `↻ riprendi`.

import type { Elements } from 'claude-code'

import type { RegiaMessaggio, RegiaScrittura } from '../types/index'
import { ACCENTO, cellWidth, regola, tronca } from './tavola'
import type { Tavola } from './tavola'

/** Le superfici con un campo di testo (tutte tranne mobile) lo danno qui. */
export type TavolaConCampo = Tavola & { Input?: Elements['terminal']['Input'] }

const SEGNI: Readonly<Record<RegiaMessaggio['stato'], { testo: string; colore?: string }>> = {
  nuovo: { testo: '●', colore: 'warning' },
  consegnato: { testo: '✓', colore: 'success' },
  letto: { testo: '✓', colore: 'subtle' },
  errore: { testo: '✗', colore: 'error' },
}

function ora(ms: number): string {
  const d = new Date(ms)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Una riga: `✓ 19:40 nano → prova-regia  testo…`, tagliata alla larghezza. */
function rigaMessaggio(ui: Tavola, m: RegiaMessaggio, spazio: number) {
  const { Box, Text } = ui
  const segno = SEGNI[m.stato]
  const testa = `${ora(m.ora)} ${m.da} → ${m.a} `
  const corpo = m.testo.replace(/\s+/g, ' ').trim()
  const resto = Math.max(0, spazio - 2 - cellWidth(testa))

  return (
    <Box key={`posta:${m.id}`} width={spazio}>
      <Text wrap="truncate-end">
        <Text color={segno.colore}>{`${segno.testo} `}</Text>
        <Text dimColor>{tronca(testa, spazio - 2)}</Text>
        <Text>{tronca(corpo, resto)}</Text>
      </Text>
    </Box>
  )
}

export function sezionePosta(ui: Tavola, messaggi: readonly RegiaMessaggio[], spazio: number) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" marginTop={1}>
      {regola(ui, 'POSTA', String(messaggi.length), messaggi.length > 0 ? 'ultimi 5' : '', spazio)}
      {messaggi.length === 0
        ? <Text dimColor wrap="truncate-end">{tronca('  nessun messaggio', spazio)}</Text>
        : messaggi.map(m => rigaMessaggio(ui, m, spazio))}
    </Box>
  )
}

export type TastiScrittura = { onInvia: (testo: string) => void; onAnnulla: () => void }

/** Il campo aperto da `✉ scrivi` (manda da utente) o `↻ riprendi` (riprende un Codex). */
export function campoScrittura(ui: TavolaConCampo, s: RegiaScrittura, spazio: number, tasti: TastiScrittura) {
  const { Box, Text, Button, Input } = ui
  const titolo = s.modo === 'posta' ? `✉ a ${s.etichetta}` : `↻ riprendi ${s.etichetta}`
  const spiega = s.modo === 'posta' ? 'scrivi e premi Invio: parte da utente' : 'il messaggio con cui Codex riprende la sua sessione'
  const larghezzaTitolo = Math.max(1, spazio - cellWidth('[ ✕ annulla ]') - 1)

  return (
    <Box flexDirection="column" width={spazio} marginTop={1} borderStyle="round" borderColor={ACCENTO} paddingX={1}>
      <Box flexDirection="row">
        <Box width={Math.max(1, larghezzaTitolo - 4)} flexShrink={0}>
          <Text bold color={ACCENTO} wrap="truncate-end">{tronca(titolo, larghezzaTitolo - 4)}</Text>
        </Box>
        <Button key="annulla-scrittura" onPress={tasti.onAnnulla}>✕ annulla</Button>
      </Box>
      {Input === undefined
        ? <Text dimColor wrap="truncate-end">{tronca('qui non si scrive: usa il terminale o il desktop', spazio - 4)}</Text>
        : <Input key="testo-scrittura" placeholder={spiega} submitLabel="invia" autoFocus onSubmit={testo => tasti.onInvia(testo)} />}
    </Box>
  )
}
