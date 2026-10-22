import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'werkbank',
  component: 'Pane',
  requestId: 'werkbank-diffs',
  props: {
    title: 'Diffs',
    isFocused: true,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const ONLY_DIFF = { teller: false, bestandsboom: false, bewaker: false, tijdlijn: false, statusbalk: false }

/** Een nagebootst bestandssysteem onder de plugin, plus Edit en Write die erop werken. */
function fakeProject(on: On) {
  const files = new Map<string, string>([['/proj/app.ts', 'een\ntwee\ndrie\n']])
  const notes: string[] = []
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: (files.get(e.path) ?? '').length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')

    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'rm') files.delete(e.argv.at(-1) ?? '')

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.append', (_, e, next) => {
    const block = e.message.content[0]
    if (block !== undefined && 'text' in block) notes.push(String(block.text))

    return next(e)
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Edit') {
      const text = files.get(e.file_path) ?? ''
      files.set(e.file_path, text.replace(e.old_string, e.new_string))
    }
    if (e.tool === 'Write') files.set(e.file_path, e.content)

    return { result: {} }
  })

  return { files, notes }
}

test('het paneel toont de diff in rood en groen, en draait terug', { options: ONLY_DIFF }, async ($, on) => {
  const { files, notes } = fakeProject(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/app.ts', old_string: 'twee', new_string: 'TWEE' })
  await $.tool.call({ tool: 'Write', file_path: '/proj/nieuw.ts', content: 'hallo\n' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^- twee/ }))?.props.color).toBe('error')
    expect((await ui.find({ type: 'Text', text: /^\+ TWEE/ }))?.props.color).toBe('success')
    expect(await ui.find({ key: 'file:/proj/nieuw.ts' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'revert' })
  expect(files.get('/proj/app.ts')).toBe('een\ntwee\ndrie\n')
  expect(notes[0]).toContain('app.ts')
  // Nu staat het nieuwe bestand geselecteerd: terugdraaien verwijdert het.
  expect((await ui.find({ type: 'Text', text: /^\+ hallo/ }))?.props.color).toBe('success')
  await ui.press({ key: 'revert' })
  expect(files.has('/proj/nieuw.ts')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /Nog geen gewijzigde/ })).toBeDefined()
  await ui.unmount()
})

test('accepteren houdt de wijziging en haalt het bestand van de lijst', { options: ONLY_DIFF }, async ($, on) => {
  const { files } = fakeProject(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/app.ts', old_string: 'drie', new_string: 'vier' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'accept' })
  expect(files.get('/proj/app.ts')).toBe('een\ntwee\nvier\n')
  expect(await ui.find({ type: 'Text', text: /Nog geen gewijzigde/ })).toBeDefined()
  await ui.unmount()
})
