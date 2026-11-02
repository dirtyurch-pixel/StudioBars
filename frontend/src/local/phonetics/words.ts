/**
 * Words in lyrics: tokenising, how they sound, syllables per line, rhyme families.
 * A faithful port of backend/app/phonetics/words.py.
 */
import {
  CONSONANTS,
  VOWELS,
  base,
  hasStress,
  isVowel,
  readableIpa,
  rhymeParts,
  stressPattern,
  syllableCount,
  key as pkey,
  type Dictionary,
  type Phones,
} from './engine'

const L = '[\\p{L}\\p{Nl}\\p{No}]'
export const WORD_RE = new RegExp(`${L}+(?:[-'’]${L}+)*['’]?|\\p{Nd}+(?:[.,]\\p{Nd}+)*`, 'gu')

export const STOPWORDS = new Set(
  `a an the and or but nor so yet for of to in on at by up as is am are was were be been
    it its i me my we us our you your he him his she her they them their this that these those
    do does did not no if then than too very can will would could should may might must
    oh uh ah yeah hey`.split(/\s+/),
)

const ONES =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  )
const TENS = '_ _ twenty thirty forty fifty sixty seventy eighty ninety'.split(' ')

export type Pron = { phones: Phones; source: string }
export type WordInfo = {
  norm: string
  status: 'known' | 'custom' | 'derived' | 'guess'
  prons: Pron[]
  synMin: number
  synMax: number
  note: string
}
export const hasPhones = (i: WordInfo) => i.prons.length > 0
export const ambiguous = (i: WordInfo) => i.synMin !== i.synMax

export const pronJson = (p: Pron) => ({
  phones: p.phones.join(' '),
  ipa: readableIpa(p.phones),
  syllables: syllableCount(p.phones),
  stress: stressPattern(p.phones),
  source: p.source,
})
export const infoJson = (i: WordInfo) => ({
  word: i.norm,
  status: i.status,
  pronunciations: i.prons.map(pronJson),
  syllables_min: i.synMin,
  syllables_max: i.synMax,
  ambiguous: ambiguous(i),
  note: i.note,
})

export type Token = { text: string; start: number; end: number; norm: string }
export const normWord = (w: string) => w.normalize('NFC').toLowerCase().replace(/’/g, "'")

export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(WORD_RE))
    out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length, norm: normWord(m[0]) })
  return out
}

export const stripAccents = (w: string) => w.normalize('NFKD').replace(/\p{M}/gu, '')

export function numberWords(n: number): string[] | null {
  if (n < 0 || n > 999_999) return null
  if (n < 20) return [ONES[n]]
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])]
  if (n < 1000)
    return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? (numberWords(n % 100) ?? []) : [])]
  const head = numberWords(Math.floor(n / 1000)) ?? []
  const tl = n % 1000 ? (numberWords(n % 1000) ?? []) : []
  return [...head, 'thousand', ...tl]
}

/** Rough vowel-group count for a word the dictionary does not know. */
export function guessSyllables(word: string): number {
  const w = stripAccents(word.toLowerCase()).replace(/[^a-z]/g, '')
  if (!w) return 1
  let n = (w.match(/[aeiouy]+/g) ?? []).length
  if (n > 1 && w.endsWith('e') && !['le', 'ee', 'ie', 'ye'].some((s) => w.endsWith(s))) n -= 1
  if (w.endsWith('ed') && n > 1 && !['ted', 'ded'].some((s) => w.endsWith(s))) n -= 1
  return Math.max(1, n)
}

function addS(ph: Phones): Phones {
  const last = base(ph[ph.length - 1])
  if (['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(last)) return [...ph, 'IH0', 'Z']
  if (['P', 'T', 'K', 'F', 'TH'].includes(last)) return [...ph, 'S']
  return [...ph, 'Z']
}

export class Resolver {
  private cache = new Map<string, WordInfo>()
  constructor(
    public dic: Dictionary,
    public custom: Map<string, Phones> = new Map(),
  ) {}

  lookup(word: string): WordInfo {
    const norm = normWord(word)
    let v = this.cache.get(norm)
    if (!v) {
      v = this.resolve(norm, 0)
      this.cache.set(norm, v)
    }
    return v
  }

  private dict(w: string) {
    return this.dic.prons.get(w) ?? this.dic.prons.get(stripAccents(w)) ?? null
  }

  private info(
    norm: string,
    status: WordInfo['status'],
    phones: Phones[],
    source: string,
    note = '',
  ): WordInfo {
    const counts = phones.map(syllableCount)
    return {
      norm,
      status,
      prons: phones.map((p) => ({ phones: p, source })),
      synMin: Math.min(...counts),
      synMax: Math.max(...counts),
      note,
    }
  }

  private resolve(norm: string, depth: number): WordInfo {
    const c = this.custom.get(norm)
    if (c) return this.info(norm, 'custom', [c], 'custom', 'Your own pronunciation.')
    const found = this.dict(norm)
    if (found && found.length) return this.info(norm, 'known', found, 'dictionary')
    if (depth > 2) return this.guess(norm)

    const m = /^(.*in)['’]$/.exec(norm)
    if (m) {
      const ing = this.dict(m[1] + 'g')
      if (ing)
        return this.info(
          norm,
          'derived',
          ing.map((ph) => ph.map((p) => (p === 'NG' ? 'N' : p))),
          'derived',
          'Dropped-g ending: said like “-in”.',
        )
    }
    if (norm.endsWith("'") && norm.length > 2)
      return this.resolve(norm.replace(/'+$/, ''), depth + 1)

    if (norm.endsWith("'s") && norm.length > 3) {
      const root = this.resolve(norm.slice(0, -2), depth + 1)
      if (hasPhones(root) && root.status !== 'guess')
        return this.info(
          norm,
          'derived',
          root.prons.map((p) => addS(p.phones)),
          'derived',
          'Built from the base word.',
        )
    }

    if (norm.includes('-')) {
      const parts = norm
        .split('-')
        .filter(Boolean)
        .map((p) => this.resolve(p, depth + 1))
      if (parts.length && parts.every(hasPhones)) {
        let combos: Phones[] = [[]]
        for (const part of parts)
          combos = combos
            .flatMap((cc) => part.prons.slice(0, 2).map((p) => [...cc, ...p.phones]))
            .slice(0, 6)
        return this.info(
          norm,
          'derived',
          combos,
          'derived',
          'Built from the parts of the compound.',
        )
      }
      return this.guess(norm, parts.length ? parts.reduce((n, p) => n + p.synMin, 0) : null)
    }

    if (/^\p{Nd}+$/u.test(norm)) {
      const words = norm.length <= 6 ? numberWords(parseInt(norm, 10)) : null
      if (words) {
        const parts = words.map((w) => this.resolve(w, depth + 1))
        if (parts.every(hasPhones)) {
          const ph = parts.flatMap((p) => p.prons[0].phones)
          return this.info(
            norm,
            'guess',
            [ph],
            'guess',
            'Read as a plain number. Add your own pronunciation if you say it differently (like “eight-oh-eight”).',
          )
        }
      }
      return this.guess(norm)
    }
    return this.guess(norm)
  }

  private guess(norm: string, syl: number | null = null): WordInfo {
    const n = syl ? syl : guessSyllables(norm)
    return {
      norm,
      status: 'guess',
      prons: [],
      synMin: n,
      synMax: n,
      note: 'Not in the dictionary: syllables are a guess.',
    }
  }
}

/** Validate typed phonemes like "B R OW1". Throws an Error with a plain-English reason. */
export function customPhones(raw: string): Phones {
  const toks = raw.toUpperCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean)
  if (!toks.length || toks.length > 24)
    throw new Error('Type between 1 and 24 sounds, separated by spaces, for example: B R OW1')
  const all = [...VOWELS, ...CONSONANTS].sort()
  const out: string[] = []
  for (const t of toks) {
    const b = t.replace(/[012]+$/, '')
    if (!VOWELS.has(b) && !CONSONANTS.has(b))
      throw new Error(`“${t}” is not a sound I know. Valid sounds: ${all.join(', ')}.`)
    if (VOWELS.has(b) && t === b)
      throw new Error(
        `The vowel ${t} needs a stress number: ${t}1 (strong), ${t}2 (medium) or ${t}0 (weak).`,
      )
    if (CONSONANTS.has(b) && t !== b)
      throw new Error(`The consonant ${b} should not have a number.`)
    out.push(t)
  }
  if (!out.some(isVowel)) throw new Error('A word needs at least one vowel sound.')
  return out
}

function lineSyllables(infos: WordInfo[]) {
  const lo = infos.reduce((n, i) => n + i.synMin, 0)
  const hi = infos.reduce((n, i) => n + i.synMax, 0)
  return { min: lo, max: hi, exact: lo === hi, guessed: infos.some((i) => i.status === 'guess') }
}

/** Syllable estimates per line plus rhyme families across the given lines. */
export function analyzeLines(lines: string[], resolver: Resolver) {
  const perLine = lines.map((text) =>
    tokenize(text).map((t) => [t, resolver.lookup(t.norm)] as const),
  )
  const groups = new Map<string, [number, number][]>()
  perLine.forEach((items, li) => {
    const last = items.length - 1
    items.forEach(([tok, info], wi) => {
      if (info.status === 'guess' || !hasPhones(info)) return
      if (STOPWORDS.has(tok.norm) && wi !== last) return
      const ph = info.prons[0].phones
      if (!hasStress(ph)) return
      const parts = rhymeParts(ph)
      if (parts) {
        const k = pkey(parts.key)
        const g = groups.get(k)
        if (g) g.push([li, wi])
        else groups.set(k, [[li, wi]])
      }
    })
  })
  const familyOf = new Map<string, number>()
  let families: { id: number; sound: string; size: number; end_count: number }[] = []
  for (const [k, members] of groups) {
    if (new Set(members.map(([li, wi]) => perLine[li][wi][0].norm)).size < 2) continue
    const fid = families.length
    const endCount = members.filter(([li, wi]) => wi === perLine[li].length - 1).length
    families.push({
      id: fid,
      sound: readableIpa(k.split(' ')).replace(/ˈ/g, ''),
      size: members.length,
      end_count: endCount,
    })
    for (const [li, wi] of members) familyOf.set(`${li},${wi}`, fid)
  }
  // number families by where they first appear, so colours are stable while typing below them
  const firstPos = (f: number) => {
    let best: [number, number] | null = null
    for (const [m, v] of familyOf) {
      if (v !== f) continue
      const [a, b] = m.split(',').map(Number)
      if (!best || a < best[0] || (a === best[0] && b < best[1])) best = [a, b]
    }
    return best!
  }
  const order = families
    .map((_, i) => i)
    .sort((x, y) => {
      const a = firstPos(x)
      const b = firstPos(y)
      return a[0] - b[0] || a[1] - b[1]
    })
  const renum = new Map(order.map((old, nw) => [old, nw]))
  families = order.map((o) => ({ ...families[o], id: renum.get(o)! }))
  for (const [k, v] of familyOf) familyOf.set(k, renum.get(v)!)

  const outLines = perLine.map((items, li) => ({
    syllables: lineSyllables(items.map(([, i]) => i)),
    words: items.map(([tok, info], wi) => ({
      text: tok.text,
      start: tok.start,
      end: tok.end,
      status: info.status,
      syllables_min: info.synMin,
      syllables_max: info.synMax,
      is_end: wi === items.length - 1,
      family: familyOf.get(`${li},${wi}`) ?? null,
    })),
  }))
  const unknown = [
    ...new Set(
      perLine.flatMap((items) =>
        items.filter(([, i]) => i.status === 'guess').map(([, i]) => i.norm),
      ),
    ),
  ].sort()
  return { lines: outLines, families, unknown_words: unknown }
}
