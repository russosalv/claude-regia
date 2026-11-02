// Modello e sforzo dei subagenti e conto dei loro token: la parte che parla
// col motore. Le regole stanno in `instradamento.ts`. La decisione si prende
// su `tool.call` di Agent perche solo li lo sforzo e un argomento della
// chiamata: `agent.spawn` poi la ritrova per `tool_use_id` e la ricorda.

import type { AgentSpawnInput, AgentSpawnResult, EngineInterface, TurnCompleteInput } from 'claude-code'

import { leggiConfig, leggiHome } from './fonti'
import { decidi, definizioneDalFrontmatter, promptClassifica, sceltaClassificata } from './instradamento'
import type { Decisione, SceltaModello } from './instradamento'
import { conInfo, conToken, modificaMemoria } from './memoria-agenti'
import { conRisparmio } from './orchestra'
import { messaggioErrore } from './parsers'

const ATTESA_CLASSIFICA_MS = 8_000

/** Il frontmatter del file dell'agente nel progetto o nella home, se c'e. */
async function definizione($: EngineInterface, tipo: string, cartelle: readonly string[]): Promise<{ modello?: string; sforzo?: string } | undefined> {
  if (!/^[\w-]+$/.test(tipo)) return undefined
  for (const cartella of cartelle) {
    const file = `${cartella}/.claude/agents/${tipo}.md`
    try {
      if (await $.fs.exists(file)) return definizioneDalFrontmatter(await $.fs.read(file))
    } catch {
      // Un file illeggibile non decide nulla: si guarda il prossimo.
    }
  }

  return undefined
}

async function cartelleAgenti($: EngineInterface, home: string, cwd: string | undefined): Promise<string[]> {
  const repo = await $.session.repo().catch(() => undefined)
  const sessione = await $.session.cwd().catch(() => undefined)

  return [...new Set([cwd, repo?.root, sessione, home].filter((c): c is string => c !== undefined && c !== ''))]
}

/** Haiku guarda il compito e sceglie; se non risponde, un'euristica e sonnet. */
export async function classifica(
  $: EngineInterface,
  d: Extract<Decisione, { tipo: 'classifica' }>,
  c: { descrizione: string; prompt: string },
): Promise<SceltaModello> {
  try {
    const r = await $.model.complete({
      model: 'haiku',
      prompt: promptClassifica(c.descrizione, c.prompt),
      maxTokens: 60,
      effort: 'low',
      timeoutMs: ATTESA_CLASSIFICA_MS,
    })

    return sceltaClassificata(d, c.prompt, r.isAnswered ? { testo: r.text } : { errore: r.reason })
  } catch (errore) {
    return sceltaClassificata(d, c.prompt, { errore: messaggioErrore(errore) })
  }
}

type ChiamataAgent = { tipo: string; model?: string; effort?: string; descrizione: string; prompt: string; cwd?: string }

/** La scelta per una chiamata. Non lancia: un guasto lascia decidere al motore. */
export async function scegli($: EngineInterface, c: ChiamataAgent): Promise<SceltaModello> {
  try {
    const home = (await leggiHome($)) ?? ''
    const config = (await leggiConfig($, home)).dati
    const decisione = decidi(c, {
      instradamento: config.instradamento,
      modelli: config.modelli,
      definizione: await definizione($, c.tipo, await cartelleAgenti($, home, c.cwd)),
    })

    return decisione.tipo === 'scelta' ? decisione.scelta : await classifica($, decisione, c)
  } catch (errore) {
    return { motivo: `scelta non riuscita (${messaggioErrore(errore)}): deciso dal motore`, provenienza: 'ereditato' }
  }
}

// Dalla chiamata allo spawn, per `tool_use_id`. Sta qui e non in `$.state`:
// passa di mano nel giro di pochi istanti.
const inViaggio = new Map<string, SceltaModello>()

/** Una scelta per uno spawn che non passa dal tool Agent, per nome dell'agente. */
export function ricordaScelta(nome: string, scelta: SceltaModello): void {
  inViaggio.set(`nome:${nome}`, scelta)
}

/** Il modello e lo sforzo vero di un Agent, e il prompt con le regole di sobrieta. */
export async function preparaAgent<E extends { tool_use_id?: string; subagent_type?: string; model?: string; effort?: string; description: string; prompt: string; cwd?: string }>(
  $: EngineInterface,
  e: E,
): Promise<E> {
  const tipo = e.subagent_type ?? 'general-purpose'
  const scelta = await scegli($, { tipo, model: e.model, effort: e.effort, descrizione: e.description, prompt: e.prompt, cwd: e.cwd })
  if (e.tool_use_id !== undefined) inViaggio.set(e.tool_use_id, scelta)

  return {
    ...e,
    ...(scelta.provenienza === 'regia' && scelta.modello !== undefined ? { model: scelta.modello } : {}),
    ...(scelta.provenienza === 'regia' && scelta.sforzo !== undefined ? { effort: scelta.sforzo } : {}),
    prompt: tipo === 'fork' ? e.prompt : await conRisparmio($, e.prompt),
  }
}

/** Hook di `agent.spawn`: passa avanti e ricorda modello, motivo e chi l'ha deciso. */
export async function suSpawn(
  $: EngineInterface,
  e: AgentSpawnInput,
  next: (e: AgentSpawnInput) => Promise<AgentSpawnResult>,
): Promise<AgentSpawnResult> {
  const chiaveNome = `nome:${e.name ?? ''}`
  const scelta = inViaggio.get(e.tool_use_id) ?? inViaggio.get(chiaveNome)
  inViaggio.delete(e.tool_use_id)
  inViaggio.delete(chiaveNome)
  const r = await next(e)
  if (r.deny !== undefined || r.agentId === undefined || e.resume !== undefined) return r
  const id = r.agentId
  const sessione = await $.session.id().catch(() => undefined)
  if (sessione === undefined) return r
  const avviso = await modificaMemoria($, sessione, m => conInfo(m, id, {
    tipo: e.subagentType,
    modello: r.model,
    ...(scelta?.sforzo === undefined ? {} : { sforzo: scelta.sforzo }),
    motivo: scelta?.motivo ?? 'non passato dal tool Agent: deciso dal motore',
    provenienza: scelta?.provenienza ?? 'ereditato',
  }))
  if (avviso !== undefined) $.ui.toast(`regia: ${avviso}`)

  return r
}

// Lo sforzo voluto per gli agenti lanciati dalla mod: per nome finche il motore
// non da l'id (il primo passo puo arrivare prima che `$.agent.spawn` risponda).
const sforzoPerNome = new Map<string, string>()
const sforzoPerAgente = new Map<string, string>()

export function ricordaSforzo(nome: string, sforzo: string): void {
  sforzoPerNome.set(nome, sforzo)
}

/** Lo sforzo da imporre a questo passo di un subagente, se la mod ne ha scelto uno. */
export async function sforzoDelPasso($: EngineInterface, agentId: string | undefined): Promise<string | undefined> {
  if (agentId === undefined) return undefined
  const noto = sforzoPerAgente.get(agentId)
  if (noto !== undefined || sforzoPerNome.size === 0) return noto
  const nome = (await $.agent.list()).find(a => a.id === agentId)?.name
  const sforzo = nome === undefined ? undefined : sforzoPerNome.get(nome)
  if (nome === undefined || sforzo === undefined) return undefined
  sforzoPerNome.delete(nome)
  sforzoPerAgente.set(agentId, sforzo)

  return sforzo
}

// L'ultimo modello e sforzo visti per agente: si scrive solo se cambiano.
const ultimoPasso = new Map<string, string>()

/** Hook di `turn.step`: modello e sforzo con cui un subagente sta davvero girando. */
export async function notaPasso($: EngineInterface, agentId: string | undefined, modello: string, sforzo: unknown): Promise<void> {
  if (agentId === undefined) return
  const livello = sforzo === undefined ? undefined : `${sforzo as string | number}`
  const firma = `${modello}|${livello ?? ''}`
  if (ultimoPasso.get(agentId) === firma) return
  ultimoPasso.set(agentId, firma)
  const sessione = await $.session.id().catch(() => undefined)
  if (sessione === undefined) return
  await modificaMemoria($, sessione, m => conInfo(m, agentId, { modello, ...(livello === undefined ? {} : { sforzo: livello }) }))
}

/** Hook di `turn.complete`: somma i token del turno di un subagente. */
export async function contaToken($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  const { agentId, usage } = e
  if (agentId === undefined || usage === undefined) return
  const sessione = await $.session.id().catch(() => undefined)
  if (sessione === undefined) return
  await modificaMemoria($, sessione, m => conToken(m, agentId, usage))
}
