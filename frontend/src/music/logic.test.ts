import { describe, expect, it } from 'vitest'
import {
  formatTime,
  loopActive,
  loopJump,
  makeOrder,
  nextPos,
  prevPos,
  setLoopPoint,
} from './logic'

describe('play order', () => {
  it('is simply in order without shuffle', () => {
    expect(makeOrder(4, false)).toEqual([0, 1, 2, 3])
  })
  it('shuffles every track exactly once and keeps the current track first', () => {
    for (let cur = 0; cur < 5; cur++) {
      const o = makeOrder(5, true, cur)
      expect(o[0]).toBe(cur)
      expect([...o].sort()).toEqual([0, 1, 2, 3, 4])
    }
  })
  it('is deterministic for a given random source', () => {
    const seq = [0.1, 0.9, 0.5, 0.3]
    let i = 0
    const rand = () => seq[i++ % seq.length]
    expect(makeOrder(5, true, 0, rand)).toEqual(
      makeOrder(
        5,
        true,
        0,
        (
          (j = 0) =>
          () =>
            seq[j++ % seq.length]
        )(),
      ),
    )
  })
  it('handles empty and single lists', () => {
    expect(makeOrder(0, true)).toEqual([])
    expect(makeOrder(1, true)).toEqual([0])
  })
})

describe('next / previous', () => {
  it('goes to the next track, and stops at the end when repeat is off', () => {
    expect(nextPos(0, 3, 'off', false)).toBe(1)
    expect(nextPos(2, 3, 'off', false)).toBeNull()
    expect(nextPos(2, 3, 'off', true)).toBeNull()
  })
  it('repeat all wraps around', () => {
    expect(nextPos(2, 3, 'all', false)).toBe(0)
    expect(nextPos(2, 3, 'all', true)).toBe(0)
  })
  it('repeat one replays when a track ends but Next still moves on', () => {
    expect(nextPos(1, 3, 'one', false)).toBe(1)
    expect(nextPos(1, 3, 'one', true)).toBe(2)
  })
  it('an empty list never plays', () => {
    expect(nextPos(0, 0, 'all', false)).toBeNull()
  })
  it('previous restarts after a few seconds, otherwise goes back', () => {
    expect(prevPos(2, 5, 'off', 10)).toBe(2)
    expect(prevPos(2, 5, 'off', 1)).toBe(1)
    expect(prevPos(0, 5, 'off', 1)).toBe(0)
    expect(prevPos(0, 5, 'all', 1)).toBe(4)
  })
})

describe('A–B loop', () => {
  it('only counts as a loop when both points are set and A is before B', () => {
    expect(loopActive({ a: 1, b: 2 })).toBe(true)
    expect(loopActive({ a: 1, b: null })).toBe(false)
    expect(loopActive({ a: null, b: 2 })).toBe(false)
    expect(loopActive({ a: 3, b: 3 })).toBe(false)
  })
  it('rejects A after B and B before A with a message, keeping the old loop', () => {
    const l = { a: 2, b: 5 }
    const bad1 = setLoopPoint(l, 'a', 6)
    expect(bad1.error).toMatch(/before/)
    expect(bad1.loop).toEqual(l)
    const bad2 = setLoopPoint(l, 'b', 1)
    expect(bad2.error).toMatch(/after/)
    expect(bad2.loop).toEqual(l)
    expect(setLoopPoint(l, 'b', 2).error).toBeTruthy() // equal is invalid too
  })
  it('accepts valid points and clamps negatives', () => {
    expect(setLoopPoint({ a: null, b: null }, 'a', 3).loop).toEqual({ a: 3, b: null })
    expect(setLoopPoint({ a: 3, b: null }, 'b', 8).loop).toEqual({ a: 3, b: 8 })
    expect(setLoopPoint({ a: null, b: null }, 'a', -4).loop.a).toBe(0)
  })
  it('jumps back to A when playback crosses B', () => {
    const l = { a: 2, b: 5 }
    expect(loopJump(l, 4.9, 5.05)).toBe(2)
    expect(loopJump(l, 3, 4)).toBeNull()
  })
  it('does not snap back when the user seeks past B by hand', () => {
    expect(loopJump({ a: 2, b: 5 }, 8, 8.2)).toBeNull()
  })
  it('does nothing without a valid loop', () => {
    expect(loopJump({ a: 2, b: null }, 1, 9)).toBeNull()
  })
})

describe('formatTime', () => {
  it('formats minutes, hours and bad values', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(75.9)).toBe('1:15')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(null)).toBe('–:––')
    expect(formatTime(NaN)).toBe('–:––')
  })
})
