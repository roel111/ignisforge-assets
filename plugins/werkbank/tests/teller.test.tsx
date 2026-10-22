import { expect, test } from 'claude-code/testing'

import { command } from './helpers'

const SPINNER = {
  plugin: 'werkbank',
  component: 'Spinner',
  requestId: 'main',
  props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
} as const

const ONLY_TELLER = { bestandsboom: false, diffpaneel: false, bewaker: false, tijdlijn: false, statusbalk: false }

test('de teller telt tool calls naast de spinner en /resetcount zet hem op nul', { options: ONLY_TELLER }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  // De engine onder de plugin: tekent het woord dat de spinner krijgt.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { word: string }

    return <Text>{props.word}</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/a.txt' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...SPINNER, surface })
    expect((await ui.find({ type: 'Text', text: /Thinking/ }))?.text).toBe('Thinking · tool calls: 3')
    await ui.unmount()
  }

  const reset = await $.command.run(command('resetcount'))
  expect(reset.text).toContain('0')
  const ui = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Thinking/ }))?.text).toBe('Thinking · tool calls: 0')
  await ui.unmount()
})

test('de teller staat uit als zijn schakelaar uit staat', { options: { ...ONLY_TELLER, teller: false } }, async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.call', () => ({ result: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { word: string }

    return <Text>{props.word}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const ui = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Thinking/ }))?.text).toBe('Thinking')
  await ui.unmount()
})
