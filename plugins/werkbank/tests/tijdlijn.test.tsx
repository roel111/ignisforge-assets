import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'werkbank',
  component: 'Pane',
  requestId: 'werkbank-tijdlijn',
  props: {
    title: 'Tijdlijn',
    isFocused: true,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const ONLY_TIMELINE = { teller: false, bestandsboom: false, diffpaneel: false, bewaker: false, statusbalk: false }

test('de tijdlijn toont prompt, modelbeurt, tool en subagent, met fouten in rood en details bij een klik', { options: ONLY_TIMELINE }, async ($, on) => {
  let now = 1_700_000_000_000
  on('clock.now', () => {
    now += 250

    return { value: now }
  })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'Ik ga het bestand lezen.',
      toolUses: [{ id: 'tu1', name: 'Read', input: {} }],
      stopReason: 'tool_use',
      usage: null,
    }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') return { isError: true, result: 'exit 1', text: 'command not found: foo' }

    return { result: {}, text: 'klaar' }
  })

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't1', text: 'Lees README.md' })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 })
  for await (const chunk of stream) void chunk
  await $.tool.call({ tool: 'Read', file_path: '/proj/README.md' })
  await $.tool.call({ tool: 'Bash', command: 'foo' })
  await $.tool.call({ tool: 'Agent', description: 'zoek tests', prompt: 'Zoek alle tests', subagent_type: 'Explore' })
  await $.turn.complete({ turnId: 't1', answer: 'Klaar', durationMs: 4200, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /prompt\s+Lees README\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /model\s+modelbeurt 1 \(claude-test\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tool\s+Read: \/proj\/README\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /subagent\s+Agent: zoek tests/ })).toBeDefined()
    const failed = await ui.find({ type: 'Text', text: /tool\s+Bash: foo/ })
    expect(failed?.props.color).toBe('error')
    await ui.unmount()
  }

  // Klik op de mislukte stap: de details verschijnen; nog een klik klapt ze in.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await ui.findAll({ type: 'Button' })
  const bashRow = rows.find(row => /Bash: foo/.test(row.text ?? ''))
  await ui.press({ key: bashRow?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /command not found: foo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /duur 250ms · fout/ })).toBeDefined()
  await ui.press({ key: bashRow?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /command not found: foo/ })).toBeUndefined()
  // De prompt-stap duurt de hele beurt en is gelukt.
  expect((await ui.find({ type: 'Text', text: /prompt\s+Lees/ }))?.props.color).toBeUndefined()
  await ui.unmount()
})
