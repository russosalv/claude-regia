// Vista di dettaglio dentro il pane: le ultime righe del `.log` di un lavoro
// Codex (con i tasti per tornare al cruscotto e per rileggerle), la
// descrizione di una voce del piano, o una domanda con i tasti per rispondere.

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

/** Un testo spezzato a parole in righe larghe al massimo `larghezza` celle (una parola troppo lunga si taglia). */
export function aCapo(testo: string, larghezza: number): string[] {
  const massimo = Math.max(1, larghezza)
  const righe: string[] = []
  for (const paragrafo of testo.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
    let riga = ''
    for (const parola of paragrafo.split(/ +/).filter(p => p !== '')) {
      const prova = riga === '' ? parola : `${riga} ${parola}`
      if (cellWidth(prova) <= massimo) {
        riga = prova
      } else {
        if (riga !== '') righe.push(riga)
        riga = tronca(parola, massimo)
      }
    }
    righe.push(riga)
  }

  return righe
}

/** I tasti di una domanda aperta nel dettaglio. */
export type TastiDomanda = {
  onOpzione: (indice: number) => void
  onRispondi: () => void
  onApprofondisci: () => void
  onDecidiTu: () => void
}

export type TastiDettaglio = { onChiudi: () => void; onRileggi: () => void; domanda?: TastiDomanda }

const PREFISSI: Readonly<Record<NonNullable<RegiaDettaglio['tipo']>, string>> = { log: 'log', voce: 'piano', domanda: 'domanda' }

/** Le righe di una voce del piano o di una domanda, gia spezzate alla larghezza. */
function corpoTesto(ui: Tavola, d: RegiaDettaglio, spazio: number, tasti: TastiDettaglio) {
  const { Box, Text, Button } = ui
  const domanda = d.tipo === 'domanda' ? d.domanda : undefined
  const testo = d.righe.flatMap(r => aCapo(r, spazio))

  return (
    <Box flexDirection="column" width={spazio} marginTop={1}>
      {testo.map(r => <Text wrap="truncate-end">{r === '' ? ' ' : r}</Text>)}
      {domanda !== undefined && tasti.domanda !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          {domanda.opzioni.length > 0 && regola(ui, 'RISPONDI', String(domanda.opzioni.length), '', spazio)}
          {domanda.opzioni.map((o, i) => (
            <Box key={`opzione:${i}`} width={spazio}>
              <Button key={`opzione-${i}`} variant={i === 0 ? 'primary' : undefined} onPress={() => tasti.domanda?.onOpzione(i)}>
                {tronca(`${i + 1}. ${o}`, Math.max(1, spazio - 4))}
              </Button>
            </Box>
          ))}
          <Box width={spazio} marginTop={1}><Button key="rispondi" onPress={tasti.domanda.onRispondi}>{tronca('✎ rispondi a parole', Math.max(1, spazio - 4))}</Button></Box>
          <Box width={spazio}><Button key="approfondisci" onPress={tasti.domanda.onApprofondisci}>{tronca('◎ approfondisci con un agente', Math.max(1, spazio - 4))}</Button></Box>
          <Box width={spazio}><Button key="decidi" onPress={tasti.domanda.onDecidiTu}>{tronca('→ decida la principale', Math.max(1, spazio - 4))}</Button></Box>
        </Box>
      )}
    </Box>
  )
}

export function vistaDettaglio(ui: Tavola, d: RegiaDettaglio, spazio: number, tasti: TastiDettaglio) {
  const { Box, Text, Button } = ui
  const isLog = d.tipo === undefined || d.tipo === 'log'
  const tastiLarghi = cellWidth('[ ← indietro ]') + (isLog ? 1 + cellWidth('[ ↻ ]') : 0)
  const titolo = Math.max(1, spazio - tastiLarghi - 2)
  const prefisso = PREFISSI[d.tipo ?? 'log']

  return (
    <Box flexDirection="column" width={spazio}>
      <Box flexDirection="row" width={spazio}>
        <Box width={titolo} flexShrink={0}>
          <Text bold color={ACCENTO} wrap="truncate-end">{tronca(`◆ ${prefisso} · ${d.nome}`, titolo)}</Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Button key="indietro" variant="primary" onPress={tasti.onChiudi}>← indietro</Button>
        </Box>
        {isLog && (
          <Box flexShrink={0} marginLeft={1}>
            <Button key="rileggi" onPress={tasti.onRileggi}>↻</Button>
          </Box>
        )}
      </Box>
      {isLog
        ? <Text dimColor wrap="truncate-end">{tronca(`${d.percorso} · letto ${ora(d.lettoMs)}`, spazio)}</Text>
        : d.percorso !== '' && <Text dimColor wrap="truncate-end">{tronca(d.percorso, spazio)}</Text>}
      {!isLog && corpoTesto(ui, d, spazio, tasti)}
      {isLog && <Box marginTop={1}>{regola(ui, 'ULTIME RIGHE', String(d.righe.length), '', spazio)}</Box>}
      {isLog && d.errore !== undefined && <Text color="warning" wrap="truncate-end">{tronca(`⚠ ${d.errore}`, spazio)}</Text>}
      {isLog && d.errore === undefined && d.righe.length === 0 && <Text dimColor>  log vuoto</Text>}
      {isLog && d.righe.map(r => <Text wrap="truncate-end">{tronca(r === '' ? ' ' : r, spazio)}</Text>)}
    </Box>
  )
}
