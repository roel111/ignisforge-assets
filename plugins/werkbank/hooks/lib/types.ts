// Gedeelde typen voor de mods.
import type { RenderInput, ToolCallInput, ToolCallResult } from 'claude-code'

/** Wat een mod aanroept om de tool call door te geven aan de volgende mod. */
export type ToolNext = (e: ToolCallInput) => Promise<ToolCallResult>

/** De band boven de prompt, zoals een mod er een rij in tekent. */
export type BandEvent = RenderInput<'AbovePrompt'>
