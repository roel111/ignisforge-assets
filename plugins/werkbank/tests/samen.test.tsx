// Alle zes mods tegelijk: ze delen de band en de tool calls zonder elkaar in
// de weg te zitten, en elke mod is los uit te zetten.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { command } from './helpers'

const BAND = {
  plugin: 'werkbank',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 30,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 29 },
    view: {},
  },
} as const

function world(on: On) {
  const files = new Map<string, string>([['/proj/app.ts', 'een\n']])
  const ran: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.usage', () => ({ value: { startedAt: 1_700_000_000_000, context: { window: 200_000 }, rateLimits: [] } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'app.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')

    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('config.set', (_, e) => ({ value: e.value }))
  on('tool.call', (_, e) => {
    ran.push(e.tool)
    if (e.tool === 'Edit') files.set(e.file_path, (files.get(e.file_path) ?? '').replace(e.old_string, e.new_string))

    return { result: {} }
  })

  return { ran, files }
}

test('alle mods samen: één band met waarschuwing, statusbalk en paneelknoppen', async ($, on) => {
  const { ran, files } = world(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/app.ts', old_string: 'een', new_string: 'twee' })
  const denied = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(denied.deny).toContain('veiligheidsbewaker')
  // Alleen de Edit bereikte de engine.
  expect(ran).toEqual(['Edit'])
  expect(files.get('/proj/.claude/werkbank-geblokkeerd.log')).toContain('git push --force')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /blokkeerde Bash/ })).toBeDefined()
  // Teller en statusbalk tellen allebei elke poging, ook de geblokkeerde.
  expect((await ui.find({ type: 'Text', text: /tool calls/ }))?.text).toBe('⚙ 2 tool calls')
  expect((await ui.find({ type: 'Text', text: /bewerkt/ }))?.text).toBe('✎ 1 bewerkt')
  for (const key of ['chip-tree', 'chip-diffs', 'chip-timeline']) {
    expect(await ui.find({ key })).toBeDefined()
  }
  await ui.unmount()

  const list = await $.command.run(command('werkbank'))
  expect(list.text).toContain('● teller')
  expect((await $.command.run(command('werkbank', 'bewaker uit'))).text).toContain('staat nu uit')
})

test('een uitgezette mod laat geen spoor na', { options: { bewaker: false, statusbalk: false, bestandsboom: false, diffpaneel: false, tijdlijn: false } }, async ($, on) => {
  const { ran } = world(on)
  // Zonder bewaker, statusbalk of panelen tekent de werkbank niets in de band.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })).deny).toBeUndefined()
  expect(ran).toEqual(['Bash'])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
  expect((await $.command.run(command('werkbank'))).text).toContain('○ bewaker')
})
