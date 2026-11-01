import type { AiCandidate } from '../types'

export function syllableText(s: AiCandidate['syllables']) {
  const n = (x: number) => `${x} syllable${x === 1 ? '' : 's'}`
  return s.exact ? `≈ ${n(s.min)}` : `≈ ${s.min}–${s.max} syllables`
}
