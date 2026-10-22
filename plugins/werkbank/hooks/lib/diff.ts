// Regel-diff (Myers, O(ND)) en het groeperen in hunks met context.

export type DiffLine = { kind: 'zelfde' | 'weg' | 'erbij'; text: string; oldNo?: number; newNo?: number }
export type Hunk = { header: string; lines: DiffLine[] }

const MAX_LINES = 20000

const splitLines = (text: string): string[] => {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()

  return lines
}

/** Alle regels van oud naar nieuw, of null als de bestanden te groot zijn. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length + b.length > MAX_LINES) return null

  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  let v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(next)
        v = next
        break outer
      }
    }
    v = next
  }

  // Terug door de sporen lopen.
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d] ?? new Int32Array(0)
    const k = x - y
    const down = k === -d || (k !== d && (vd[offset + k - 1] ?? 0) < (vd[offset + k + 1] ?? 0))
    const prevK = down ? k + 1 : k - 1
    const prevX = vd[offset + prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      out.push({ kind: 'zelfde', text: a[x] ?? '', oldNo: x + 1, newNo: y + 1 })
    }
    if (d === 0) break
    if (down) {
      y--
      out.push({ kind: 'erbij', text: b[y] ?? '', newNo: y + 1 })
    } else {
      x--
      out.push({ kind: 'weg', text: a[x] ?? '', oldNo: x + 1 })
    }
  }
  while (x > 0 && y > 0) {
    x--
    y--
    out.push({ kind: 'zelfde', text: a[x] ?? '', oldNo: x + 1, newNo: y + 1 })
  }

  return out.reverse()
}

/** Groepeert een diff in hunks met `context` regels eromheen. */
export function toHunks(lines: readonly DiffLine[], context = 3): Hunk[] {
  const changed = lines.map((line, i) => (line.kind === 'zelfde' ? -1 : i)).filter(i => i >= 0)
  const hunks: Hunk[] = []
  let i = 0
  while (i < changed.length) {
    const first = changed[i] ?? 0
    let last = first
    while (i + 1 < changed.length && (changed[i + 1] ?? 0) - last <= context * 2 + 1) {
      i++
      last = changed[i] ?? last
    }
    i++
    const from = Math.max(0, first - context)
    const to = Math.min(lines.length - 1, last + context)
    const part = lines.slice(from, to + 1)
    const oldStart = part.find(line => line.oldNo !== undefined)?.oldNo ?? 0
    const newStart = part.find(line => line.newNo !== undefined)?.newNo ?? 0
    const oldCount = part.filter(line => line.kind !== 'erbij').length
    const newCount = part.filter(line => line.kind !== 'weg').length
    hunks.push({ header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: part })
  }

  return hunks
}

/** Telt toegevoegde en verwijderde regels. */
export function countChanges(lines: readonly DiffLine[]) {
  return {
    added: lines.filter(line => line.kind === 'erbij').length,
    removed: lines.filter(line => line.kind === 'weg').length,
  }
}
