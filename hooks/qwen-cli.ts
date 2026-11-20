// La CLI dell'esecutore `qwen` puo chiamarsi `qwen` o `qoder`. Non basta che
// il comando esista: Regia usa un contratto preciso di opzioni per avvio e
// ripresa, quindi una CLI con lo stesso nome ma un'interfaccia diversa non vale.

import type { EngineInterface } from 'claude-code'

export type ComandoQwen = 'qwen' | 'qoder'
export type CliQwen = { comando: ComandoQwen; versione: string }

const COMANDI: readonly ComandoQwen[] = ['qwen', 'qoder']
const OPZIONI_RICHIESTE = [
  '--permission-mode',
  '--strict-mcp-config',
  '--session-id',
  '--name',
  '--cwd',
  '--print',
  '--resume',
  '--model',
  '--reasoning-effort',
] as const

export function isHelpQwenCompatibile(help: string): boolean {
  return OPZIONI_RICHIESTE.every(opzione => help.includes(opzione))
}

async function prova($: EngineInterface, comando: ComandoQwen): Promise<CliQwen | undefined> {
  try {
    const help = await $.process.run([comando, '--help'], { timeoutMs: 5_000 })
    if (help.exitCode !== 0 || !isHelpQwenCompatibile(`${help.stdout}\n${help.stderr}`)) return undefined
    const versione = await $.process.run([comando, '--version'], { timeoutMs: 5_000 })
    if (versione.exitCode !== 0) return undefined
    const prima = versione.stdout.trim().split('\n')[0] ?? ''

    return { comando, versione: prima.toLowerCase().includes(comando) ? prima : `${comando} ${prima}`.trim() }
  } catch {
    return undefined
  }
}

export async function trovaCliQwen($: EngineInterface): Promise<CliQwen | undefined> {
  for (const comando of COMANDI) {
    const cli = await prova($, comando)
    if (cli !== undefined) return cli
  }

  return undefined
}
