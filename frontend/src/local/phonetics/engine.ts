/**
 * Pronunciation dictionary, rhyme keys and rhyme search, for the phone version.
 * A faithful port of backend/app/phonetics/engine.py (tests compare both on real data).
 * Pronunciations are ARPAbet phoneme arrays with stress digits on vowels, e.g. ["F","EY1","D"].
 */
export type Phones = readonly string[]

export const VOWELS = new Set('AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW'.split(' '))
export const CONSONANTS = new Set(
  'B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH'.split(' '),
)

const IPA: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  EH: 'ɛ',
  ER: 'ɝ',
  EY: 'eɪ',
  IH: 'ɪ',
  IY: 'i',
  OW: 'oʊ',
  OY: 'ɔɪ',
  UH: 'ʊ',
  UW: 'u',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'r',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
}
const CLASS: Record<string, string> = {
  P: 'P',
  B: 'P',
  T: 'T',
  D: 'T',
  K: 'K',
  G: 'K',
  F: 'F',
  V: 'F',
  S: 'S',
  Z: 'S',
  SH: 'SH',
  ZH: 'SH',
  CH: 'CH',
  JH: 'CH',
  TH: 'TH',
  DH: 'TH',
  M: 'N',
  N: 'N',
  NG: 'N',
}

export const QUALITY_ORDER = [
  'homophone',
  'rich',
  'perfect',
  'near',
  'assonance',
  'consonance',
] as const
export type Quality = (typeof QUALITY_ORDER)[number]
export const RANK: Record<string, number> = Object.fromEntries(QUALITY_ORDER.map((q, i) => [q, i]))

export const isVowel = (p: string) => /\d$/.test(p)
export const base = (p: string) => p.replace(/[012]+$/, '')
export const syllableCount = (ph: Phones) => ph.filter(isVowel).length
export const stressPattern = (ph: Phones) =>
  ph
    .filter(isVowel)
    .map((p) => p[p.length - 1])
    .join('')
export const key = (ph: Phones) => ph.join(' ')

export function stressIndex(ph: Phones): number | null {
  for (const want of ['1', '2'])
    for (let i = ph.length - 1; i >= 0; i--) if (isVowel(ph[i]) && ph[i].endsWith(want)) return i
  for (let i = ph.length - 1; i >= 0; i--) if (isVowel(ph[i])) return i
  return null
}

export const hasStress = (ph: Phones) => ph.some((p) => isVowel(p) && /[12]$/.test(p))

export type Parts = { onset: string[]; key: string[]; trailing: number }
export function rhymeParts(ph: Phones): Parts | null {
  const i = stressIndex(ph)
  if (i === null) return null
  let j = i
  while (j > 0 && !isVowel(ph[j - 1])) j--
  return {
    onset: ph.slice(j, i).map(base),
    key: ph.slice(i).map(base),
    trailing: ph.slice(i + 1).filter(isVowel).length,
  }
}

export const endingType = (trailing: number) =>
  trailing === 0 ? 'masculine' : trailing === 1 ? 'feminine' : 'dactylic'

export function readableIpa(ph: Phones): string {
  return ph
    .map((p) => {
      const b = base(p)
      let s = IPA[b] ?? b.toLowerCase()
      if (isVowel(p)) {
        const st = p[p.length - 1]
        if (b === 'AH') s = st === '1' || st === '2' ? 'ʌ' : 'ə'
        if (b === 'ER' && st === '0') s = 'ɚ'
        if (st === '1') s = 'ˈ' + s
        else if (st === '2') s = 'ˌ' + s
      }
      return s
    })
    .join('')
}

const nearKey = (k: string[]) => k.map((p) => CLASS[p] ?? p)
const eq = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** How well does `cand` rhyme with `src`? null if it does not. */
export function classify(src: Phones, cand: Phones): Quality | null {
  const a = rhymeParts(src)
  const b = rhymeParts(cand)
  if (!a || !b) return null
  if (eq(src, cand)) return 'homophone'
  if (eq(a.key, b.key)) return eq(a.onset, b.onset) ? 'rich' : 'perfect'
  if (a.trailing !== b.trailing) return null
  if (eq(nearKey(a.key), nearKey(b.key)) && a.key[0] === b.key[0]) return 'near'
  const va = a.key.filter((p) => VOWELS.has(p))
  const vb = b.key.filter((p) => VOWELS.has(p))
  if (eq(va, vb)) return 'assonance'
  if (eq(a.key.slice(1), b.key.slice(1))) return 'consonance'
  return null
}

/** Sounds from the vowel `syllables` places from the end, stress numbers removed (multi-syllable rhymes). */
export function tail(ph: Phones, syllables: number): string[] | null {
  const vowels = ph.map((p, i) => (isVowel(p) ? i : -1)).filter((i) => i >= 0)
  if (syllables < 1 || vowels.length < syllables) return null
  return ph.slice(vowels[vowels.length - syllables]).map(base)
}

export function classifyTail(
  a: readonly string[],
  b: readonly string[],
): 'perfect' | 'near' | 'assonance' | null {
  if (eq(a, b)) return 'perfect'
  if (
    a.length === b.length &&
    eq(
      a.map((p) => CLASS[p] ?? p),
      b.map((p) => CLASS[p] ?? p),
    )
  )
    return 'near'
  if (
    eq(
      a.filter((p) => VOWELS.has(p)),
      b.filter((p) => VOWELS.has(p)),
    )
  )
    return 'assonance'
  return null
}

// ---------------------------------------------------------------- dictionary

export function parseDict(text: string): Map<string, Phones[]> {
  const out = new Map<string, Phones[]>()
  for (const raw of text.split('\n')) {
    const line = raw.split('#', 1)[0].trim()
    if (!line) continue
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    const word = line.slice(0, sp).split('(', 1)[0].toLowerCase()
    const phones = line
      .slice(sp + 1)
      .split(/\s+/)
      .filter(Boolean)
    if (word && phones.length) {
      const list = out.get(word)
      if (list) list.push(phones)
      else out.set(word, [phones])
    }
  }
  return out
}

export function parseFrequency(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.includes('\t')) continue
    const [w, z] = line.replace(/\r$/, '').split('\t')
    freq.set(w, parseFloat(z))
  }
  return freq
}

export type Candidate = {
  word: string
  phones: Phones
  quality: Quality
  zipf: number | null
  syllables: number
  ending: string
}
type Entry = [string, Phones]

export class Dictionary {
  private byKey: Map<string, Entry[]> | null = null
  private byVowel = new Map<string, Entry[]>()
  private byCoda = new Map<string, Entry[]>()
  private tails = new Map<number, Map<string, Entry[]>>()
  constructor(
    public prons: Map<string, Phones[]>,
    public freq: Map<string, number>,
  ) {}

  /** The rhyme indexes take a moment to build, so they are made the first time a rhyme is searched for. */
  private indexes() {
    if (this.byKey) return this.byKey
    const byKey = new Map<string, Entry[]>()
    const push = (m: Map<string, Entry[]>, k: string, e: Entry) => {
      const l = m.get(k)
      if (l) l.push(e)
      else m.set(k, [e])
    }
    for (const [w, plist] of this.prons)
      for (const ph of plist) {
        const parts = rhymeParts(ph)
        if (!parts) continue
        push(byKey, key(parts.key), [w, ph])
        push(this.byVowel, `${parts.key[0]}|${parts.trailing}`, [w, ph])
        push(this.byCoda, key(parts.key.slice(1)), [w, ph])
      }
    this.byKey = byKey
    return byKey
  }

  tailIndex(syllables: number): Map<string, Entry[]> {
    let idx = this.tails.get(syllables)
    if (!idx) {
      idx = new Map()
      for (const [w, plist] of this.prons)
        for (const ph of plist) {
          const t = tail(ph, syllables)
          if (t) {
            const k = key(t)
            const l = idx.get(k)
            if (l) l.push([w, ph])
            else idx.set(k, [[w, ph]])
          }
        }
      this.tails.set(syllables, idx)
    }
    return idx
  }

  vowelIndex(syllables: number): Map<string, Entry[]> {
    let idx = this.tails.get(-syllables)
    if (!idx) {
      idx = new Map()
      for (const [t, items] of this.tailIndex(syllables)) {
        const k = t
          .split(' ')
          .filter((p) => VOWELS.has(p))
          .join(' ')
        const l = idx.get(k)
        if (l) l.push(...items)
        else idx.set(k, [...items])
      }
      this.tails.set(-syllables, idx)
    }
    return idx
  }

  get hasFrequency() {
    return this.freq.size > 0
  }
  zipf(word: string): number | null {
    return this.freq.size ? (this.freq.get(word) ?? null) : null
  }

  search(
    sources: Phones[],
    word: string,
    qualities: Set<string>,
    opts: {
      minSyllables?: number | null
      maxSyllables?: number | null
      endings?: Set<string> | null
      minZipf?: number | null
      extra?: Entry[]
      overridden?: Set<string>
      prefer?: Set<string>
    } = {},
  ): Candidate[] {
    const byKey = this.indexes()
    const extra = opts.extra ?? []
    const overridden = opts.overridden ?? new Set()
    const best = new Map<string, Candidate>()
    for (const src of sources) {
      const parts = rhymeParts(src)
      if (!parts) continue
      const pool = new Map<string, Entry>() // keyed by word + pronunciation, insertion-ordered like Python's dict
      const add = (list: Entry[] | undefined) => {
        for (const e of list ?? []) pool.set(e[0] + '\u0000' + key(e[1]), e)
      }
      add(byKey.get(key(parts.key)))
      if (qualities.has('near') || qualities.has('assonance'))
        add(this.byVowel.get(`${parts.key[0]}|${parts.trailing}`))
      if (qualities.has('consonance')) add(this.byCoda.get(key(parts.key.slice(1))))
      add(extra)
      for (const [w, ph] of pool.values()) {
        if (w === word) continue
        if (overridden.has(w) && !extra.some(([ew, ep]) => ew === w && eq(ep, ph))) continue
        const q = classify(src, ph)
        if (q === null || !qualities.has(q)) continue
        const cparts = rhymeParts(ph)
        if (!cparts) continue
        const syl = syllableCount(ph)
        if (opts.minSyllables != null && syl < opts.minSyllables) continue
        if (opts.maxSyllables != null && syl > opts.maxSyllables) continue
        const end = endingType(cparts.trailing)
        if (opts.endings && opts.endings.size && !opts.endings.has(end)) continue
        const z = this.zipf(w)
        if (opts.minZipf != null && this.hasFrequency && (z === null || z < opts.minZipf)) continue
        const old = best.get(w)
        if (!old || RANK[q] < RANK[old.quality])
          best.set(w, { word: w, phones: ph, quality: q, zipf: z, syllables: syl, ending: end })
      }
    }
    const mine = opts.prefer ?? new Set<string>()
    return [...best.values()].sort(
      (a, b) =>
        RANK[a.quality] - RANK[b.quality] ||
        (mine.has(a.word) ? 0 : 1) - (mine.has(b.word) ? 0 : 1) ||
        -(a.zipf ?? 0) + (b.zipf ?? 0) ||
        (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
    )
  }
}
