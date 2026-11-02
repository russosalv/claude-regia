// Posta fra agenti, la parte pura: lettura della casella (jsonl), indirizzi,
// testo consegnato, paragrafo per Codex. Il formato e quello di `script/posta`.

export type StatoPosta = 'nuovo' | 'consegnato' | 'letto' | 'errore'

export type Messaggio = {
  id: string
  da: string
  a: string
  testo: string
  /** Millisecondi dall'epoca. */
  ora: number
  /** La sessione Claude a cui appartiene la conversazione (chi la consegna). */
  sessione?: string
  stato: StatoPosta
  /** `posta` (tool o CLI), `pane`, `SendMessage`. */
  via?: string
  nota?: string
}

export const PRINCIPALE = 'principale'
export const UTENTE = 'utente'
const STATI: readonly StatoPosta[] = ['nuovo', 'consegnato', 'letto', 'errore']

/** Dove sta la casella e dove la mod copia la CLI. */
export function percorsiPosta(home: string) {
  return {
    casella: `${home}/.claude/regia/posta/posta.jsonl`,
    cli: `${home}/.claude/regia/bin/posta`,
  }
}

function comeMessaggio(o: Record<string, unknown>): Messaggio | undefined {
  const { id, da, a, testo, ora } = o
  if (typeof id !== 'string' || typeof da !== 'string' || typeof a !== 'string' || typeof testo !== 'string') return undefined

  return {
    id,
    da,
    a,
    testo,
    ora: typeof ora === 'number' ? ora : 0,
    stato: STATI.includes(o.stato as StatoPosta) ? (o.stato as StatoPosta) : 'nuovo',
    ...(typeof o.sessione === 'string' ? { sessione: o.sessione } : {}),
    ...(typeof o.via === 'string' ? { via: o.via } : {}),
  }
}

function riga(testo: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(testo)

    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** I messaggi della casella, ognuno con il suo ultimo stato, nell'ordine di arrivo. */
export function piegaPosta(testo: string): Messaggio[] {
  const perId = new Map<string, Messaggio>()
  for (const voce of testo.split('\n').map(riga)) {
    if (voce === undefined) continue
    if (voce.t === 'msg') {
      const m = comeMessaggio(voce)
      if (m !== undefined) perId.set(m.id, m)
    } else if (voce.t === 'stato' && typeof voce.id === 'string' && STATI.includes(voce.stato as StatoPosta)) {
      const m = perId.get(voce.id)
      if (m !== undefined) {
        perId.set(m.id, { ...m, stato: voce.stato as StatoPosta, ...(typeof voce.nota === 'string' ? { nota: voce.nota } : {}) })
      }
    }
  }

  return [...perId.values()]
}

/** Chi riceve un messaggio, dal punto di vista della sessione che lo consegna. */
export type Destinatario =
  | { tipo: 'principale' }
  | { tipo: 'utente' }
  | { tipo: 'subagente'; agentId: string; nome: string }
  | { tipo: 'codex'; nome: string }

export type AgenteNoto = { id: string; nome?: string; isInCorso: boolean }

/** Risolve un indirizzo; `errore` dice perche non si puo consegnare, in italiano. */
export function risolviIndirizzo(
  a: string,
  agenti: readonly AgenteNoto[],
  codex: { inCorso: readonly string[]; finiti: readonly string[] },
): { destinatario?: Destinatario; errore?: string } {
  const indirizzo = a.trim()
  if (indirizzo.toLowerCase() === PRINCIPALE) return { destinatario: { tipo: 'principale' } }
  if (indirizzo.toLowerCase() === UTENTE) return { destinatario: { tipo: 'utente' } }
  const agente = agenti.find(x => x.id === indirizzo || x.nome === indirizzo)
  if (agente !== undefined && agente.isInCorso) {
    return { destinatario: { tipo: 'subagente', agentId: agente.id, nome: agente.nome ?? agente.id } }
  }
  if (agente !== undefined) return { errore: `il subagente "${indirizzo}" non e piu in corso: non riceve messaggi (usa SendMessage per riprenderlo)` }
  if (codex.inCorso.includes(indirizzo)) return { destinatario: { tipo: 'codex', nome: indirizzo } }
  if (codex.finiti.includes(indirizzo)) return { errore: `il lavoro Codex "${indirizzo}" e finito: usa codex_riprendi per mandargli un messaggio` }
  const validi = [PRINCIPALE, UTENTE, ...agenti.filter(x => x.isInCorso).map(x => x.nome ?? x.id), ...codex.inCorso]

  return { errore: `destinatario sconosciuto: "${indirizzo}". Indirizzi validi ora: ${validi.join(', ')}` }
}

/** La riga che arriva nella conversazione di chi riceve. */
export function testoConsegna(m: Pick<Messaggio, 'id' | 'da' | 'testo'>): string {
  return [
    `[posta regia] Messaggio da ${m.da} (id ${m.id}):`,
    m.testo,
    '',
    `Per rispondere usa il tool posta_invia con a="${m.da}".`,
  ].join('\n')
}

/** Il paragrafo che `codex_avvia` accoda al prompt di Codex. */
export function paragrafoPosta(nome: string, cli: string): string {
  return [
    '## Posta della regia',
    `Il tuo nome nella posta e "${nome}". Fra un passo e l'altro (dopo un commit, prima di un passo lungo, quando sei bloccato) controlla se ti hanno scritto:`,
    `\`${cli} leggi ${nome}\``,
    'Se c\'e un messaggio, tienine conto: viene dalla sessione che ti coordina o dalla persona.',
    `Per scrivere alla sessione che ti ha lanciato: \`${cli} invia principale "testo" --da ${nome}\` (alla persona: \`invia utente\`).`,
    'Scrivi solo quando serve (un blocco, una domanda, un risultato intermedio importante), in poche righe.',
  ].join('\n')
}

/** Gli ultimi `n` messaggi di una sessione (o di tutte), i piu recenti per ultimi. */
export function ultimiMessaggi(messaggi: readonly Messaggio[], n: number, sessione?: string): Messaggio[] {
  const scelti = sessione === undefined ? messaggi : messaggi.filter(m => m.sessione === sessione)

  return [...scelti].sort((x, y) => x.ora - y.ora).slice(-n)
}

/** I messaggi che tocca a questa sessione consegnare a un destinatario Claude o alla persona. */
export function daConsegnare(messaggi: readonly Messaggio[], sessione: string): Messaggio[] {
  return messaggi.filter(m => m.stato === 'nuovo' && m.sessione === sessione && m.via !== 'SendMessage')
}
