// Mod 2, bestandsboom: een zijpaneel met de bestanden van het project. Wat
// Claude las is blauw, wat Claude bewerkte of nieuw maakte groen. Na elke tool
// call wordt de lijst opnieuw ingelezen. /bestanden of de knop "b" in de band
// toont of verbergt het paneel; in het paneel: f filter, r vernieuwen, h weg.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ToolCallInput } from 'claude-code'

import type { FileMark } from '../../types'
import { relativeTo, toolPath } from '../lib/paths'
import type { ToolNext } from '../lib/types'

export const TREE_PANE = 'werkbank-bestanden'
const MAX_FILES = 3000
const SKIP = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build', '.next'])

const treeFiles = atom({ plugin: 'werkbank', key: 'treeFiles' } as const, [])
const treeMarks = atom({ plugin: 'werkbank', key: 'treeMarks' } as const, {})
const treeOnlyTouched = atom({ plugin: 'werkbank', key: 'treeOnlyTouched' } as const, false)

const READS = new Set(['Read', 'NotebookRead'])
const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])

/** Leest de bestandslijst: eerst via git, anders door de mappen te lopen. */
async function scan($: EngineInterface): Promise<string[]> {
  const root = await $.session.root()
  const git = await $.process
    .run(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root })
    .catch(() => undefined)
  if (git !== undefined && git.exitCode === 0) {
    return git.stdout.split('\n').filter(line => line !== '').slice(0, MAX_FILES)
  }

  const found: string[] = []
  const queue = ['']
  while (queue.length > 0 && found.length < MAX_FILES) {
    const dir = queue.shift() ?? ''
    const entries = await $.fs.list(dir === '' ? root : `${root}/${dir}`).catch(() => [])
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.kind === 'dir') queue.push(path)
      else found.push(path)
    }
  }

  return found
}

export async function refreshTree($: EngineInterface) {
  const files = await scan($)
  await update($, treeFiles, () => files)
}

export async function toggleTree($: EngineInterface) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === TREE_PANE)
  if (isUp) {
    await $.ui.close({ id: TREE_PANE })

    return false
  }
  await refreshTree($)
  await $.ui.open({ id: TREE_PANE, title: 'Bestanden' })

  return true
}

export async function bestandsboomStart($: EngineInterface) {
  await $.command.register({
    name: 'bestanden',
    description: 'Toon of verberg het paneel met de projectbestanden',
  })
  await refreshTree($)
  void $.ui.open({ id: TREE_PANE, title: 'Bestanden' }).catch(() => undefined)
}

export async function bestandsboomTool($: EngineInterface, e: ToolCallInput, next: ToolNext) {
  const path = toolPath(e)
  const existed = path !== undefined && e.tool === 'Write' ? await $.fs.exists(path).catch(() => true) : true
  const ran = await next(e)
  // Bijhouden mag de call nooit laten mislukken.
  await markAndRefresh($, e, path, existed, ran.deny === undefined && ran.isError !== true).catch((error: unknown) =>
    $.ui.log(`werkbank/bestandsboom: ${String(error)}`, { to: 'debug' }),
  )

  return ran
}

async function markAndRefresh($: EngineInterface, e: ToolCallInput, path: string | undefined, existed: boolean, isDone: boolean) {
  if (isDone && path !== undefined && (READS.has(e.tool) || EDITS.has(e.tool))) {
    const rel = relativeTo(await $.session.root(), path)
    await update($, treeMarks, marks => {
      const was = marks[rel]
      let mark: FileMark = READS.has(e.tool) ? 'gelezen' : existed ? 'bewerkt' : 'nieuw'
      // Gelezen nooit over bewerkt of nieuw heen, en nieuw blijft nieuw.
      if (was === 'nieuw' || (was === 'bewerkt' && mark === 'gelezen')) mark = was

      return { ...marks, [rel]: mark }
    })
  }
  await refreshTree($)
}

type Row = { depth: number; name: string; path: string; isDir: boolean }

/** Zet een platte lijst paden om in rijen van een boom, mappen eerst. */
export function treeRows(files: readonly string[]): Row[] {
  type Node = { dirs: Map<string, Node>; files: string[] }
  const top: Node = { dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.split('/')
    let node = top
    for (const part of parts.slice(0, -1)) {
      let child = node.dirs.get(part)
      if (child === undefined) {
        child = { dirs: new Map(), files: [] }
        node.dirs.set(part, child)
      }
      node = child
    }
    node.files.push(parts.at(-1) ?? file)
  }

  const rows: Row[] = []
  const walk = (node: Node, prefix: string, depth: number) => {
    for (const name of [...node.dirs.keys()].sort()) {
      const path = prefix + name
      rows.push({ depth, name, path, isDir: true })
      walk(node.dirs.get(name) ?? top, `${path}/`, depth + 1)
    }
    for (const name of node.files.sort()) {
      rows.push({ depth, name, path: prefix + name, isDir: false })
    }
  }
  walk(top, '', 0)

  return rows
}

const COLOR: Record<FileMark, string> = { gelezen: 'suggestion', bewerkt: 'success', nieuw: 'success' }
const SIGN: Record<FileMark, string> = { gelezen: 'R', bewerkt: 'B', nieuw: 'N' }

export function bestandsboom(on: On) {
  on('command.run', { command: 'bestanden' }, async $ => {
    const isUp = await toggleTree($)

    return { text: isUp ? 'Bestandsboom geopend.' : 'Bestandsboom verborgen.' }
  })

  on('ui.render', { component: 'Pane', requestId: TREE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const marks = await read($, treeMarks)
    const isFiltered = await read($, treeOnlyTouched)
    const all = await read($, treeFiles)
    const touched = Object.keys(marks)
    // Aangeraakte bestanden die (nog) niet in de lijst staan, horen er ook in.
    const files = isFiltered ? touched : [...new Set([...all, ...touched])]
    const rows = treeRows(files)
    const dirHasMark = (dir: string) => touched.some(path => path.startsWith(`${dir}/`))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="suggestion">■ gelezen</Text>
          <Text color="success">■ bewerkt/nieuw</Text>
          <Text dimColor>{touched.length} aangeraakt</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button
            key="filter"
            hotkey="f"
            plain
            label={isFiltered ? 'alles tonen' : 'alleen aangeraakt'}
            onPress={() => update($, treeOnlyTouched, is => !is)}
          />
          <Button key="refresh" hotkey="r" plain label="vernieuwen" onPress={() => refreshTree($)} />
          <Button key="hide" hotkey="h" plain label="verbergen" onPress={() => $.ui.close({ id: TREE_PANE })} />
        </Box>
        {rows.length === 0 && <Text dimColor>Geen bestanden gevonden.</Text>}
        {rows.map(row => {
          const indent = '  '.repeat(row.depth)
          if (row.isDir) {
            return (
              <Text bold={dirHasMark(row.path)} dimColor={!dirHasMark(row.path)} wrap="truncate-end">
                {indent}▾ {row.name}/
              </Text>
            )
          }
          const mark = marks[row.path]

          return mark === undefined ? (
            <Text wrap="truncate-end">
              {indent}  {row.name}
            </Text>
          ) : (
            <Text color={COLOR[mark]} bold wrap="truncate-end">
              {indent}{SIGN[mark]} {row.name}
            </Text>
          )
        })}
        {all.length >= MAX_FILES && <Text dimColor>(eerste {MAX_FILES} bestanden)</Text>}
      </Box>
    )
  })
}
