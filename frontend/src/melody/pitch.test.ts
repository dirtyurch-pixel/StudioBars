import { describe, expect, it } from 'vitest'
import { detectPitch, fitReport, framesToNotes, freqToMidi, midiName, midiToFreq } from './pitch'

const sr = 44100
const sine = (f: number, n = 4096, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr))
const rich = (f: number, n = 4096) =>
  Float32Array.from(
    { length: n },
    (_, i) =>
      0.4 * Math.sin((2 * Math.PI * f * i) / sr) +
      0.2 * Math.sin((2 * Math.PI * 2 * f * i) / sr) +
      0.1 * Math.sin((2 * Math.PI * 3 * f * i) / sr),
  )

describe('pitch detection', () => {
  it.each([110, 196, 261.63, 440, 659.25])('finds %s Hz within a few cents', (f) => {
    const got = detectPitch(sine(f), sr)!
    expect(Math.abs(1200 * Math.log2(got / f))).toBeLessThan(15)
  })

  it('finds the real pitch of a voice-like sound with overtones (not an octave off)', () => {
    const got = detectPitch(rich(220), sr)!
    expect(Math.abs(1200 * Math.log2(got / 220))).toBeLessThan(20)
  })

  it('says nothing for silence and for noise', () => {
    expect(detectPitch(new Float32Array(4096), sr)).toBeNull()
    let seed = 1
    const noise = Float32Array.from({ length: 4096 }, () => {
      seed = (seed * 16807) % 2147483647
      return (seed / 2147483647 - 0.5) * 0.8
    })
    expect(detectPitch(noise, sr)).toBeNull()
  })

  it('names notes', () => {
    expect(freqToMidi(440)).toBe(69)
    expect(midiName(69)).toBe('A4')
    expect(midiName(60)).toBe('C4')
    expect(midiName(61)).toBe('C#4')
    expect(midiToFreq(69)).toBeCloseTo(440)
  })
})

describe('turning a hum into notes', () => {
  const run = (midi: number | null, ms: number, t0: number, step = 30) =>
    Array.from({ length: Math.round(ms / step) }, (_, i) => ({ t: t0 + i * step, midi }))

  it('makes one note per steady stretch on the 16th grid', () => {
    // at 120 BPM a 16th is 125 ms
    const frames = [...run(60, 500, 0), ...run(null, 120, 500), ...run(64, 500, 620)]
    const notes = framesToNotes(frames, 120)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({ start16: 0, midi: 60 })
    expect(notes[0].len16).toBe(4)
    expect(notes[1].midi).toBe(64)
    expect(notes[1].start16).toBeGreaterThanOrEqual(notes[0].start16 + notes[0].len16)
  })

  it('ignores a one-frame glitch and very short blips', () => {
    const frames = [
      ...run(60, 300, 0),
      { t: 300, midi: 72 },
      ...run(60, 300, 330),
      ...run(67, 40, 700),
    ]
    const notes = framesToNotes(frames, 120)
    expect(notes).toHaveLength(1)
    expect(notes[0].midi).toBe(60)
  })

  it('never overlaps notes and keeps pitches in range', () => {
    const notes = framesToNotes([...run(20, 400, 0), ...run(110, 400, 400)], 90)
    for (let i = 1; i < notes.length; i++)
      expect(notes[i].start16).toBeGreaterThanOrEqual(notes[i - 1].start16 + notes[i - 1].len16)
    expect(notes.every((n) => n.midi >= 36 && n.midi <= 96)).toBe(true)
  })

  it('gives nothing for silence', () => {
    expect(framesToNotes(run(null, 1000, 0), 90)).toEqual([])
    expect(framesToNotes([], 90)).toEqual([])
  })
})

describe('lyric to melody fit', () => {
  it('describes the match in plain words', () => {
    expect(fitReport(0, 4)).toMatch(/Write some lyrics/)
    expect(fitReport(8, 0)).toMatch(/no notes yet/)
    expect(fitReport(8, 8)).toMatch(/one note for each/)
    expect(fitReport(8, 11)).toMatch(/3 extra/)
    expect(fitReport(8, 5)).toMatch(/3 syllables would need to share/)
  })
})
