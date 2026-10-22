// Paden uit tool calls halen en relatief maken.
import type { ToolCallInput } from 'claude-code'

/** Het bestand waar een tool call over gaat, als die er één noemt. */
export function toolPath(e: ToolCallInput): string | undefined {
  const input = e as unknown as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }

  return undefined
}

/** Het pad relatief aan `root`, of ongewijzigd als het daarbuiten ligt. */
export function relativeTo(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  if (path.startsWith(base)) return path.slice(base.length)
  if (path.startsWith('./')) return path.slice(2)

  return path
}

/** Absoluut pad: een relatief pad wordt aan `root` gehangen. */
export function absoluteFrom(root: string, path: string): string {
  if (path.startsWith('/')) return path
  const base = root.endsWith('/') ? root : `${root}/`

  return base + (path.startsWith('./') ? path.slice(2) : path)
}
