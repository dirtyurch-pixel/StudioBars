// Waveform peaks and beat-marker maths for the music player. Pure functions, easy to test.

export type Beats = { bpm: number; offset: number }
export const MIN_BPM = 40
export const MAX_BPM = 240
export const BEATS_PER_BAR = 4
/** Bigger files are not drawn: decoding them would use too much memory on a phone. */
export const MAX_WAVE_BYTES = 80 * 1024 * 1024

/** Loudest sample in each of `buckets` equal slices, across all channels, scaled so the loudest is 1. */
export function computePeaks(channels: Float32Array[], buckets: number): number[] {
  const len = channels[0]?.length ?? 0
  if (!len || buckets < 1) return []
  const n = Math.min(buckets, len)
  const out = new Array<number>(n).fill(0)
  for (let b = 0; b < n; b++) {
    const start = Math.floor((b * len) / n)
    const end = Math.max(start + 1, Math.floor(((b + 1) * len) / n))
    let m = 0
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(ch[i])
        if (v > m) m = v
      }
    }
    out[b] = m
  }
  const top = Math.max(...out)
  return top > 0 ? out.map((v) => v / top) : out
}

/** Taps (in ms) closer together than this start a fresh count. */
export const TAP_RESET_MS = 2000

/**
 * Tempo from the last few taps (ms timestamps, oldest first). Uses the median gap so one sloppy tap
 * does not throw it off. Needs at least 3 taps (2 gaps). Returns null when it cannot tell.
 */
export function tapTempo(taps: number[]): number | null {
  const recent = taps.slice(-9)
  const gaps: number[] = []
  for (let i = 1; i < recent.length; i++) gaps.push(recent[i] - recent[i - 1])
  if (gaps.length < 2 || gaps.some((g) => g <= 0)) return null
  gaps.sort((a, b) => a - b)
  const mid = gaps.length >> 1
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
  return clampBpm(60000 / median)
}

/** Keep a tempo in range, folding halves and doubles in (a tap on every other beat still works). */
export function clampBpm(bpm: number): number | null {
  if (!Number.isFinite(bpm) || bpm <= 0) return null
  let v = bpm
  while (v < MIN_BPM) v *= 2
  while (v > MAX_BPM) v /= 2
  return Math.round(v * 10) / 10
}

/** Add a tap, dropping old ones when there was a long pause. */
export function addTap(taps: number[], now: number): number[] {
  const last = taps[taps.length - 1]
  return last !== undefined && now - last <= TAP_RESET_MS ? [...taps, now].slice(-9) : [now]
}

/** Beat times between `from` and `to` seconds. `bar` is true on beat 1 of each bar. */
export function beatTimes(
  b: Beats,
  from: number,
  to: number,
  limit = 2000,
): { t: number; bar: boolean }[] {
  const step = 60 / b.bpm
  if (!(step > 0) || to <= from) return []
  const out: { t: number; bar: boolean }[] = []
  let k = Math.ceil((from - b.offset) / step - 1e-9)
  for (; out.length < limit; k++) {
    const t = b.offset + k * step
    if (t > to + 1e-9) break
    if (t >= 0) out.push({ t, bar: ((k % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0 })
  }
  return out
}

/** The beat closest to `t` (for snapping loop points). */
export function nearestBeat(b: Beats, t: number): number {
  const step = 60 / b.bpm
  const v = b.offset + Math.round((t - b.offset) / step) * step
  return Math.max(0, Math.round(v * 1000) / 1000)
}

/** Bar and beat (both from 1) at time `t`, or null before beat 1. */
export function barBeat(b: Beats, t: number): { bar: number; beat: number } | null {
  if (t < b.offset - 1e-6) return null
  const k = Math.floor((t - b.offset) / (60 / b.bpm) + 1e-6)
  return { bar: Math.floor(k / BEATS_PER_BAR) + 1, beat: (k % BEATS_PER_BAR) + 1 }
}
