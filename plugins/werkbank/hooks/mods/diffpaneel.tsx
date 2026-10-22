// Mod 3, diff-paneel: alle bestanden die Claude deze sessie wijzigde. Kies een
// bestand en zie de diff (weg in rood, erbij in groen). "Accepteren" houdt de
// wijziging en haalt het bestand van de lijst; "terugdraaien" zet de inhoud
// van vóór de eerste wijziging terug (een nieuw bestand wordt verwijderd) en
// laat Claude dat weten. /diffs of de knop "d" in de band toont het paneel.
// In het paneel: n/p volgende/vorige, a accepteren, r terugdraaien, h weg;
// pijltjes scrollen.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, ToolCallInput } from 'claude-code'

import type { ChangedFile } from '../../types'
import { countChanges, diffLines, toHunks } from '../lib/diff'
import { absoluteFrom, relativeTo, toolPath } from '../lib/paths'
import type { ToolNext } from '../lib/types'

export const DIFF_PANE = 'werkbank-diffs'
const MAX_ORIGINAL = 1024 * 1024
const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])

const changes = atom({ plugin: 'werkbank', key: 'changes' } as const, [])
const diffSelected = atom({ plugin: 'werkbank', key: 'diffSelected' } as const, null)

export async function toggleDiffs($: EngineInterface) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === DIFF_PANE)
  if (isUp) {
    await $.ui.close({ id: DIFF_PANE })

    return false
  }
  await $.ui.open({ id: DIFF_PANE, title: 'Diffs' })

  return true
}

export async function diffpaneelStart($: EngineInterface) {
  await $.command.register({
    name: 'diffs',
    description: 'Toon of verberg het paneel met de gewijzigde bestanden en hun diff',
  })
}

/** Leest het origineel vóór de eerste wijziging van een bestand. */
async function original($: EngineInterface, absPath: string) {
  const exists = await $.fs.exists(absPath)
  if (!exists) return { original: null, isTooLarge: false }
  const stat = await $.fs.stat(absPath).catch(() => undefined)
  if (stat !== undefined && stat.size > MAX_ORIGINAL) return { original: '', isTooLarge: true }
  const text = await $.fs.read(absPath).catch(() => undefined)

  return text === undefined ? { original: '', isTooLarge: true } : { original: text, isTooLarge: false }
}

export async function diffpaneelTool($: EngineInterface, e: ToolCallInput, next: ToolNext) {
  const path = toolPath(e)
  if (path === undefined || !EDITS.has(e.tool)) return next(e)

  // Bijhouden mag de call nooit laten mislukken: lukt het lezen van het
  // origineel niet, dan gaat de call gewoon door zonder diff.
  const seen = await before($, path).catch(() => undefined)
  const ran = await next(e)
  if (seen === undefined || ran.deny !== undefined || ran.isError === true) return ran
  await remember($, seen).catch((error: unknown) => $.ui.log(`werkbank/diffpaneel: ${String(error)}`, { to: 'debug' }))

  return ran
}

type Seen = { root: string; absPath: string; first: { original: string | null; isTooLarge: boolean } | undefined }

async function before($: EngineInterface, path: string): Promise<Seen> {
  const root = await $.session.root()
  const absPath = absoluteFrom(root, path)
  const known = (await read($, changes)).some(one => one.absPath === absPath)

  return { root, absPath, first: known ? undefined : await original($, absPath) }
}

async function remember($: EngineInterface, { root, absPath, first }: Seen) {
  const isFirst = (await read($, changes)).length === 0
  await update($, changes, list => {
    const at = list.findIndex(one => one.absPath === absPath)
    if (at >= 0) return list.map((one, i) => (i === at ? { ...one, edits: one.edits + 1 } : one))
    const added: ChangedFile = {
      path: relativeTo(root, absPath),
      absPath,
      original: first?.original ?? null,
      isTooLarge: first?.isTooLarge ?? false,
      edits: 1,
    }

    return [...list, added]
  })
  if ((await read($, diffSelected)) === null) await update($, diffSelected, () => absPath)
  if (isFirst) void $.ui.open({ id: DIFF_PANE, title: 'Diffs' }).catch(() => undefined)
}

async function forget($: EngineInterface, absPath: string) {
  const list = await read($, changes)
  const at = list.findIndex(one => one.absPath === absPath)
  const rest = list.filter(one => one.absPath !== absPath)
  await update($, changes, () => rest)
  const neighbour = rest[Math.min(at, rest.length - 1)]
  await update($, diffSelected, () => neighbour?.absPath ?? null)
}

export async function acceptChange($: EngineInterface, absPath: string) {
  const file = (await read($, changes)).find(one => one.absPath === absPath)
  if (file === undefined) return
  await forget($, absPath)
  $.ui.toast(`Geaccepteerd: ${file.path}`)
}

export async function revertChange($: EngineInterface, absPath: string) {
  const file = (await read($, changes)).find(one => one.absPath === absPath)
  if (file === undefined) return
  if (file.isTooLarge) {
    $.ui.toast(`${file.path} was te groot om te bewaren; terugdraaien kan niet.`)

    return
  }

  if (file.original === null) {
    const removed = await $.process.run(['rm', '-f', '--', absPath]).catch(() => undefined)
    if (removed === undefined || removed.exitCode !== 0) {
      $.ui.toast(`Kon ${file.path} niet verwijderen.`)

      return
    }
  } else {
    await $.fs.write(absPath, file.original)
  }
  await forget($, absPath)
  $.ui.toast(`Teruggedraaid: ${file.path}`)
  const what = file.original === null ? 'verwijderd (het was nieuw)' : 'teruggezet naar de inhoud van vóór je wijzigingen'
  await $.session
    .append({
      message: {
        type: 'user',
        content: [{ type: 'text', text: `De gebruiker heeft ${file.path} ${what} via het diff-paneel. Ga niet uit van je eerdere wijzigingen in dat bestand.` }],
      },
    })
    .catch(() => undefined)
}

async function moveSelection($: EngineInterface, step: number) {
  const list = await read($, changes)
  if (list.length === 0) return
  const current = await read($, diffSelected)
  const at = list.findIndex(one => one.absPath === current)
  const next = list[(at + step + list.length) % list.length]
  await update($, diffSelected, () => next?.absPath ?? null)
  await $.ui.scroll({ in: DIFF_PANE, to: 'start' }).catch(() => undefined)
}

export function diffpaneel(on: On) {
  on('command.run', { command: 'diffs' }, async $ => {
    const isUp = await toggleDiffs($)

    return { text: isUp ? 'Diff-paneel geopend.' : 'Diff-paneel verborgen.' }
  })

  on('ui.render', { component: 'Pane', requestId: DIFF_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, changes)
    const selected = await read($, diffSelected)
    const file = list.find(one => one.absPath === selected) ?? list[0]

    if (file === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nog geen gewijzigde bestanden in deze sessie.</Text>
          <Button key="hide" hotkey="h" plain label="verbergen" onPress={() => $.ui.close({ id: DIFF_PANE })} />
        </Box>
      )
    }

    const current = await $.fs.read(file.absPath).catch(() => null)
    const lines = file.isTooLarge ? null : diffLines(file.original ?? '', current ?? '')
    const counts = lines === null ? null : countChanges(lines)
    const hunks = lines === null ? [] : toHunks(lines)
    const width = Math.max(10, e.props.bodyColumns - 8)

    return (
      <Box flexDirection="column">
        <Text bold>Gewijzigd in deze sessie ({list.length})</Text>
        {list.map(one => {
          const isOn = one.absPath === file.absPath
          const tag = one.original === null ? 'nieuw' : `${one.edits}×`

          return (
            <Button key={`file:${one.absPath}`} plain onPress={() => update($, diffSelected, () => one.absPath)}>
              <Text color={isOn ? 'claude' : undefined} bold={isOn}>
                {isOn ? '▸ ' : '  '}
                {one.path}
              </Text>
              <Text dimColor> {tag}</Text>
            </Button>
          )
        })}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="accept" hotkey="a" variant="primary" label="Accepteren" onPress={() => acceptChange($, file.absPath)} />
          <Button key="revert" hotkey="r" label="Terugdraaien" onPress={() => revertChange($, file.absPath)} />
          <Button key="prev" hotkey="p" plain label="vorige" onPress={() => moveSelection($, -1)} />
          <Button key="next" hotkey="n" plain label="volgende" onPress={() => moveSelection($, 1)} />
          <Button key="hide" hotkey="h" plain label="verbergen" onPress={() => $.ui.close({ id: DIFF_PANE })} />
        </Box>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text bold>{file.path}</Text>
          {counts !== null && <Text color="success">+{counts.added}</Text>}
          {counts !== null && <Text color="error">-{counts.removed}</Text>}
          {current === null && <Text color="warning">(bestaat niet meer)</Text>}
        </Box>
        {file.isTooLarge && <Text color="warning">Het origineel was te groot om te bewaren.</Text>}
        {lines === null && !file.isTooLarge && <Text color="warning">Te groot om te vergelijken.</Text>}
        {lines !== null && hunks.length === 0 && <Text dimColor>Geen verschil met het origineel.</Text>}
        {hunks.map(hunk => (
          <Box flexDirection="column">
            <Text color="suggestion">{hunk.header}</Text>
            {hunk.lines.map(line => {
              const text = line.text.length > width ? `${line.text.slice(0, width - 1)}…` : line.text
              if (line.kind === 'weg') return <Text color="error">- {text}</Text>
              if (line.kind === 'erbij') return <Text color="success">+ {text}</Text>

              return <Text dimColor>  {text}</Text>
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
