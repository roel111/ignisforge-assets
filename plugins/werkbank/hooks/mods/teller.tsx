// Mod 1, tool-teller: telt elke tool call van de sessie (subagents inbegrepen)
// en zet het aantal achter het woord van de spinner. /resetcount zet hem op nul.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ToolCallInput } from 'claude-code'

import type { ToolNext } from '../lib/types'

const toolCount = atom({ plugin: 'werkbank', key: 'toolCount' } as const, 0)

export async function tellerStart($: EngineInterface) {
  await $.command.register({
    name: 'resetcount',
    description: 'Zet de tool-teller naast de spinner op nul',
  })
}

export async function tellerTool($: EngineInterface, e: ToolCallInput, next: ToolNext) {
  // Tellen mag de call nooit tegenhouden.
  await update($, toolCount, n => n + 1).catch(() => undefined)

  return next(e)
}

export function teller(on: On) {
  on('command.run', { command: 'resetcount' }, async $ => {
    await update($, toolCount, () => 0)

    return { text: 'Tool-teller staat weer op 0.' }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const count = await read($, toolCount)
    const tail = ` · tool calls: ${count}`
    const props =
      e.props.message === null
        ? { ...e.props, word: e.props.word + tail }
        : { ...e.props, message: e.props.message + tail }

    return next({ ...e, props })
  })
}
