import { describe, expect, it } from 'vitest'
import type { SyllableInfo } from '../types'
import { clickTimes, density, evenGrid, fitGrid, place, resubdivide, toggleRest } from './flow'

const syl = (stress: SyllableInfo['stress'][]): SyllableInfo[] =>
  stress.map((s, i) => ({ word: 'w' + i, word_index: i, stress: s, first: true, guess: false }))

describe('flow grid', () => {
  it('spreads syllables evenly without two on one slot', () => {
    const g = evenGrid(4)
    expect(g.assign).toEqual([0, 4, 8, 12])
    const crowded = evenGrid(20, '8th')
    const placed = crowded.assign.filter((a) => a !== null)
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('placing on an occupied slot sends the other syllable back to unplaced', () => {
    const g = place(evenGrid(4), 1, 8)
    expect(g.assign).toEqual([0, 8, null, 12])
  })

  it('a rest can only go on an empty slot and clears when a syllable lands there', () => {
    let g = evenGrid(2)
    expect(toggleRest(g, 0)).toBe(g)
    g = toggleRest(g, 3)
    expect(g.rests).toEqual([3])
    expect(place(g, 0, 3).rests).toEqual([])
    expect(toggleRest(g, 3).rests).toEqual([])
  })

  it('changing subdivision keeps the same place in the bar and never doubles up', () => {
    const g = resubdivide(evenGrid(4, '16th'), 'triplet')
    expect(g.assign).toEqual([0, 3, 6, 9])
    const tight = resubdivide(
      { ...evenGrid(0), assign: [0, 1, 2, 3], accents: [false, false, false, false] },
      '8th',
    )
    const vals = tight.assign.filter((a) => a !== null)
    expect(new Set(vals).size).toBe(vals.length)
  })

  it('two bars doubles the slots', () => {
    expect(resubdivide(evenGrid(2), '16th', 2).bars).toBe(2)
    expect(evenGrid(2, '16th', 2).assign).toEqual([0, 16])
  })

  it('fits the grid to a changed syllable count', () => {
    const g = fitGrid(evenGrid(4), 6)
    expect(g.assign.length).toBe(6)
    expect(g.assign.slice(4)).toEqual([null, null])
    expect(fitGrid(evenGrid(4), 2).assign).toEqual([0, 4])
  })

  it('density counts per bar and stressed syllables off the beat', () => {
    const g = { ...evenGrid(0), assign: [0, 3, 4, 17], accents: [], rests: [], bars: 2 }
    const d = density(g, syl([1, 1, 0, 1]))
    expect(d.perBar).toEqual([3, 1])
    expect(d.placed).toBe(4)
    expect(d.stressedOffBeat).toBe(2) // slot 3 and slot 17 (17 % 16 = 1) are off the 4-slot beats
  })

  it('metronome clicks are evenly spaced with the bar accented', () => {
    const c = clickTimes(120, 1)
    expect(c.map((x) => x.t)).toEqual([0, 0.5, 1, 1.5])
    expect(c.map((x) => x.accent)).toEqual([true, false, false, false])
    expect(clickTimes(60, 2, 2)).toHaveLength(16)
  })
})
