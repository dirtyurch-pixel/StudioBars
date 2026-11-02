/**
 * Craft analysis for the phone version: stress for the flow grid, clichés and repetition, structure scan,
 * singability and rhyme chains. A faithful port of backend/app/scan.py (parity.test.ts compares both).
 * Everything is an ESTIMATE from the dictionary and simple rules; nothing here edits lyrics.
 */
import type { Song } from '../../types'
import { classify, hasStress, isVowel, type Phones } from '../phonetics/engine'
import {
  STOPWORDS,
  Resolver,
  analyzeLines,
  ambiguous,
  guessSyllables,
  hasPhones,
  tokenize,
} from '../phonetics/words'

export const CLICHES = [
  'heart of gold',
  'broken heart',
  'tears fall',
  'tears like rain',
  'cold as ice',
  'burning desire',
  'fire in my soul',
  'set me free',
  'love hurts',
  'stand the test of time',
  'end of the road',
  'light at the end of the tunnel',
  'dream come true',
  'head over heels',
  'lost without you',
  "can't live without you",
  'you complete me',
  'forever and always',
  'forever and a day',
  'take my breath away',
  'against all odds',
  'every step of the way',
  'turn back time',
  'rise above',
  'rise from the ashes',
  'walk through fire',
  'like a diamond',
  'shine like a star',
  'reach for the stars',
  'sky is the limit',
  'money talks',
  'ride or die',
  'king of the world',
  'cry me a river',
  'dance the night away',
  'party all night',
  'no pain no gain',
  'heart on my sleeve',
  'wear my heart',
  'wild and free',
  'young and free',
  'hold on tight',
  'never let go',
  'this is the end',
  'roller coaster',
  'break the chains',
  'caught in the rain',
  'falling apart',
  'heart skips a beat',
  'butterflies in my stomach',
  'fly so high',
  'hands in the air',
  'one more night',
  'all I need is you',
  'you and me against the world',
]
const FILLERS = new Set(
  'just really very like so kinda sorta basically literally actually totally honestly'.split(' '),
)
const INTENTIONAL_TYPES = new Set(['chorus', 'hook', 'pre-chorus'])

export const normLine = (t: string) =>
  t
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

/** Python's round(): ties go to the even neighbour, so numbers match the PC version exactly. */
export function pyRound(x: number, n = 0): number {
  const m = 10 ** n
  const y = x * m
  const f = Math.floor(y)
  const diff = y - f
  let r: number
  if (diff === 0.5) r = f % 2 === 0 ? f : f + 1
  else r = Math.round(y)
  return r / m
}
const fmean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const pstdev = (xs: number[]) => {
  const m = fmean(xs)
  return Math.sqrt(fmean(xs.map((x) => (x - m) ** 2)))
}

// ---------------------------------------------------------------- stress for the flow grid

export function lineSyllables(text: string, r: Resolver) {
  const out: {
    word: string
    word_index: number
    stress: 0 | 1 | 2 | null
    first: boolean
    guess: boolean
  }[] = []
  tokenize(text).forEach((tok, wi) => {
    const info = r.lookup(tok.norm)
    if (hasPhones(info) && info.status !== 'guess') {
      info.prons[0].phones.filter(isVowel).forEach((v, k) => {
        const st = Number(v[v.length - 1])
        out.push({
          word: tok.text,
          word_index: wi,
          stress: st === 1 ? 1 : st === 2 ? 2 : 0,
          first: k === 0,
          guess: false,
        })
      })
    } else {
      for (let k = 0; k < Math.max(1, guessSyllables(tok.norm)); k++)
        out.push({ word: tok.text, word_index: wi, stress: null, first: k === 0, guess: true })
    }
  })
  return out
}

// ---------------------------------------------------------------- clichés, repeats, fillers

type Flat = [number, string, string, string, string] // section index, type, label, line id, text

export function scanText(song: Song) {
  const genres = new Set(song.genres.map((g) => g.toLowerCase()))
  const flat: Flat[] = []
  song.sections.forEach((s, si) =>
    s.lines.forEach(
      (ln) => ln.text.trim() && flat.push([si, s.section_type, s.label, ln.id, ln.text]),
    ),
  )

  const cliches: { line_id: string; section: string; phrase: string; text: string }[] = []
  for (const [, , label, lid, text] of flat) {
    const n = ` ${normLine(text)} `
    for (const c of CLICHES)
      if (n.includes(` ${normLine(c)} `))
        cliches.push({ line_id: lid, section: label, phrase: c, text })
  }

  const groups = new Map<string, Flat[]>()
  for (const item of flat) {
    const k = normLine(item[4])
    if (k.split(' ').filter(Boolean).length >= 2) groups.set(k, [...(groups.get(k) ?? []), item])
  }
  const repeated: {
    text: string
    count: number
    line_ids: string[]
    sections: string[]
    intentional: boolean
  }[] = []
  for (const items of groups.values()) {
    if (items.length < 2) continue
    const intentional = genres.has('house') || items.every((i) => INTENTIONAL_TYPES.has(i[1]))
    repeated.push({
      text: items[0][4],
      count: items.length,
      line_ids: items.map((i) => i[3]),
      sections: [...new Set(items.map((i) => i[2]))].sort(),
      intentional,
    })
  }

  const grams = new Map<string, Set<string>>()
  for (const [, , , lid, text] of flat) {
    const words = normLine(text).split(' ').filter(Boolean)
    for (let i = 0; i < words.length - 3; i++) {
      const g = words.slice(i, i + 4).join(' ')
      if (!grams.has(g)) grams.set(g, new Set())
      grams.get(g)!.add(lid)
    }
  }
  const exact = new Set(repeated.flatMap((r) => r.line_ids))
  const reused: { phrase: string; count: number; line_ids: string[] }[] = []
  const seen: string[] = []
  const sorted = [...grams]
    .map((e, i) => [e, i] as const)
    .sort((a, b) => b[0][1].size - a[0][1].size || a[1] - b[1])
    .map(([e]) => e)
  for (const [g, lids] of sorted) {
    if (
      lids.size >= 2 &&
      ![...lids].every((l) => exact.has(l)) &&
      !seen.some((p) => p.includes(g) || g.includes(p))
    ) {
      seen.push(g)
      reused.push({ phrase: g, count: lids.size, line_ids: [...lids].sort() })
    }
  }

  const filler: { line_id: string; section: string; words: string[]; text: string }[] = []
  for (const [, , label, lid, text] of flat) {
    const hits = normLine(text)
      .split(' ')
      .filter((w) => FILLERS.has(w))
    if (hits.length >= 2) filler.push({ line_id: lid, section: label, words: hits, text })
  }
  return {
    cliches: cliches.slice(0, 50),
    repeated_lines: repeated.slice(0, 50),
    reused_phrases: reused.slice(0, 30),
    filler: filler.slice(0, 50),
  }
}

// ---------------------------------------------------------------- structure scan

export function scanStructure(song: Song, r: Resolver) {
  const sections: {
    label: string
    type: string
    lines: number
    avg_syllables: number | null
    spread: number | null
    rhyme_families: number
    end_rhyme_share: number | null
  }[] = []
  for (const s of song.sections) {
    const texts = s.lines.map((l) => l.text).filter((t) => t.trim())
    if (!texts.length) {
      sections.push({
        label: s.label,
        type: s.section_type,
        lines: 0,
        avg_syllables: null,
        spread: null,
        rhyme_families: 0,
        end_rhyme_share: null,
      })
      continue
    }
    const res = analyzeLines(texts, r)
    const mids = res.lines.map((l) => (l.syllables.min + l.syllables.max) / 2)
    const ends = res.lines.flatMap((l) => l.words.filter((w) => w.is_end))
    const inFamily = ends.filter((w) => w.family !== null).length
    sections.push({
      label: s.label,
      type: s.section_type,
      lines: texts.length,
      avg_syllables: pyRound(fmean(mids), 1),
      spread: mids.length > 1 ? pyRound(pstdev(mids), 1) : 0,
      rhyme_families: res.families.length,
      end_rhyme_share: ends.length ? pyRound(inFamily / ends.length, 2) : null,
    })
  }
  const notes: string[] = []
  const types = new Set(sections.filter((s) => s.lines).map((s) => s.type))
  if (types.size && !types.has('chorus') && !types.has('hook'))
    notes.push('There is no chorus or hook section yet. Many songs have one place that repeats.')
  if (types.has('chorus') && types.has('verse') && !types.has('pre-chorus') && !types.has('bridge'))
    notes.push(
      'No pre-chorus or bridge. That is fine, but a short contrast section can make the chorus feel bigger.',
    )
  for (const s of sections) {
    if (s.lines >= 4 && s.rhyme_families === 0)
      notes.push(
        `“${s.label}” has no rhyme pattern the dictionary can find (words it does not know are skipped).`,
      )
    if (s.spread !== null && s.spread >= 4)
      notes.push(`“${s.label}” has very uneven line lengths (about ±${s.spread} syllables).`)
  }
  const ch = sections.filter((s) => s.type === 'chorus' && s.avg_syllables)
  const vs = sections.filter((s) => s.type === 'verse' && s.avg_syllables)
  if (
    ch.length &&
    vs.length &&
    Math.abs(fmean(ch.map((s) => s.avg_syllables!)) - fmean(vs.map((s) => s.avg_syllables!))) < 1
  )
    notes.push(
      'Chorus and verse lines are about the same length. A different length or rhythm can help the chorus stand out.',
    )
  return {
    sections,
    notes,
    disclaimer:
      'Estimates from the dictionary and simple rules. These are prompts to think about, not verdicts.',
  }
}

// ---------------------------------------------------------------- singability / breath

const LONG_LINE = 14
const CROWDED_RUN = 5

export function singability(song: Song, r: Resolver) {
  const notes: {
    line_id: string
    section: string
    kind: 'long' | 'crowded'
    text: string
    detail: string
    breath_after: number | null
  }[] = []
  for (const sec of song.sections)
    for (const ln of sec.lines) {
      const text = ln.text
      if (!text.trim()) continue
      const toks = tokenize(text)
      const infos = toks.map((t) => r.lookup(t.norm))
      const syl = infos.reduce((n, i) => n + (i.synMin + i.synMax) / 2, 0)
      if (syl > LONG_LINE) {
        let breaks = toks
          .slice(0, -1)
          .map((t) => t.end)
          .filter((e) => {
            const c = text.slice(e, e + 1)
            return c === '' || ',;:-—'.includes(c)
          })
        if (!breaks.length) breaks = [toks[Math.floor(toks.length / 2) - 1].end]
        const mid = text.length / 2
        const at = breaks.reduce((best, b) => (Math.abs(b - mid) < Math.abs(best - mid) ? b : best))
        const lastWord = text.slice(0, at).split(/\s+/).filter(Boolean).pop()
        notes.push({
          line_id: ln.id,
          section: sec.label,
          kind: 'long',
          text,
          detail: `About ${pyRound(syl)} syllables is a lot for one breath. A breath could go after “${lastWord}”.`,
          breath_after: at,
        })
      }
      let run = 0
      let worst = 0
      let where = ''
      toks.forEach((t, k) => {
        const info = infos[k]
        if (!hasPhones(info)) {
          run = 0
          return
        }
        for (const p of info.prons[0].phones) {
          if (isVowel(p)) run = 0
          else if (++run > worst) {
            worst = run
            where = t.text
          }
        }
      })
      if (worst >= CROWDED_RUN)
        notes.push({
          line_id: ln.id,
          section: sec.label,
          kind: 'crowded',
          text,
          detail: `Several consonants pile up near “${where}” (${worst} in a row), which can be hard to say quickly.`,
          breath_after: null,
        })
    }
  return notes.slice(0, 60)
}

// ---------------------------------------------------------------- rhyme chains

const STRICTNESS: Record<string, Set<string>> = {
  strict: new Set(['homophone', 'rich', 'perfect']),
  normal: new Set(['homophone', 'rich', 'perfect', 'near']),
  loose: new Set(['homophone', 'rich', 'perfect', 'near', 'assonance']),
}

export function rhymeChains(lines: string[], r: Resolver, strictness = 'normal', windowSize = 4) {
  const allowed = STRICTNESS[strictness]
  type M = { line: number; tok: ReturnType<typeof tokenize>[number]; ph: Phones; alt: boolean }
  const members: M[] = []
  lines.forEach((text, li) => {
    const toks = tokenize(text)
    toks.forEach((tok, wi) => {
      const info = r.lookup(tok.norm)
      if (
        !hasPhones(info) ||
        info.status === 'guess' ||
        (STOPWORDS.has(tok.norm) && wi !== toks.length - 1)
      )
        return
      const ph = info.prons[0].phones
      if (hasStress(ph))
        members.push({ line: li, tok, ph, alt: ambiguous(info) || info.prons.length > 1 })
    })
  })
  const parent = members.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const pairs: [number, number, string][] = []
  for (let a = 0; a < members.length; a++)
    for (let b = a + 1; b < members.length; b++) {
      if (members[b].line - members[a].line > windowSize) break
      if (members[a].tok.norm === members[b].tok.norm) continue
      const q = classify(members[a].ph, members[b].ph)
      if (q && allowed.has(q)) {
        pairs.push([a, b, q])
        parent[find(a)] = find(b)
      }
    }
  const comps = new Map<number, number[]>()
  members.forEach((_, i) => {
    const root = find(i)
    comps.set(root, [...(comps.get(root) ?? []), i])
  })
  const order = ['homophone', 'rich', 'perfect', 'near', 'assonance']
  const chains = [...comps.values()]
    .filter((idxs) => idxs.length >= 2)
    .map((idxs) => {
      const set = new Set(idxs)
      const qs = pairs.filter(([a, b]) => set.has(a) && set.has(b)).map(([, , q]) => q)
      const weakest = qs.length
        ? qs.reduce((w, q) => (order.indexOf(q) > order.indexOf(w) ? q : w))
        : null
      const linesIn = idxs.map((i) => members[i].line)
      return {
        members: idxs.map((i) => ({
          line: members[i].line,
          word: members[i].tok.text,
          start: members[i].tok.start,
          end: members[i].tok.end,
          alternate_pronunciations: members[i].alt,
        })),
        internal: new Set(linesIn).size < linesIn.length,
        weakest_link: weakest,
      }
    })
  const sortedChains = chains
    .map((c, i) => [c, i] as const)
    .sort(
      (x, y) =>
        y[0].members.length - x[0].members.length ||
        x[0].members[0].line - y[0].members[0].line ||
        x[1] - y[1],
    )
    .map(([c]) => c)
  return {
    chains: sortedChains.slice(0, 40),
    strictness,
    note: "Uses each word's first dictionary pronunciation. Words with other pronunciations are flagged; a match is never guaranteed.",
  }
}
