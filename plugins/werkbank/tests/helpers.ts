// Gedeelde stukken voor de tests.
import type { CommandRunInput } from 'claude-code'

export const command = (name: string, args = ''): CommandRunInput => ({
  command: name,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
})
