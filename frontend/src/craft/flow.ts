import { SLOTS_PER_BAR, type FlowGrid, type Subdivision, type SyllableInfo } from '../types'

export const slotCount = (g: Pick<FlowGrid, 'subdivision' | 'bars'>) =>
  SLOTS_PER_BAR[g.subdivision] * g.bars

/** A starting grid: syllables spread evenly across the line. The writer then moves them by hand. */
export function evenGrid(n: number, subdivision: Subdivision = '16th', bars = 1): FlowGrid {
  const slots = SLOTS_PER_BAR[subdivision] * bars
  const assign: (number | null)[] = []
  for (let i = 0; i < n; i++)
    assign.push(Math.min(slots - 1, Math.floor((i * slots) / Math.max(n, 1))))
  // spreading can collide when there are more syllables than slots: keep what fits
  const used = new Set<number>()
  return {
    subdivision,
    bars,
    assign: assign.map((a) => {
      if (a === null || used.has(a)) return null
      used.add(a)
      return a
    }),
    accents: Array(n).fill(false),
    rests: [],
  }
}

/** Keep the grid lined up with the line's current syllable count (extra slots dropped, new ones empty). */
export function fitGrid(g: FlowGrid, n: number): FlowGrid {
  const assign = g.assign.slice(0, n)
  while (assign.length < n) assign.push(null)
  const accents = g.accents.slice(0, n)
  while (accents.length < n) accents.push(false)
  return { ...g, assign, accents }
}

/** Move syllable `i` to `slot`. Anything already there is sent to "unplaced". Returns a new grid. */
export function place(g: FlowGrid, i: number, slot: number | null): FlowGrid {
  const assign = g.assign.slice()
  if (slot !== null) {
    const other = assign.indexOf(slot)
    if (other >= 0) assign[other] = null
  }
  assign[i] = slot
  return { ...g, assign, rests: g.rests.filter((r) => r !== slot) }
}

export function toggleRest(g: FlowGrid, slot: number): FlowGrid {
  if (g.assign.includes(slot)) return g
  return {
    ...g,
    rests: g.rests.includes(slot)
      ? g.rests.filter((r) => r !== slot)
      : [...g.rests, slot].sort((a, b) => a - b),
  }
}

/** Change subdivision: keep each syllable at the same point in the bar where possible. */
export function resubdivide(g: FlowGrid, subdivision: Subdivision, bars = g.bars): FlowGrid {
  const from = slotCount(g)
  const to = SLOTS_PER_BAR[subdivision] * bars
  const used = new Set<number>()
  const assign = g.assign.map((a) => {
    if (a === null) return null
    let s = Math.min(to - 1, Math.round((a / from) * to))
    while (used.has(s) && s < to - 1) s++
    if (used.has(s)) return null
    used.add(s)
    return s
  })
  return { ...g, subdivision, bars, assign, rests: [] }
}

export type Density = { perBar: number[]; placed: number; total: number; stressedOffBeat: number }

/** Estimates only: syllables per bar, and stressed syllables that land off the main beats. */
export function density(g: FlowGrid, syl: SyllableInfo[]): Density {
  const per = SLOTS_PER_BAR[g.subdivision]
  const perBar = Array(g.bars).fill(0) as number[]
  let placed = 0
  let off = 0
  const beat = per / 4
  g.assign.forEach((a, i) => {
    if (a === null) return
    placed++
    perBar[Math.floor(a / per)]++
    if (syl[i]?.stress === 1 && (a % per) % beat !== 0) off++
  })
  return { perBar, placed, total: g.assign.length, stressedOffBeat: off }
}

/** Schedule metronome clicks: one per beat, the first of each bar accented. Pure so it can be tested. */
export function clickTimes(bpm: number, bars: number, loops = 1): { t: number; accent: boolean }[] {
  const spb = 60 / bpm
  const out: { t: number; accent: boolean }[] = []
  for (let i = 0; i < bars * 4 * loops; i++) out.push({ t: i * spb, accent: i % 4 === 0 })
  return out
}
