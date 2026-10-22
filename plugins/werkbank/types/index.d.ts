// Contract van de werkbank-plugin: elke waarde die een mod in $.state bewaart.

/** Bestandsboom: wat Claude met een bestand deed. */
export type FileMark = 'gelezen' | 'bewerkt' | 'nieuw'

/** Diff-paneel: één gewijzigd bestand van deze sessie. */
export type ChangedFile = {
  /** Pad relatief aan de projectroot. */
  path: string
  /** Absoluut pad, zoals de tool het kreeg. */
  absPath: string
  /** Inhoud vóór de eerste wijziging; null als het bestand nieuw is. */
  original: string | null
  /** True als het origineel te groot was om te bewaren. */
  isTooLarge: boolean
  /** Aantal tool calls dat dit bestand wijzigde. */
  edits: number
}

/** Veiligheidsbewaker: één geblokkeerde tool call die op de gebruiker wacht. */
export type BlockedCall = {
  id: string
  tool: string
  /** Korte weergave van het commando of pad. */
  summary: string
  reason: string
  /** Handtekening van tool + input, waarmee een goedkeuring één keer geldt. */
  signature: string
  at: number
}

/** Agent-tijdlijn: één stap. */
export type TimelineStep = {
  id: string
  kind: 'prompt' | 'tool' | 'subagent' | 'model'
  label: string
  startedAt: number
  endedAt: number | null
  status: 'bezig' | 'ok' | 'fout'
  details: string
  /** Subagent waarin de stap liep; afwezig voor de hoofdlus. */
  agentId?: string
}

declare module 'claude-code' {
  interface PluginState {
    werkbank: {
      // 1. Tool-teller
      toolCount: number
      // 2. Bestandsboom
      treeFiles: string[]
      treeMarks: Record<string, FileMark>
      treeOnlyTouched: boolean
      // 3. Diff-paneel
      changes: ChangedFile[]
      diffSelected: string | null
      // 4. Veiligheidsbewaker
      blocked: BlockedCall[]
      approvals: string[]
      // 5. Agent-tijdlijn
      timeline: TimelineStep[]
      timelineSelected: string | null
      // 6. Statusbalk
      barTick: number
      barTools: number
      barEdited: string[]
    }
  }
}
