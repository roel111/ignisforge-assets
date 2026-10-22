import { expect, test } from 'claude-code/testing'

import { command } from './helpers'

const PANE = {
  plugin: 'werkbank',
  component: 'Pane',
  requestId: 'werkbank-bestanden',
  props: {
    title: 'Bestanden',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const ONLY_TREE = { teller: false, diffpaneel: false, bewaker: false, tijdlijn: false, statusbalk: false }

test('de boom kleurt gelezen en bewerkte bestanden en werkt bij na elke tool call', { options: ONLY_TREE }, async ($, on) => {
  let listing = 'README.md\nsrc/app.ts\nsrc/util.ts\n'
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: listing, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', () => ({ value: false }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(opened).toContain('werkbank-bestanden')

  await $.tool.call({ tool: 'Read', file_path: '/proj/src/app.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/README.md', old_string: 'a', new_string: 'b' })
  listing += 'src/nieuw.ts\n'
  await $.tool.call({ tool: 'Write', file_path: '/proj/src/nieuw.ts', content: 'x' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const app = await ui.find({ type: 'Text', text: /app\.ts/ })
    expect(app?.text).toContain('R app.ts')
    expect(app?.props.color).toBe('suggestion')
    const readme = await ui.find({ type: 'Text', text: /README/ })
    expect(readme?.text).toContain('B README.md')
    expect(readme?.props.color).toBe('success')
    const created = await ui.find({ type: 'Text', text: /nieuw\.ts/ })
    expect(created?.text).toContain('N nieuw.ts')
    const util = await ui.find({ type: 'Text', text: /util\.ts/ })
    expect(util?.props.color).toBeUndefined()

    await ui.press({ key: 'filter' })
    expect(await ui.find({ type: 'Text', text: /util\.ts/ })).toBeUndefined()
    await ui.press({ key: 'filter' })
    await ui.unmount()
  }
})

test('/bestanden toont en verbergt het paneel', { options: ONLY_TREE }, async ($, on) => {
  let isUp = false
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'a.txt\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => {
    isUp = true

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    isUp = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: isUp ? [{ id: 'werkbank-bestanden', title: 'Bestanden', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(isUp).toBe(true)
  expect((await $.command.run(command('bestanden'))).text).toContain('verborgen')
  expect(isUp).toBe(false)
  expect((await $.command.run(command('bestanden'))).text).toContain('geopend')
  expect(isUp).toBe(true)
})
