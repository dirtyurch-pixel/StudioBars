import { describe, expect, it } from 'vitest'
import { addTap, barBeat, beatTimes, clampBpm, computePeaks, nearestBeat, tapTempo } from './wave'

describe('computePeaks', () => {
  it('takes the loudest sample per slice across channels, scaled to 1', () => {
    const l = new Float32Array([0.1, -0.2, 0.05, 0.4, 0, 0])
    const r = new Float32Array([0, 0, -0.3, 0, 0, 0.2])
    expect(computePeaks([l, r], 3)).toEqual([0.5, 1, 0.5])
  })
  it('handles silence, empty input and more slices than samples', () => {
    expect(computePeaks([new Float32Array(4)], 2)).toEqual([0, 0])
    expect(computePeaks([], 10)).toEqual([])
    expect(computePeaks([new Float32Array([0.5, 1])], 10)).toEqual([0.5, 1])
  })
})

describe('tap tempo', () => {
  it('needs three taps and uses the median gap', () => {
    expect(tapTempo([0, 500])).toBeNull()
    expect(tapTempo([0, 500, 1000])).toBe(120)
    expect(tapTempo([0, 500, 1000, 1700, 2200, 2700])).toBe(120) // one late tap ignored
  })
  it('folds very slow or very fast taps into range', () => {
    expect(clampBpm(30)).toBe(60)
    expect(clampBpm(300)).toBe(150)
    expect(clampBpm(0)).toBeNull()
  })
  it('starts again after a long pause', () => {
    expect(addTap([0, 500], 1000)).toEqual([0, 500, 1000])
    expect(addTap([0, 500], 5000)).toEqual([5000])
    expect(addTap([], 10)).toEqual([10])
  })
})

describe('beat grid', () => {
  const b = { bpm: 120, offset: 0.25 }
  it('lists beats in a window and marks beat 1 of each bar', () => {
    const got = beatTimes(b, 0, 2.3)
    expect(got.map((x) => x.t)).toEqual([0.25, 0.75, 1.25, 1.75, 2.25])
    expect(got.map((x) => x.bar)).toEqual([true, false, false, false, true])
  })
  it('includes pickup beats before beat 1 but never negative times', () => {
    expect(beatTimes({ bpm: 60, offset: 2.5 }, 0, 2.6).map((x) => x.t)).toEqual([0.5, 1.5, 2.5])
    expect(beatTimes({ bpm: 60, offset: 2.5 }, 0, 2.6).map((x) => x.bar)).toEqual([
      false,
      false,
      true,
    ])
  })
  it('snaps to the nearest beat and reads bar and beat', () => {
    expect(nearestBeat(b, 1.1)).toBe(1.25)
    expect(nearestBeat(b, 0.9)).toBe(0.75)
    expect(barBeat(b, 0.1)).toBeNull()
    expect(barBeat(b, 0.25)).toEqual({ bar: 1, beat: 1 })
    expect(barBeat(b, 2.3)).toEqual({ bar: 2, beat: 1 })
    expect(barBeat(b, 1.8)).toEqual({ bar: 1, beat: 4 })
  })
})
