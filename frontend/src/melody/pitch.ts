/** Pitch and note helpers for the melody sketchpad. Pure functions so they can be tested with synthetic sounds. */

export const MIDI_LOW = 36 // C2
export const MIDI_HIGH = 96 // C7
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const midiName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
export const freqToMidi = (f: number) => Math.round(69 + 12 * Math.log2(f / 440))
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/**
 * Estimate the pitch of a short mono sound (autocorrelation). Returns null for silence, noise or anything
 * without a clear single pitch. Voices and hums are monophonic, so that is all this tries to handle.
 */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  minHz = 70,
  maxHz = 1000,
): number | null {
  const n = buf.length
  let rms = 0
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / n)
  if (rms < 0.01) return null
  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.min(Math.floor(sampleRate / minHz), n >> 1)
  if (maxLag <= minLag + 2) return null
  const corr = new Float32Array(maxLag + 2)
  let energy0 = 0
  for (let i = 0; i < n - maxLag; i++) energy0 += buf[i] * buf[i]
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let c = 0
    let e = 0
    for (let i = 0; i < n - maxLag; i++) {
      c += buf[i] * buf[i + lag]
      e += buf[i + lag] * buf[i + lag]
    }
    corr[lag] = c / (Math.sqrt(energy0 * e) || 1)
  }
  // take the FIRST strong peak, not the highest (the highest can be a whole multiple of the real period)
  let best = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] > 0.85 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      best = lag
      break
    }
  }
  if (best < 0) return null
  const a = corr[best - 1]
  const b = corr[best]
  const c = corr[best + 1]
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1) // parabolic refinement between samples
  return sampleRate / (best + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0))
}

export type Frame = { t: number; midi: number | null }
export type Note = { start16: number; len16: number; midi: number }

/** Turn a stream of pitch readings (time in ms) into tidy notes on a 16th-note grid at `bpm`. */
export function framesToNotes(frames: Frame[], bpm: number, minMs = 90): Note[] {
  if (frames.length === 0) return []
  // a 3-point median removes single-frame glitches
  const med = frames.map((f, i) => {
    const w = [frames[i - 1]?.midi, f.midi, frames[i + 1]?.midi]
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b)
    return { t: f.t, midi: f.midi == null || w.length < 2 ? null : w[Math.floor(w.length / 2)] }
  })
  const step =
    frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 30
  const sixteenth = 60000 / bpm / 4
  const runs: { start: number; end: number; midi: number }[] = []
  for (const f of med) {
    if (f.midi == null) continue
    const last = runs[runs.length - 1]
    if (last && last.midi === f.midi && f.t - last.end <= step * 2) last.end = f.t + step
    else runs.push({ start: f.t, end: f.t + step, midi: f.midi })
  }
  const t0 = frames[0].t
  const notes: Note[] = []
  let cursor = 0
  for (const r of runs) {
    if (r.end - r.start < minMs) continue
    const midi = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, r.midi))
    const start16 = Math.max(cursor, Math.round((r.start - t0) / sixteenth))
    const end16 = Math.max(start16 + 1, Math.round((r.end - t0) / sixteenth))
    if (start16 >= 64 * 16) break
    const len16 = Math.min(end16 - start16, 64 * 16 - start16, 64)
    notes.push({ start16, len16, midi })
    cursor = start16 + len16
  }
  return notes
}

/** Plain-words comparison of how many syllables there are against how many notes the sketch has. */
export function fitReport(syllables: number, notes: number): string {
  if (syllables === 0) return 'Write some lyrics in this section first.'
  if (notes === 0)
    return `There are about ${plural(syllables, 'syllable')}. The sketch has no notes yet.`
  if (notes === syllables)
    return `${plural(syllables, 'syllable')} and ${plural(notes, 'note')}: one note for each syllable.`
  if (notes > syllables)
    return `About ${plural(syllables, 'syllable')} but ${plural(notes, 'note')}: ${notes - syllables} extra, so some syllables would be stretched over more than one note (a melisma), or the melody has room to breathe.`
  return `About ${plural(syllables, 'syllable')} but only ${plural(notes, 'note')}: ${plural(syllables - notes, 'syllable')} would need to share notes, or the melody needs more notes. Syllable counts are estimates.`
}
