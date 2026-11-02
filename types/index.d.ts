// Contratto di $.state della mod `regia`: l'unico stato condiviso tra le
// letture periodiche (che scrivono) e il pane (che legge).

/** `registro`: la scaletta, e i compiti di uno sciame in attesa. */
export type RegiaFonte = 'claude' | 'codex' | 'registro'

export type RegiaStato =
  | 'in_corso'
  | 'scaletta'
  | 'bloccato'
  | 'fatto'
  | 'fallito'
  | 'interrotto'

/** Una riga del cruscotto, gia pronta per essere disegnata. */
export type RegiaRiga = {
  chiave: string
  nome: string
  fonte: RegiaFonte
  /** `claude:<tipo>`, `codex` oppure quello scritto nel registro. */
  esecutore: string
  stato: RegiaStato
  modello?: string
  effort?: string
  durataSec?: number
  /** Cartella o worktree, gia accorciata per la visualizzazione. */
  cartella?: string
  esito?: string
  /** Percorso accorciato del file `.esito.md`, solo se esiste. */
  fileEsito?: string
  note?: string
  /** Id del subagente Claude (`$.agent.list()`), per aprirne la conversazione. */
  agenteId?: string
  /** Percorso assoluto del `<nome>.log` di un lavoro Codex, accanto a esegui.log. */
  fileLog?: string
  /**
   * Falso quando la durata e solo un minimo (il lavoro c'era gia alla prima
   * lettura della mod): il pane la scrive `≥…`, o `—` se e finito.
   */
  isDurataCerta?: boolean
  /** Subagente Claude: perche ha quel modello (scelta della mod, chiamata, motore). */
  motivoModello?: string
  /** Subagente Claude: chi ha deciso il modello. */
  provenienzaModello?: 'regia' | 'esplicito' | 'ereditato'
  /** Subagente Claude: token dei suoi turni (ingresso, uscita e cache). */
  token?: number
}

/**
 * Quando un subagente Claude e stato visto la prima volta / l'ultima.
 * `isInizioNoto` e falso se c'era gia alla prima lettura: il suo vero inizio
 * e sconosciuto (AgentInfo non lo dice).
 */
export type RegiaTempoAgente = { inizioMs: number; fineMs?: number; isInizioNoto: boolean }

/** Quale insieme di lavori mostra il pane. */
export type RegiaVista = 'sessione' | 'tutti'

/** I tre gruppi del pane per una vista. */
export type RegiaVistaDati = {
  inCorso: RegiaRiga[]
  scaletta: RegiaRiga[]
  /** Quanti da fare in piu non sono mostrati. */
  scalettaExtra: number
  /** Gli ultimi lavori conclusi, al massimo 5. */
  fatti: RegiaRiga[]
  /** Quanti conclusi in piu non sono mostrati. */
  fattiExtra: number
}

/** Un messaggio della posta fra agenti, come lo mostra il pane. */
export type RegiaMessaggio = {
  id: string
  da: string
  a: string
  testo: string
  ora: number
  stato: 'nuovo' | 'consegnato' | 'letto' | 'errore'
}

/** Il campo di testo aperto nel pane: a chi scrivere, o quale Codex riprendere. */
export type RegiaScrittura = {
  /** Vuoto: nessun campo aperto. */
  a: string
  /** Come mostrarlo (nome del lavoro o del subagente). */
  etichetta: string
  modo: 'posta' | 'riprendi'
}

export type RegiaSnapshot = {
  /** 0 prima della prima lettura. */
  aggiornatoMs: number
  /** Entrambe le viste sono calcolate a ogni lettura: il tasto commuta subito. */
  viste: Record<RegiaVista, RegiaVistaDati>
  /** Una riga per fonte che ha avuto problemi. */
  avvisi: string[]
  isRegistroPresente: boolean
  tempiAgenti: Record<string, RegiaTempoAgente>
  /** Gli ultimi messaggi della posta, per vista. */
  posta: Record<RegiaVista, RegiaMessaggio[]>
}

/**
 * Cio che la mod ricorda in `$.store`, sotto la chiave `regia.sessione.<id>`
 * (<id> = `$.session.id()`): i nomi dei lavori Codex visti vivi e attribuiti a
 * quella sessione, per ritrovarne l'esito nello storico quando finiscono, e
 * i subagenti Claude visti concludersi, che il motore toglie presto da
 * `$.agent.list()`.
 */
export type RegiaMemoriaSessione = {
  nomi: string[]
  /** Subagenti Claude conclusi: id, nome, tipo, stato, esito, fine (vedi `RicordoAgente`). */
  agenti?: unknown[]
  aggiornatoMs: number
}

/** La vista di dettaglio del pane: le ultime righe del log di un lavoro Codex. */
export type RegiaDettaglio = {
  /** Vuoto: nessun dettaglio aperto, il pane mostra il cruscotto. */
  nome: string
  /** Accorciato per lo schermo. */
  percorso: string
  /** Assoluto, per rileggere. */
  percorsoPieno?: string
  righe: string[]
  errore?: string
  lettoMs: number
}

declare module 'claude-code' {
  interface PluginState {
    regia: {
      snapshot: Shaped<RegiaSnapshot>
      vista: Shaped<RegiaVista>
      dettaglio: Shaped<RegiaDettaglio>
      scrittura: Shaped<RegiaScrittura>
    }
  }
}
