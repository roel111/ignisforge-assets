import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'werkbank',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const START = 1_700_000_000_000
const ONLY_BAR = { teller: false, bestandsboom: false, diffpaneel: false, bewaker: false, tijdlijn: false }

function world(on: On, percent?: number) {
  const clock = mock.clock(on, { now: START })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.usage', () => ({
    value: {
      startedAt: START,
      context: percent === undefined ? { window: 200_000 } : { tokens: percent * 2000, window: 200_000, percent },
      rateLimits: [],
    },
  }))
  on('tool.call', () => ({ result: {} }))

  return clock
}

test('de balk toont duur, bewerkte bestanden, tool calls en context', { options: ONLY_BAR }, async ($, on) => {
  const clock = world(on, 34)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'y', new_string: 'z' })
  await $.tool.call({ tool: 'Write', file_path: 'b.ts', content: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(83_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /⏱/ }))?.text).toBe('⏱ 1m 23s')
    expect((await ui.find({ type: 'Text', text: /bewerkt/ }))?.text).toBe('✎ 2 bewerkt')
    expect((await ui.find({ type: 'Text', text: /tool calls/ }))?.text).toBe('⚙ 4 tool calls')
    const context = await ui.find({ type: 'Text', text: /context/ })
    expect(context?.text).toBe('context ~34% (68k/200k)')
    expect(context?.props.color).toBe('success')
    await ui.unmount()
  }
})

test('de duur tikt door en de context kleurt rood als hij bijna vol is', { options: ONLY_BAR }, async ($, on) => {
  const clock = world(on, 93)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /⏱/ }))?.text).toBe('⏱ 0m 00s')
  await clock.advance(5000)
  expect((await ui.find({ type: 'Text', text: /⏱/ }))?.text).toBe('⏱ 0m 05s')
  expect((await ui.find({ type: 'Text', text: /context/ }))?.props.color).toBe('error')
  await ui.unmount()
})
