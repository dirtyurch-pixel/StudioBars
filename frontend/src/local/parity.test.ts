/**
 * The phone version must give the same answers as the PC version. parity.fixture.json holds the PC answers
 * (made by scripts/make_phone_parity.py from the same data files); this test asks the phone code the same questions.
 */
import { describe, expect, it } from 'vitest'
import cmu from '../../../backend/app/phonetics/data/cmudict.dict?raw'
import freq from '../../../backend/app/phonetics/data/frequency_en.tsv?raw'
import dAdj from '../../../backend/app/lexicon/data/wordnet/data.adj?raw'
import dAdv from '../../../backend/app/lexicon/data/wordnet/data.adv?raw'
import dNoun from '../../../backend/app/lexicon/data/wordnet/data.noun?raw'
import dVerb from '../../../backend/app/lexicon/data/wordnet/data.verb?raw'
import iAdj from '../../../backend/app/lexicon/data/wordnet/index.adj?raw'
import iAdv from '../../../backend/app/lexicon/data/wordnet/index.adv?raw'
import iNoun from '../../../backend/app/lexicon/data/wordnet/index.noun?raw'
import iVerb from '../../../backend/app/lexicon/data/wordnet/index.verb?raw'
import eAdj from '../../../backend/app/lexicon/data/wordnet/adj.exc?raw'
import eAdv from '../../../backend/app/lexicon/data/wordnet/adv.exc?raw'
import eNoun from '../../../backend/app/lexicon/data/wordnet/noun.exc?raw'
import eVerb from '../../../backend/app/lexicon/data/wordnet/verb.exc?raw'
import fixture from './parity.fixture.json'
import { Lexicon } from './lexicon/service'
import { WordNet, POS_FROM_NAME } from './lexicon/wordnet'
import { Dictionary, VOWELS, parseDict, parseFrequency, tail } from './phonetics/engine'
import { Resolver, analyzeLines, infoJson } from './phonetics/words'

const enc = new TextEncoder()
const dic = new Dictionary(parseDict(cmu), parseFrequency(freq))
const r = new Resolver(dic)
const wn = new WordNet({
  index: { n: iNoun, v: iVerb, a: iAdj, r: iAdv },
  exc: { n: eNoun, v: eVerb, a: eAdj, r: eAdv },
  data: { n: enc.encode(dNoun), v: enc.encode(dVerb), a: enc.encode(dAdj), r: enc.encode(dAdv) },
})
const lex = new Lexicon(wn, dic)
const F = fixture as unknown as {
  analyze: unknown[]
  words: Record<string, unknown>
  rhymes: unknown[]
  pos_rhymes: unknown[]
  describe: unknown[]
  usual_pos: Record<string, string | null>
  tails: [string, string[]][]
}
const LINES = [
  [
    'I walk alone beneath the city lights',
    'Counting every shadow in the rain',
    'Nobody calls me anymore tonight',
    'My heart of gold is breaking down again',
  ],
  [
    "Runnin' through the night, nothin' feels right",
    "Jay's on the mic, twenty-four seven",
    '808 drums and a hi-hat',
    'Café au lait, zzqx blorp',
  ],
  ['', 'Fire fire', 'the a an'],
]
const RHYMES: [
  string,
  string,
  boolean,
  number | null,
  number | null,
  string,
  'any' | 'familiar' | 'common',
][] = [
  ['fade', 'perfect,near', false, null, null, '', 'familiar'],
  ['fade', 'perfect,near,assonance,consonance', true, null, null, '', 'any'],
  ['orange', 'perfect,near,assonance', false, null, null, '', 'any'],
  ['lights', 'perfect', false, 2, 3, '', 'familiar'],
  ['money', 'perfect,near', false, null, null, 'feminine', 'common'],
  ['fire', 'perfect,near', false, null, null, '', 'familiar'],
]
const ZIPF = { any: null, familiar: 3.0, common: 4.0 }

function rhymes(
  word: string,
  qualities: string,
  ident: boolean,
  mn: number | null,
  mx: number | null,
  endings: string,
  fam: keyof typeof ZIPF,
  pos?: string,
) {
  const info = r.lookup(word)
  const want = new Set(qualities.split(','))
  if (ident) ['homophone', 'rich'].forEach((q) => want.add(q))
  const ends = new Set(endings.split(',').filter(Boolean))
  let c = dic.search(
    info.prons.map((p) => p.phones),
    word,
    want,
    { minSyllables: mn, maxSyllables: mx, endings: ends.size ? ends : null, minZipf: ZIPF[fam] },
  )
  if (pos) c = c.filter((x) => wn.usualPos(x.word) === POS_FROM_NAME[pos])
  return [
    ...c.slice(0, 120).map((x) => [x.word, x.quality, x.syllables, x.ending]),
    ['TOTAL', c.length],
  ]
}

describe('phone version matches the PC version on real data', () => {
  it('syllables and rhyme families for lines', () => {
    LINES.forEach((lines, i) => expect(analyzeLines(lines, r)).toEqual(F.analyze[i]))
  })
  it('how single words are said', () => {
    for (const [w, want] of Object.entries(F.words)) expect(infoJson(r.lookup(w))).toEqual(want)
  })
  it('rhyme search with every kind of filter', () => {
    RHYMES.forEach((q, i) => expect(rhymes(...q)).toEqual(F.rhymes[i]))
  })
  it('rhymes filtered by part of speech', () => {
    ;[
      ['night', 'noun'],
      ['fade', 'verb'],
    ].forEach(([w, pos], i) =>
      expect(rhymes(w, 'perfect,near', false, null, null, '', 'familiar', pos)).toEqual(
        F.pos_rhymes[i],
      ),
    )
  })
  it('usual part of speech', () => {
    for (const [w, want] of Object.entries(F.usual_pos)) expect(wn.usualPos(w)).toBe(want)
  })
  it('word meanings, with and without the line as context', () => {
    const qs: [string, string, string][] = [
      ['bank', '', ''],
      ['bank', 'money in the account', ''],
      ['bank', '', 'river water fishing'],
      ['lead', '', ''],
      ['fast', '', ''],
      ['tear', '', ''],
      ['zzqx', '', ''],
      ['running', '', ''],
    ]
    qs.forEach(([w, c, a], i) =>
      expect(JSON.parse(JSON.stringify(lex.describe(w, c, null, a)))).toEqual(F.describe[i]),
    )
  })
  it('multi-syllable endings for phrase rhymes', () => {
    const qs: [string, number][] = [
      ['cold as ice', 2],
      ['all night long', 3],
      ['money', 2],
    ]
    qs.forEach(([phrase, n], i) => {
      const phones = phrase.split(' ').flatMap((w) => r.lookup(w).prons[0].phones)
      const t = tail(phones, n)!
      const words = [
        ...new Set(
          (dic.vowelIndex(n).get(t.filter((p) => VOWELS.has(p)).join(' ')) ?? []).map(([w]) => w),
        ),
      ]
        .sort()
        .slice(0, 200)
      expect([t.join(' '), words]).toEqual(F.tails[i])
    })
  })
})

// ---------------------------------------------------------------- step 3: Craft scans and the AI prompt
import { lineSyllables, rhymeChains, scanStructure, scanText, singability } from './craft/scan'
import { build } from './ai/prompts'
import { parseLines, parseNotes } from './ai/validate'
import type { Song } from '../types'

const C = (fixture as unknown as { craft: Record<string, unknown> }).craft as {
  songs: Song[]
  scan_text: unknown[]
  scan_structure: unknown[]
  singability: unknown[]
  chains: Record<string, unknown>
  line_syllables: unknown[]
}
const A = (fixture as unknown as { ai: Record<string, unknown> }).ai as {
  reqs: Record<string, unknown>[]
  built: Record<string, unknown>[]
  answers: string[]
  lines: unknown[]
  notes: unknown[]
}
const CHAIN_LINES = [
  'The night light shines so bright',
  'I walk the road under the cold',
  'rain rain rain',
  'Fire and desire, higher and higher',
]
const plain = (x: unknown) => JSON.parse(JSON.stringify(x))

describe('phone Craft tools match the PC version', () => {
  it('clichés, repeats, reused phrases and fillers', () => {
    C.songs.forEach((s, i) => expect(plain(scanText(s))).toEqual(C.scan_text[i]))
  })
  it('structure scan', () => {
    C.songs.forEach((s, i) => expect(plain(scanStructure(s, r))).toEqual(C.scan_structure[i]))
  })
  it('singability and breath', () => {
    C.songs.forEach((s, i) => expect(plain(singability(s, r))).toEqual(C.singability[i]))
  })
  it('rhyme chains at every strictness', () => {
    for (const k of ['strict', 'normal', 'loose'])
      expect(plain(rhymeChains(CHAIN_LINES, r, k))).toEqual(C.chains[k])
  })
  it('syllable stress for the flow grid', () => {
    ;['Tonight I wonder zzqx', 'Every little thing', '808 drums'].forEach((t, i) =>
      expect(plain(lineSyllables(t, r))).toEqual(C.line_syllables[i]),
    )
  })
})

describe('phone AI sends exactly what the PC version sends', () => {
  it('builds the same prompt (and refuses the same things)', () => {
    A.reqs.forEach((q, i) => {
      let got: unknown
      try {
        got = plain(build(C.songs[0], q as never))
      } catch (e) {
        got = { error: (e as { code?: string }).code }
      }
      expect(got).toEqual(A.built[i])
    })
  })
  it('checks AI answers the same way', () => {
    A.answers.forEach((a, i) => {
      expect(parseLines(a, new Set(['Walk with me tonight']), 5)).toEqual(A.lines[i])
      expect(parseNotes(a)).toEqual(A.notes[i])
    })
  })
})
