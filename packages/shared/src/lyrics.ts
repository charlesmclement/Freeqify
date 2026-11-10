/** Public lyrics only. Provider requests and catalog lookups remain server-side. */
export interface LyricLine { time: number; text: string }
export type LyricsResult =
  | { status: 'synced' | 'plain'; provider: 'LRCLIB'; recordId: number; lines: LyricLine[]; text: string }
  | { status: 'missing' | 'instrumental' | 'disabled' | 'unavailable' };
