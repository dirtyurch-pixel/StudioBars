/** Turning analysis results into things to draw. Pure functions, no React. */
import type { AnalyzedWord, LineSyllables, RhymeFamily } from '../types'

export type HighlightMode = 'off' | 'end' | 'all'
export type SyllableDisplay = 'syllables' | 'numbers'
export type Segment = { text: string; family: number | null; guess: boolean }

/**
 * Split a line into plain and highlighted pieces. Positions come from the server and are only
 * trusted when the analysed text is exactly the text now on screen.
 */
export function highlightSegments(
  text: string,
  analysedText: string | undefined,
  words: AnalyzedWord[] | undefined,
  families: RhymeFamily[],
  mode: HighlightMode,
): Segment[] {
  if (!words || analysedText !== text) return [{ text, family: null, guess: false }]
  const out: Segment[] = []
  let pos = 0
  for (const w of words) {
    if (w.start < pos || w.end > text.length) continue
    const fam = w.family
    const inFamily =
      fam !== null &&
      (mode === 'all' || (mode === 'end' && w.is_end && (families[fam]?.end_count ?? 0) >= 2))
    const guess = w.status === 'guess'
    if (!inFamily && !guess) continue
    if (w.start > pos) out.push({ text: text.slice(pos, w.start), family: null, guess: false })
    out.push({ text: text.slice(w.start, w.end), family: inFamily ? fam : null, guess })
    pos = w.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos), family: null, guess: false })
  return out.length ? out : [{ text, family: null, guess: false }]
}

/** The number shown in the margin, with an explanation for hover and screen readers. */
export function syllableLabel(
  s: LineSyllables | undefined,
  words: AnalyzedWord[] = [],
): { text: string; title: string } {
  if (!s) return { text: '·', title: 'Syllables not counted yet' }
  if (s.max === 0) return { text: '', title: 'Empty line' }
  const range = s.min === s.max ? `${s.min}` : `${s.min}–${s.max}`
  const tilde = s.guessed ? '~' : ''
  const parts: string[] = [`Estimated syllables: ${range}.`]
  const ambiguous = words.filter((w) => w.syllables_min !== w.syllables_max && w.status !== 'guess')
  if (ambiguous.length) {
    parts.push(
      `Can be said more than one way: ${ambiguous.map((w) => `${w.text} (${w.syllables_min}–${w.syllables_max})`).join(', ')}.`,
    )
  }
  const guessed = words.filter((w) => w.status === 'guess')
  if (guessed.length) {
    parts.push(`Guessing: ${guessed.map((w) => w.text).join(', ')} (not in the dictionary).`)
  }
  return { text: `${tilde}${range}`, title: parts.join(' ') }
}

/** Last word of a line, for pre-filling the rhyme lookup. */
export function lastWord(text: string): string {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m[m.length - 1].replace(/['’-]+$/, '') : ''
}

/** A single selected word, or '' if the selection is not one word. */
export function singleWord(sel: string): string {
  const t = sel.trim()
  return /^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u.test(t) ? t.replace(/['’-]+$/, '') : ''
}

export const FAMILY_COLOURS = 8
