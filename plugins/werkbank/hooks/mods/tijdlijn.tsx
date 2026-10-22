// Mod 5, agent-tijdlijn: een paneel met elke stap van de agent, live: je
// prompt (de hele beurt), elke modelbeurt, elke tool call en elke subagent,
// met tijdstip en duur. Mislukte stappen staan in rood. Klik op een stap (of
// n/p na ctrl+x tab) voor de details. /tijdlijn of de knop "t" in de band
// toont het paneel; w wist de tijdlijn, h verbergt het paneel.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ToolCallInput } from 'claude-code'

import type { TimelineStep } from '../../types'
import type { ToolNext } from '../lib/types'

export const TIMELINE_PANE = 'werkbank-tijdlijn'
const MAX_STEPS = 300
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

const timeline = atom({ plugin: 'werkbank', key: 'timeline' } as const, [])
const timelineSelected = atom({ plugin: 'werkbank', key: 'timelineSelected' } as const, null)

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// Bijhouden mag nooit de agent tegenhouden: fouten hier worden ingeslikt.
async function addStep($: EngineInterface, step: Omit<TimelineStep, 'startedAt'>) {
  try {
    const startedAt = await $.clock.now()
    await update($, timeline, list => [...list.filter(one => one.id !== step.id), { ...step, startedAt }].slice(-MAX_STEPS))
  } catch (error) {
    $.ui.log(`werkbank/tijdlijn: ${String(error)}`, { to: 'debug' })
  }
}

async function finishStep($: EngineInterface, id: string, status: 'ok' | 'fout', details?: string) {
  try {
    const endedAt = await $.clock.now()
    await update($, timeline, list =>
      list.map(one =>
        one.id === id ? { ...one, endedAt, status, details: details === undefined ? one.details : `${one.details}\n\n${details}` } : one,
      ),
    )
  } catch (error) {
    $.ui.log(`werkbank/tijdlijn: ${String(error)}`, { to: 'debug' })
  }
}

export async function toggleTimeline($: EngineInterface) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === TIMELINE_PANE)
  if (isUp) {
    await $.ui.close({ id: TIMELINE_PANE })

    return false
  }
  await $.ui.open({ id: TIMELINE_PANE, title: 'Tijdlijn' })

  return true
}

export async function tijdlijnStart($: EngineInterface) {
  await $.command.register({
    name: 'tijdlijn',
    description: 'Toon of verberg de live tijdlijn van wat de agent doet',
  })
  void $.ui.open({ id: TIMELINE_PANE, title: 'Tijdlijn' }).catch(() => undefined)
}

/** Een korte omschrijving van een tool call. */
function describeCall(e: ToolCallInput): string {
  const input = e as unknown as Record<string, unknown>
  for (const key of ['description', 'command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'prompt']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return oneLine(value)
  }

  return ''
}

function inputDetails(e: ToolCallInput): string {
  const { tool, tool_use_id, agentId, requestMeta, ...rest } = e as unknown as Record<string, unknown>
  void tool
  void tool_use_id
  void agentId
  void requestMeta

  return clip(JSON.stringify(rest, null, 2), 3000)
}

export async function tijdlijnTool($: EngineInterface, e: ToolCallInput, next: ToolNext) {
  const isSubagent = SUBAGENT_TOOLS.has(e.tool)
  const what = describeCall(e)
  await addStep($, {
    id: e.tool_use_id,
    kind: isSubagent ? 'subagent' : 'tool',
    label: what === '' ? e.tool : `${e.tool}: ${clip(what, 120)}`,
    endedAt: null,
    status: 'bezig',
    details: `Tool: ${e.tool}\nInvoer:\n${inputDetails(e)}`,
    ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
  })

  try {
    const ran = await next(e)
    if (ran.deny !== undefined) {
      await finishStep($, e.tool_use_id, 'fout', `Geweigerd: ${ran.deny}`)
    } else if (ran.isError === true) {
      await finishStep($, e.tool_use_id, 'fout', `Fout:\n${clip(ran.text ?? String(ran.result ?? ''), 3000)}`)
    } else {
      await finishStep($, e.tool_use_id, 'ok', `Resultaat:\n${clip(ran.text ?? '', 3000)}`)
    }

    return ran
  } catch (error) {
    await finishStep($, e.tool_use_id, 'fout', `Afgebroken: ${String(error)}`)
    throw error
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  const at = new Date(ms)

  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}
const duration = (ms: number) =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${pad(Math.round((ms % 60_000) / 1000))}s`

const ICON: Record<TimelineStep['kind'], string> = { prompt: '›', model: '◆', tool: '•', subagent: '⑂' }
const KIND: Record<TimelineStep['kind'], string> = { prompt: 'prompt', model: 'model', tool: 'tool', subagent: 'subagent' }

async function moveSelection($: EngineInterface, step: number) {
  const list = await read($, timeline)
  if (list.length === 0) return
  const current = await read($, timelineSelected)
  const at = list.findIndex(one => one.id === current)
  const from = at < 0 ? list.length : at
  const target = list[Math.max(0, Math.min(list.length - 1, from + step))]
  await update($, timelineSelected, () => target?.id ?? null)
  if (target !== undefined) await $.ui.scroll({ in: TIMELINE_PANE, to: { key: `step:${target.id}` } }).catch(() => undefined)
}

export function tijdlijn(on: On) {
  on('command.run', { command: 'tijdlijn' }, async $ => {
    const isUp = await toggleTimeline($)

    return { text: isUp ? 'Tijdlijn geopend.' : 'Tijdlijn verborgen.' }
  })

  // De prompt: één stap voor de hele beurt van de hoofdlus.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await addStep($, {
        id: e.turnId,
        kind: 'prompt',
        label: e.text === '' ? '(vervolg zonder prompt)' : clip(oneLine(e.text), 120),
          endedAt: null,
        status: 'bezig',
        details: `Prompt:\n${clip(e.text, 3000)}`,
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const isOk = e.reason === 'answer'
      const why = { answer: 'beantwoord', aborted: 'onderbroken', refusal: 'geweigerd door het model', error: 'API-fout' }[e.reason]
      const tokens = e.usage === undefined ? '' : `\nTokens: ${e.usage.input_tokens} in, ${e.usage.output_tokens} uit`
      await finishStep($, e.turnId, isOk ? 'ok' : 'fout', `Einde: ${why} na ${duration(e.durationMs)}${tokens}`)
    }

    return next(e)
  })

  // Elke modelbeurt (één API-verzoek binnen een beurt).
  on('turn.step', async function* ($, e, next) {
    const id = `${e.turnId}:${e.index}`
    await addStep($, {
      id,
      kind: 'model',
      label: `modelbeurt ${e.index + 1} (${e.model})`,
      endedAt: null,
      status: 'bezig',
      details: `Model: ${e.model}${e.effort === undefined ? '' : `, effort ${e.effort}`}\nBerichten in het verzoek: ${e.messageCount}`,
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
    })
    try {
      const result = yield* next(e)
      const tools = result.toolUses.map(use => use.name).join(', ')
      const parts = [
        `Stopreden: ${result.stopReason ?? 'geen antwoord'}`,
        tools === '' ? '' : `Vraagt tools: ${tools}`,
        result.answer === '' ? '' : `Antwoord:\n${clip(result.answer, 2000)}`,
      ].filter(part => part !== '')
      await finishStep($, id, result.stopReason === null ? 'fout' : 'ok', parts.join('\n'))

      return result
    } catch (error) {
      await finishStep($, id, 'fout', `Mislukt: ${String(error)}`)
      throw error
    }
  })

  on('ui.render', { component: 'Pane', requestId: TIMELINE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, timeline)
    const selected = await read($, timelineSelected)
    const width = Math.max(20, e.props.bodyColumns - 26)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{list.length} stappen</Text>
          <Text color="error">■ mislukt</Text>
          <Text color="warning">■ bezig</Text>
          <Button key="prev" hotkey="p" plain label="vorige" onPress={() => moveSelection($, -1)} />
          <Button key="next" hotkey="n" plain label="volgende" onPress={() => moveSelection($, 1)} />
          <Button
            key="clear"
            hotkey="w"
            plain
            label="wissen"
            onPress={async () => {
              await update($, timeline, () => [])
              await update($, timelineSelected, () => null)
            }}
          />
          <Button key="hide" hotkey="h" plain label="verbergen" onPress={() => $.ui.close({ id: TIMELINE_PANE })} />
        </Box>
        {list.length === 0 && <Text dimColor>Nog niets gebeurd. Stuur een prompt.</Text>}
        {list.map(step => {
          const isOpen = step.id === selected
          const color = step.status === 'fout' ? 'error' : step.status === 'bezig' ? 'warning' : undefined
          const took = step.endedAt === null ? '…' : duration(step.endedAt - step.startedAt)
          const indent = step.agentId === undefined || step.kind === 'prompt' ? '' : '  '

          return (
            <Box flexDirection="column" key={`step:${step.id}`}>
              <Button
                key={`row:${step.id}`}
                plain
                onPress={() => update($, timelineSelected, now => (now === step.id ? null : step.id))}
              >
                <Text dimColor>{clock(step.startedAt)} </Text>
                <Text color={color} bold={step.kind === 'prompt' || isOpen}>
                  {indent}
                  {ICON[step.kind]} {KIND[step.kind].padEnd(8)} {clip(step.label, width)}
                </Text>
                <Text dimColor={step.status === 'ok'} color={color}> {took}</Text>
              </Button>
              {isOpen && (
                <Box flexDirection="column" borderStyle="round" borderColor={color ?? 'subtle'} paddingX={1}>
                  <Text>
                    {KIND[step.kind]} · start {clock(step.startedAt)} · duur {took} · {step.status}
                    {step.agentId === undefined ? '' : ` · subagent ${step.agentId}`}
                  </Text>
                  <Text color={color}>{step.details}</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
