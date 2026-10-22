// Mod 6, statusbalk: een balk boven de prompt met de duur van de sessie, het
// aantal bewerkte bestanden, het aantal tool calls en ongeveer hoeveel van het
// contextvenster gebruikt is. De duur tikt elke seconde door.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallInput } from 'claude-code'

import { absoluteFrom, toolPath } from '../lib/paths'
import type { BandEvent, ToolNext } from '../lib/types'

const barTick = atom({ plugin: 'werkbank', key: 'barTick' } as const, 0)
const barTools = atom({ plugin: 'werkbank', key: 'barTools' } as const, 0)
const barEdited = atom({ plugin: 'werkbank', key: 'barEdited' } as const, [])

const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])

export async function statusbalkStart($: EngineInterface) {
  // Elke seconde een tik, zodat de duur in de balk doorloopt.
  $.clock.every(1000, () => {
    void update($, barTick, n => n + 1).catch(() => undefined)
  })
}

export async function statusbalkTool($: EngineInterface, e: ToolCallInput, next: ToolNext) {
  await update($, barTools, n => n + 1).catch(() => undefined)
  const ran = await next(e)
  const path = toolPath(e)
  if (path !== undefined && EDITS.has(e.tool) && ran.deny === undefined && ran.isError !== true) {
    const root = await $.session.root().catch(() => '')
    const abs = absoluteFrom(root, path)
    await update($, barEdited, list => (list.includes(abs) ? list : [...list, abs])).catch(() => undefined)
  }

  return ran
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  return hours > 0 ? `${hours}u ${pad(minutes)}m` : `${minutes}m ${pad(seconds)}s`
}

const kilo = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export async function statusbalkBand($: EngineInterface, e: BandEvent) {
  const { Box, Text } = $.ui.resolve(e)
  await read($, barTick)
  const tools = await read($, barTools)
  const edited = await read($, barEdited)
  const usage = await $.session.usage().catch(() => undefined)
  const now = await $.clock.now()
  const startedAt = usage?.startedAt ?? now

  const percent = usage?.context.percent
  const tokens = usage?.context.tokens
  const window = usage?.context.window
  const filled = percent === undefined ? 0 : Math.round(percent / 10)
  const meter = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`
  const color = percent === undefined ? undefined : percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'
  const context =
    percent === undefined
      ? 'context: nog onbekend'
      : `context ~${percent}%${tokens !== undefined && window !== undefined ? ` (${kilo(tokens)}/${kilo(window)})` : ''}`

  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Text>⏱ {formatDuration(now - startedAt)}</Text>
      <Text dimColor>│</Text>
      <Text>✎ {edited.length} bewerkt</Text>
      <Text dimColor>│</Text>
      <Text>⚙ {tools} tool calls</Text>
      <Text dimColor>│</Text>
      <Text color={color}>{meter}</Text>
      <Text color={color}>{context}</Text>
    </Box>
  )
}
