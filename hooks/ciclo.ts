// Il ciclo di vita delle letture: config, timer e prima lettura. Lo stato qui
// sotto vive solo finche vive il modulo; un ricaricamento a caldo riparte da
// zero e `avvia` lo ricostruisce alla prima occasione.

import type { EngineInterface, Timer } from 'claude-code'

import { aggiornaSicuro } from './aggiorna'
import type { ContestoLettura } from './aggiorna'
import { leggiConfig, leggiHome, potaMemorie } from './fonti'
import { configPredefinita } from './registro'

type Ciclo = {
  isAvviato: boolean
  /** La lettura in corso, se ce n'e una. */
  lettura?: Promise<void>
  timer?: Timer
  contesto?: ContestoLettura
}

const ciclo: Ciclo = { isAvviato: false }

/** Una lettura alla volta: se una e gia in corso, si aspetta quella. */
export async function leggiOra($: EngineInterface): Promise<void> {
  const contesto = ciclo.contesto
  if (contesto === undefined) return
  if (ciclo.lettura !== undefined) return ciclo.lettura
  ciclo.lettura = aggiornaSicuro($, contesto).finally(() => {
    ciclo.lettura = undefined
  })

  return ciclo.lettura
}

/** Idempotente: legge la config, avvia il timer, fa la prima lettura. */
export async function avvia($: EngineInterface): Promise<void> {
  if (ciclo.isAvviato) return
  ciclo.isAvviato = true
  const home = await leggiHome($)
  const config =
    home === undefined
      ? { dati: configPredefinita(''), avvisi: [] }
      : await leggiConfig($, home)
  const nuovo: ContestoLettura = { home, config: config.dati, avvisiFissi: config.avvisi }
  ciclo.contesto = nuovo
  ciclo.timer = $.clock.every(config.dati.aggiornamentoSecondi * 1000, () => {
    void leggiOra($)
  })
  const potatura = await potaMemorie($, await $.clock.now())
  ciclo.contesto = { ...nuovo, avvisiFissi: [...nuovo.avvisiFissi, ...potatura] }
  await leggiOra($)
}

export function ferma(): void {
  ciclo.timer?.cancel()
  ciclo.timer = undefined
  ciclo.isAvviato = false
}
