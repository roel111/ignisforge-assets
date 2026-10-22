// Mod 4, veiligheidsbewaker: onderschept elke tool call (ook van subagents)
// en weigert riskante commando's voordat ze draaien: rm -rf, force-push,
// databases weggooien, en alles wat .env-bestanden of SSH-sleutels aanraakt.
// Boven de prompt staat dan een rode waarschuwing met "Toch goedkeuren"
// (sneltoets g na ctrl+x tab): dat staat precies dat commando één keer toe en
// vraagt Claude het opnieuw te proberen. Elke blokkade en goedkeuring komt in
// .claude/werkbank-geblokkeerd.log in de projectmap.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallInput } from 'claude-code'

import type { BlockedCall } from '../../types'
import { toolPath } from '../lib/paths'
import type { BandEvent, ToolNext } from '../lib/types'

export const LOG_FILE = '.claude/werkbank-geblokkeerd.log'

const blocked = atom({ plugin: 'werkbank', key: 'blocked' } as const, [])
const approvals = atom({ plugin: 'werkbank', key: 'approvals' } as const, [])

// ── De regels ────────────────────────────────────────────────────────────

const ENV_FILE = /(^|[\s/'"=:<>(`])\.env(\.[\w-]+)*(?=$|[\s'"`;|&)<>])/
const ENV_TEMPLATE = /\.env\.(example|sample|template|dist)\b/
const SSH = /(^|[\s/'"=:~])\.ssh(\/|\b)|\bid_(rsa|dsa|ecdsa|ed25519)(\.pub)?\b|\bauthorized_keys\b/
const DATABASE = [
  { re: /\bdrop\s+(database|schema)\b/i, why: 'verwijdert een database (DROP DATABASE/SCHEMA)' },
  { re: /\bdrop\s+table\b/i, why: 'verwijdert een tabel (DROP TABLE)' },
  { re: /\btruncate\s+(table\s+)?\w/i, why: 'maakt een tabel leeg (TRUNCATE)' },
  { re: /\bdropdb\b/, why: 'verwijdert een PostgreSQL-database (dropdb)' },
  { re: /\bdropDatabase\s*\(/, why: 'verwijdert een MongoDB-database' },
  { re: /\bflush(all|db)\b/i, why: 'leegt een Redis-database (FLUSHALL/FLUSHDB)' },
  { re: /\b(prisma\s+migrate\s+reset|rails\s+db:(drop|reset)|rake\s+db:(drop|reset))\b/, why: 'gooit de database weg en bouwt hem opnieuw op' },
]

/** Splitst een shellregel in losse commando's (op ; && || | en regeleinden). */
const segments = (command: string) =>
  command
    .split(/;|&&|\|\||\||\n/)
    .map(part => part.trim().split(/\s+/).filter(word => word !== ''))
    .filter(words => words.length > 0)

/** Slaat sudo, env-variabelen en dergelijke voor het eigenlijke commando over. */
const program = (words: readonly string[]) => {
  let i = 0
  while (i < words.length && (/^\w+=/.test(words[i] ?? '') || ['sudo', 'doas', 'command', 'exec', 'nohup', 'time'].includes(words[i] ?? ''))) i++

  return { name: (words[i] ?? '').replace(/^.*\//, ''), args: words.slice(i + 1) }
}

/** De reden waarom een Bash-commando riskant is, of undefined. */
export function bashRisk(command: string): string | undefined {
  for (const words of segments(command)) {
    const { name, args } = program(words)
    if (name === 'rm') {
      const flags = args.filter(arg => arg.startsWith('-'))
      const short = flags.filter(flag => !flag.startsWith('--')).join('')
      const isRecursive = /[rR]/.test(short) || flags.includes('--recursive')
      const isForced = short.includes('f') || flags.includes('--force')
      if (isRecursive && isForced) return 'rm -rf verwijdert bestanden recursief en zonder te vragen'
      if (args.some(arg => /\.(sqlite3?|db)$/.test(arg))) return 'verwijdert een databasebestand'
    }
    if (name === 'git' && args.includes('push')) {
      const pushArgs = args.slice(args.indexOf('push') + 1)
      const isForce = pushArgs.some(
        arg =>
          arg === '-f' ||
          arg.startsWith('--force') ||
          (/^-[a-zA-Z]+$/.test(arg) && arg.includes('f')) ||
          (/^\+[^+]/.test(arg) && !arg.startsWith('+=')),
      )
      if (isForce) return 'force-push overschrijft de geschiedenis op de remote'
      if (pushArgs.includes('--mirror') || pushArgs.includes('--delete') || pushArgs.some(arg => /^:/.test(arg))) {
        return 'deze push verwijdert of overschrijft branches op de remote'
      }
    }
  }
  for (const rule of DATABASE) {
    if (rule.re.test(command)) return rule.why
  }
  if (ENV_FILE.test(command.replace(new RegExp(ENV_TEMPLATE, 'g'), ''))) return 'raakt een .env-bestand aan (geheimen)'
  if (SSH.test(command)) return 'raakt SSH-sleutels aan'

  return undefined
}

/** De reden waarom een pad riskant is, of undefined. */
export function pathRisk(path: string): string | undefined {
  const name = path.replace(/^.*\//, '')
  if (/^\.env(\.|$)/.test(name) && !ENV_TEMPLATE.test(name)) return 'raakt een .env-bestand aan (geheimen)'
  if (/(^|\/)\.ssh(\/|$)/.test(path) || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(name) || name === 'authorized_keys') {
    return 'raakt SSH-sleutels aan'
  }

  return undefined
}

type Verdict = { reason: string; summary: string; signature: string }

/** Beoordeelt een tool call; undefined als hij veilig lijkt. */
export function judge(e: ToolCallInput): Verdict | undefined {
  if (e.tool === 'Bash') {
    const reason = bashRisk(e.command)

    return reason === undefined ? undefined : { reason, summary: e.command, signature: `Bash\n${e.command.trim()}` }
  }

  const input = e as unknown as Record<string, unknown>
  const paths = [toolPath(e), input.glob, e.tool === 'Glob' ? input.pattern : undefined].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  for (const path of paths) {
    const reason = pathRisk(path)
    if (reason !== undefined) return { reason, summary: `${e.tool} ${path}`, signature: `${e.tool}\n${paths.join('\n')}` }
  }

  return undefined
}

// ── De hook en de band ───────────────────────────────────────────────────

async function writeLog($: EngineInterface, line: string) {
  const root = await $.session.root()
  const path = `${root}/${LOG_FILE}`
  const before = await $.fs.read(path).catch(() => '')
  await $.fs.write(path, `${before}${line}\n`)
}

const stamp = (ms: number) => new Date(ms).toISOString()

export async function bewakerTool($: EngineInterface, e: ToolCallInput, next: ToolNext) {
  const verdict = judge(e)
  if (verdict === undefined) return next(e)

  const approved = await read($, approvals)
  if (approved.includes(verdict.signature)) {
    await update($, approvals, list => list.filter(one => one !== verdict.signature))
    await writeLog($, `${stamp(await $.clock.now())}\tUITGEVOERD (goedgekeurd)\t${e.tool}\t${verdict.summary.replace(/\s+/g, ' ')}`).catch(() => undefined)

    return next(e)
  }

  const at = await $.clock.now()
  const call: BlockedCall = {
    id: e.tool_use_id,
    tool: e.tool,
    summary: verdict.summary,
    reason: verdict.reason,
    signature: verdict.signature,
    at,
  }
  await update($, blocked, list => [...list.filter(one => one.signature !== call.signature), call].slice(-10))
  await writeLog($, `${stamp(at)}\tGEBLOKKEERD\t${e.tool}\t${verdict.reason}\t${verdict.summary.replace(/\s+/g, ' ')}`).catch(
    (error: unknown) => $.ui.log(`werkbank/bewaker: kon het log niet schrijven: ${String(error)}`, { to: 'debug' }),
  )
  $.ui.toast(`Geblokkeerd: ${verdict.reason}`)

  return {
    deny:
      `Geblokkeerd door de veiligheidsbewaker: ${verdict.reason}. ` +
      'Probeer dit niet te omzeilen. De gebruiker ziet een waarschuwing boven de prompt en kan het daar goedkeuren; ' +
      'wacht daarop of kies een veiligere aanpak.',
  }
}

export async function approveBlocked($: EngineInterface, id: string) {
  const call = (await read($, blocked)).find(one => one.id === id)
  if (call === undefined) return
  await update($, approvals, list => [...list.filter(one => one !== call.signature), call.signature])
  await update($, blocked, list => list.filter(one => one.id !== id))
  await writeLog($, `${stamp(await $.clock.now())}\tGOEDGEKEURD\t${call.tool}\t${call.summary.replace(/\s+/g, ' ')}`).catch(() => undefined)
  await $.prompt.submit({
    text:
      `Ik keur het geblokkeerde ${call.tool}-commando goed:\n\n${call.summary}\n\n` +
      'Voer het nu precies zo opnieuw uit (zelfde commando of pad), dan laat de veiligheidsbewaker het één keer door.',
  })
}

export async function dismissBlocked($: EngineInterface, id: string) {
  await update($, blocked, list => list.filter(one => one.id !== id))
}

export async function bewakerBand($: EngineInterface, e: BandEvent) {
  const list = await read($, blocked)
  if (list.length === 0) return null

  const { Box, Button, Text } = $.ui.resolve(e)
  const width = Math.max(20, e.props.bodyColumns - 4)
  const newest = list.at(-1)?.id

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
      {list.map(call => {
        const isNewest = call.id === newest
        const shown = call.summary.replace(/\s+/g, ' ')

        return (
          <Box flexDirection="column">
            <Text color="error" bold>
              ⚠ Veiligheidsbewaker blokkeerde {call.tool}: {call.reason}
            </Text>
            <Text wrap="truncate-end">  {shown.length > width ? `${shown.slice(0, width - 1)}…` : shown}</Text>
            <Box flexDirection="row" gap={1}>
              <Button
                key={`approve:${call.id}`}
                hotkey={isNewest ? 'g' : undefined}
                variant="primary"
                label="Toch goedkeuren"
                onPress={() => approveBlocked($, call.id)}
              />
              <Button
                key={`dismiss:${call.id}`}
                hotkey={isNewest ? 'x' : undefined}
                label="Negeren"
                onPress={() => dismissBlocked($, call.id)}
              />
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
