/** Pure playback rules: play order, next/previous, and A–B looping. */
import type { RepeatMode } from '../types'

export const SPEEDS = [0.75, 0.85, 1, 1.15, 1.25] as const

/** A play order for `n` items. With shuffle, the current item stays first. */
export function makeOrder(n: number, shuffle: boolean, current = 0, rand = Math.random): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  if (!shuffle || n < 2) return order
  const rest = order.filter((i) => i !== current)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return n > current && current >= 0 ? [current, ...rest] : rest
}

/**
 * Position (in the play order) to play next, or null to stop.
 * `manual` is true for the Next button, false when a track ends by itself.
 */
export function nextPos(
  pos: number,
  length: number,
  repeat: RepeatMode,
  manual: boolean,
): number | null {
  if (length === 0) return null
  if (repeat === 'one' && !manual) return pos
  if (pos + 1 < length) return pos + 1
  return repeat === 'off' ? null : 0
}

/** Previous button: restart the track if it has played a while, otherwise go back. */
export function prevPos(pos: number, length: number, repeat: RepeatMode, elapsed: number): number {
  if (elapsed > 3 || length === 0) return pos
  if (pos > 0) return pos - 1
  return repeat === 'all' ? length - 1 : 0
}

export type Loop = { a: number | null; b: number | null }
export const loopActive = (l: Loop): boolean => l.a !== null && l.b !== null && l.a < l.b

/** Set loop start or end at `time`. Returns an error message instead of an invalid loop. */
export function setLoopPoint(
  l: Loop,
  which: 'a' | 'b',
  time: number,
): { loop: Loop; error?: string } {
  const t = Math.max(0, time)
  if (which === 'a') {
    if (l.b !== null && t >= l.b)
      return { loop: l, error: 'Loop start (A) must come before the end (B).' }
    return { loop: { ...l, a: t } }
  }
  if (l.a !== null && t <= l.a)
    return { loop: l, error: 'Loop end (B) must come after the start (A).' }
  return { loop: { ...l, b: t } }
}

/**
 * Where to jump when playback crosses the end of the loop, or null to carry on.
 * Only a crossing from before B counts, so seeking past B by hand does not snap back.
 */
export function loopJump(l: Loop, previous: number, now: number): number | null {
  if (!loopActive(l)) return null
  const a = l.a as number
  const b = l.b as number
  return previous < b && now >= b ? a : null
}

export function formatTime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '–:––'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac']
export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase()

/** Ask the browser to read the file. Resolves with its length; rejects if it cannot play it. */
export function probeAudio(file: File, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    const done = (fn: () => void) => {
      clearTimeout(timer)
      a.removeAttribute('src')
      URL.revokeObjectURL(url)
      fn()
    }
    const timer = setTimeout(
      () => done(() => reject(new Error('Timed out reading this file.'))),
      timeoutMs,
    )
    a.preload = 'metadata'
    a.onloadedmetadata = () =>
      done(() => resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null))
    a.onerror = () =>
      done(() =>
        reject(
          new Error(
            "This browser can't play that file (it may be damaged or use an unsupported codec).",
          ),
        ),
      )
    a.src = url
  })
}
