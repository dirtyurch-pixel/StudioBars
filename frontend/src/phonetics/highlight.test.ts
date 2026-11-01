import { describe, expect, it } from 'vitest'
import type { AnalyzedWord, RhymeFamily } from '../types'
import { highlightSegments, lastWord, singleWord, syllableLabel } from './highlight'

const w = (text: string, start: number, o: Partial<AnalyzedWord> = {}): AnalyzedWord => ({
  text,
  start,
  end: start + text.length,
  status: 'known',
  syllables_min: 1,
  syllables_max: 1,
  is_end: false,
  family: null,
  ...o,
}) // fmt: skip
const fams: RhymeFamily[] = [
  { id: 0, sound: 'eɪd', size: 3, end_count: 2 },
  { id: 1, sound: 'aɪt', size: 2, end_count: 1 },
]
const text = 'I made the grade'
const words = [
  w('I', 0),
  w('made', 2, { family: 0 }),
  w('the', 7),
  w('grade', 11, { family: 0, is_end: true }),
]

describe('highlightSegments', () => {
  it('splits the line without losing or changing any text', () => {
    for (const mode of ['off', 'end', 'all'] as const) {
      const segs = highlightSegments(text, text, words, fams, mode)
      expect(segs.map((s) => s.text).join('')).toBe(text)
    }
  })
  it('colours nothing when highlights are off', () => {
    expect(highlightSegments(text, text, words, fams, 'off').every((s) => s.family === null)).toBe(
      true,
    )
  })
  it('end mode colours only line-end words whose family has two or more line ends', () => {
    const segs = highlightSegments(text, text, words, fams, 'end')
    expect(segs.filter((s) => s.family !== null).map((s) => s.text)).toEqual(['grade'])
    const lonely = [w('light', 0, { family: 1, is_end: true })]
    expect(
      highlightSegments('light', 'light', lonely, fams, 'end').every((s) => s.family === null),
    ).toBe(true)
  })
  it('all mode also colours internal rhymes', () => {
    const segs = highlightSegments(text, text, words, fams, 'all')
    expect(segs.filter((s) => s.family !== null).map((s) => s.text)).toEqual(['made', 'grade'])
  })
  it('marks guessed words even when colours are off', () => {
    const g = [w('zorblax', 0, { status: 'guess' })]
    const segs = highlightSegments('zorblax', 'zorblax', g, fams, 'off')
    expect(segs).toEqual([{ text: 'zorblax', family: null, guess: true }])
  })
  it('ignores analysis for text that has since changed', () => {
    const segs = highlightSegments('I made the grades', text, words, fams, 'all')
    expect(segs).toEqual([{ text: 'I made the grades', family: null, guess: false }])
    expect(highlightSegments('abc', undefined, undefined, fams, 'all')).toHaveLength(1)
  })
  it('copes with emoji, accents and overlapping or out-of-range positions', () => {
    const t = 'café 🎤 made'
    const ws = [
      w('made', 8, { family: 0, is_end: true }),
      w('oops', 90, { family: 0 }),
      w('bad', 3, { family: 0 }),
    ]
    const segs = highlightSegments(t, t, ws, fams, 'all')
    expect(segs.map((s) => s.text).join('')).toBe(t)
  })
})

describe('syllableLabel', () => {
  const ok = { min: 9, max: 9, exact: true, guessed: false }
  it('shows a plain number when it is certain', () => {
    expect(syllableLabel(ok).text).toBe('9')
  })
  it('shows a range and explains which words cause it', () => {
    const l = syllableLabel({ min: 5, max: 6, exact: false, guessed: false }, [
      w('every', 0, { syllables_min: 2, syllables_max: 3 }),
    ])
    expect(l.text).toBe('5–6')
    expect(l.title).toMatch(/every \(2–3\)/)
  })
  it('puts ~ in front of guesses and names the guessed words', () => {
    const l = syllableLabel({ min: 8, max: 8, exact: true, guessed: true }, [
      w('zorblax', 0, { status: 'guess' }),
    ])
    expect(l.text).toBe('~8')
    expect(l.title).toMatch(/Guessing: zorblax/)
  })
  it('handles empty lines and not-yet-counted lines', () => {
    expect(syllableLabel({ min: 0, max: 0, exact: true, guessed: false }).text).toBe('')
    expect(syllableLabel(undefined).text).toBe('·')
  })
})

describe('word picking', () => {
  it('finds the last word of a line', () => {
    expect(lastWord('I wrote your name in steam, then watched it fade!')).toBe('fade')
    expect(lastWord("runnin' ")).toBe('runnin')
    expect(lastWord('niño 🎤')).toBe('niño')
    expect(lastWord('...')).toBe('')
    expect(lastWord('')).toBe('')
  })
  it('accepts a selection only if it is one word', () => {
    expect(singleWord(' fade ')).toBe('fade')
    expect(singleWord("don't")).toBe("don't")
    expect(singleWord('two words')).toBe('')
    expect(singleWord('')).toBe('')
    expect(singleWord('!!')).toBe('')
  })
})
