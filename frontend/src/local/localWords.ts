/**
 * The phone version's rhyme, syllable, word-meaning and phrase-bank tools. Same rules and answers as
 * backend/app/phonetics_routes.py, lexicon_routes.py and phrases.py (checked by parity.test.ts).
 */
import { ApiFail } from '../apiFail'
import { newId } from '../editor/content'
import type {
  Analysis,
  CustomPron,
  Meanings,
  PhoneticsStatus,
  PhraseItem,
  PhraseRhymes,
  RhymeResponse,
  WordInfo as WordInfoJson,
} from '../types'
import { loadDictionary, loadWordNet } from './data'
import { Lexicon } from './lexicon/service'
import { POS_FROM_NAME } from './lexicon/wordnet'
import {
  QUALITY_ORDER,
  RANK,
  VOWELS,
  classifyTail,
  readableIpa,
  stressPattern,
  syllableCount,
  tail,
  type Dictionary,
  type Phones,
} from './phonetics/engine'
import {
  Resolver,
  analyzeLines as analyze,
  customPhones,
  hasPhones,
  ambiguous,
  infoJson,
  normWord,
  tokenize,
} from './phonetics/words'
import { exclusive } from './store'
import { db, nowIso } from './localApi'

const fail = (status: number, code: string, message: string) =>
  new ApiFail(message, { status, code })
const WORD_OK = /^[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*$/u
const MAX_CUSTOM = 2000
const MAX_PHRASES = 5000
const ZIPF = { any: null, familiar: 3.0, common: 4.0 } as const

export const QUALITY_HELP = {
  homophone: 'Sounds exactly the same (like write / right).',
  rich: 'Same ending and the same starting sound (like suppose / oppose).',
  perfect: 'Same sound from the last stressed vowel to the end, different start (fade / made).',
  near: 'Almost: same vowel, and ending consonants that sound alike (fade / late, home / stone).',
  assonance: 'Same vowel sounds, different consonants (fade / brave).',
  consonance: 'Same ending consonants, different vowel (bad / bed).',
}

type StoredCustom = {
  word: string
  phones: string
  note: string
  created_at: string
  updated_at: string
}
type StoredPhrase = {
  id: string
  phrase: string
  phrase_key: string
  meaning: string
  sounds_like: string
  tags: string[]
  created_at: string
  updated_at: string
}

export function cleanWord(raw: string): string {
  const w = normWord(raw.trim())
  if (!w || w.length > 40 || !WORD_OK.test(w))
    throw fail(422, 'BAD_WORD', "Enter a single word (letters, numbers, - and ' only).")
  return w
}

async function customMap(): Promise<Map<string, Phones>> {
  const rows = await db().all<StoredCustom>('custom')
  return new Map(rows.map((r) => [r.word, r.phones.split(' ')]))
}
async function resolver(): Promise<{ d: Dictionary; r: Resolver; custom: Map<string, Phones> }> {
  const [d, custom] = await Promise.all([loadDictionary(), customMap()])
  return { d, r: new Resolver(d, custom), custom }
}

// ---------------------------------------------------------------- pronunciation and rhymes

export async function phoneticsStatus(): Promise<PhoneticsStatus> {
  const d = await loadDictionary()
  return {
    dictionary_words: d.prons.size,
    frequency_available: d.hasFrequency,
    pos_available: true,
    custom_count: (await db().all('custom')).length,
    quality_help: QUALITY_HELP,
    attribution: 'Pronunciations: CMU Pronouncing Dictionary (Carnegie Mellon University).',
  }
}

export async function analyzeLines(lines: string[]): Promise<Analysis> {
  if (lines.length > 300) throw fail(422, 'INVALID', 'Too many lines to analyse at once.')
  const { r } = await resolver()
  return analyze(lines, r) as Analysis
}

export async function lookupWord(word: string): Promise<WordInfoJson> {
  const w = cleanWord(word)
  const { r } = await resolver()
  return infoJson(r.lookup(w)) as WordInfoJson
}

export async function searchRhymes(q: {
  word: string
  qualities: string[]
  includeIdentical: boolean
  minSyllables?: number
  maxSyllables?: number
  pos?: string
  endings: string[]
  familiarity: 'any' | 'familiar' | 'common'
  limit: number
}): Promise<RhymeResponse> {
  const { d, r, custom } = await resolver()
  const w = cleanWord(q.word)
  const info = r.lookup(w)
  const want = new Set(q.qualities.filter(Boolean))
  const bad = [...want].filter((x) => !(QUALITY_ORDER as readonly string[]).includes(x))
  if (bad.length) throw fail(422, 'BAD_QUALITY', `Unknown rhyme type: ${bad.sort().join(', ')}.`)
  if (q.includeIdentical) ['homophone', 'rich'].forEach((x) => want.add(x))
  const ends = new Set(q.endings.filter(Boolean))
  if ([...ends].some((e) => !['masculine', 'feminine', 'dactylic'].includes(e)))
    throw fail(422, 'BAD_ENDING', 'Ending must be masculine, feminine or dactylic.')
  const notes: string[] = []
  let minZipf: number | null = ZIPF[q.familiarity]
  if (minZipf !== null && !d.hasFrequency) {
    notes.push(
      'Word-familiarity data is not installed, so results are not filtered or sorted by how common a word is.',
    )
    minZipf = null
  }
  const out: RhymeResponse = { word: infoJson(info) as WordInfoJson, results: [], total: 0, notes }
  if (!hasPhones(info)) {
    notes.unshift(
      `I don’t know how “${info.norm}” sounds, so I can’t look for rhymes. Add how you say it below.`,
    )
    return out
  }
  const extra = [...custom].filter(([cw]) => cw !== w && !/^\d+$/.test(cw)) as [string, Phones][]
  let cands = d.search(
    info.prons.map((p) => p.phones),
    w,
    want,
    {
      minSyllables: q.minSyllables ?? null,
      maxSyllables: q.maxSyllables ?? null,
      endings: ends.size ? ends : null,
      minZipf,
      extra,
      overridden: new Set(custom.keys()),
      prefer: new Set(custom.keys()),
    },
  )
  if (q.pos) {
    const wn = await loadWordNet()
    const wantPos = POS_FROM_NAME[q.pos]
    let skipped = 0
    cands = cands.filter((c) => {
      const usual = wn.usualPos(c.word)
      if (usual === null) skipped++
      return usual === wantPos
    })
    notes.push(
      `Showing words that are usually used as a ${q.pos} (per WordNet).` +
        (skipped ? ` ${skipped} words WordNet does not know were left out.` : ''),
    )
  }
  out.total = cands.length
  out.results = cands.slice(0, q.limit).map((c) => ({
    word: c.word,
    ipa: readableIpa(c.phones),
    syllables: c.syllables,
    stress: stressPattern(c.phones),
    ending: c.ending as 'masculine',
    quality: c.quality,
    zipf: c.zipf,
    custom: custom.has(c.word),
  }))
  if (ambiguous(info))
    notes.push(
      `“${info.norm}” can be said in ${info.synMin} or ${info.synMax} syllables, so rhymes for each way are included.`,
    )
  return out
}

// ---------------------------------------------------------------- your own pronunciations

const customJson = (r: StoredCustom): CustomPron => {
  const ph = r.phones.split(' ')
  return {
    word: r.word,
    phones: r.phones,
    ipa: readableIpa(ph),
    syllables: syllableCount(ph),
    note: r.note,
  }
}

export async function listCustomPron(): Promise<CustomPron[]> {
  return (await db().all<StoredCustom>('custom'))
    .sort((a, b) => (a.word < b.word ? -1 : 1))
    .map(customJson)
}

export async function saveCustomPron(
  word: string,
  data: { sounds_like?: string; phones?: string; note?: string },
): Promise<CustomPron> {
  const w = cleanWord(word)
  const soundsLike = (data.sounds_like ?? '').trim()
  const typed = (data.phones ?? '').trim()
  if (Boolean(soundsLike) === Boolean(typed))
    throw fail(
      422,
      'BAD_INPUT',
      'Give either “sounds like” (a word) or the sounds themselves, not both.',
    )
  let phones: Phones
  let note = (data.note ?? '').trim().slice(0, 200)
  if (soundsLike) {
    const d = await loadDictionary()
    const others = new Map([...(await customMap())].filter(([k]) => k !== w))
    const src = new Resolver(d, others).lookup(cleanWord(soundsLike))
    if (!hasPhones(src))
      throw fail(
        422,
        'UNKNOWN_WORD',
        `I don’t know how “${src.norm}” sounds either. Try a different word.`,
      )
    phones = src.prons[0].phones
    note = note || `Sounds like “${src.norm}”.`
  } else {
    try {
      phones = customPhones(typed)
    } catch (e) {
      throw fail(422, 'BAD_SOUNDS', e instanceof Error ? e.message : 'Those sounds are not valid.')
    }
  }
  return exclusive(async () => {
    const existing = await db().get<StoredCustom>('custom', w)
    if (!existing && (await db().all('custom')).length >= MAX_CUSTOM)
      throw fail(422, 'TOO_MANY', `You can store up to ${MAX_CUSTOM} custom pronunciations.`)
    const ts = nowIso()
    const row: StoredCustom = {
      word: w,
      phones: phones.join(' '),
      note,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    }
    await db().put('custom', w, row)
    return customJson(row)
  })
}

export async function deleteCustomPron(word: string): Promise<void> {
  const w = cleanWord(word)
  await exclusive(async () => {
    if (!(await db().get('custom', w)))
      throw fail(404, 'NOT_FOUND', 'No custom pronunciation for that word.')
    await db().del('custom', w)
  })
}

// ---------------------------------------------------------------- meanings

export async function getMeanings(word: string, context: string, around = ''): Promise<Meanings> {
  const w = cleanWord(word)
  const [wn, d] = await Promise.all([loadWordNet(), loadDictionary().catch(() => null)])
  return JSON.parse(
    JSON.stringify(
      new Lexicon(wn, d).describe(w, context.slice(0, 600), null, around.slice(0, 600)),
    ),
  )
}

// ---------------------------------------------------------------- phrase bank

export const phraseKey = (p: string) =>
  p.trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ')

function phrasePhones(text: string, r: Resolver): [Phones, string[]] {
  const phones: string[] = []
  const unknown: string[] = []
  for (const t of tokenize(text)) {
    const info = r.lookup(t.norm)
    if (hasPhones(info)) phones.push(...info.prons[0].phones)
    else unknown.push(info.norm)
  }
  return [phones, unknown]
}

function pronunciation(text: string, r: Resolver) {
  const infos = tokenize(text).map((t) => r.lookup(t.norm))
  if (!infos.length)
    return { known: false, syllables_min: 0, syllables_max: 0, ipa: '', unknown_words: [] }
  const unknown = infos.filter((i) => !hasPhones(i)).map((i) => i.norm)
  return {
    known: unknown.length === 0,
    syllables_min: infos.reduce((n, i) => n + i.synMin, 0),
    syllables_max: infos.reduce((n, i) => n + i.synMax, 0),
    ipa: infos
      .filter(hasPhones)
      .map((i) => readableIpa(i.prons[0].phones))
      .join(' '),
    unknown_words: unknown,
    guessed: infos.some((i) => i.status === 'guess'),
  }
}

const phraseJson = (
  p: StoredPhrase,
  r: Resolver,
): PhraseItem & { created_at: string; updated_at: string } => ({
  id: p.id,
  phrase: p.phrase,
  meaning: p.meaning,
  sounds_like: p.sounds_like,
  tags: [...p.tags].sort(),
  created_at: p.created_at,
  updated_at: p.updated_at,
  pronunciation: pronunciation(p.sounds_like || p.phrase, r),
})

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags) || tags.length > 10) throw fail(422, 'INVALID', 'Up to 10 tags.')
  const out: string[] = []
  for (const t of tags) {
    const v = String(t).trim().toLowerCase()
    if (!v || v.length > 30) throw fail(422, 'INVALID', 'Tags must be 1 to 30 characters.')
    if (!out.includes(v)) out.push(v)
  }
  return out
}
function cleanText(v: unknown, max: number, oneLine: boolean, required = false): string {
  const s = String(v ?? '').trim()
  if ((required && !s) || s.length > max || (oneLine && /[\r\n]/.test(s)))
    throw fail(422, 'INVALID', 'Some of that input is not allowed.')
  return s
}

export async function listPhrases(
  q = '',
  tag = '',
  limit = 200,
  offset = 0,
): Promise<{ total: number; items: PhraseItem[] }> {
  const { r } = await resolver()
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  const rows = (await db().all<StoredPhrase>('phrases')).filter(
    (p) =>
      terms.every(
        (t) =>
          [p.phrase, p.meaning, p.sounds_like].some((x) => x.toLowerCase().includes(t)) ||
          p.tags.some((g) => g.includes(t)),
      ) &&
      (!tag || p.tags.includes(tag.toLowerCase())),
  )
  rows.sort((a, b) =>
    a.phrase.toLowerCase() < b.phrase.toLowerCase()
      ? -1
      : a.phrase.toLowerCase() > b.phrase.toLowerCase()
        ? 1
        : 0,
  )
  return {
    total: rows.length,
    items: rows.slice(offset, offset + limit).map((p) => phraseJson(p, r)),
  }
}

export async function listPhraseTags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>()
  for (const p of await db().all<StoredPhrase>('phrases'))
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
}

export async function createPhrase(data: {
  phrase: string
  meaning: string
  sounds_like: string
  tags: string[]
}): Promise<PhraseItem> {
  const phrase = cleanText(data.phrase, 120, true, true)
  const row: StoredPhrase = {
    id: newId(),
    phrase,
    phrase_key: phraseKey(phrase),
    meaning: cleanText(data.meaning, 500, false),
    sounds_like: cleanText(data.sounds_like, 120, true),
    tags: cleanTags(data.tags ?? []),
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await exclusive(async () => {
    const all = await db().all<StoredPhrase>('phrases')
    if (all.length >= MAX_PHRASES)
      throw fail(422, 'TOO_MANY', `The phrase bank holds up to ${MAX_PHRASES} entries.`)
    if (all.some((p) => p.phrase_key === row.phrase_key))
      throw fail(409, 'DUPLICATE', `“${phrase}” is already in your phrase bank.`)
    await db().put('phrases', row.id, row)
  })
  const { r } = await resolver()
  return phraseJson(row, r)
}

export async function updatePhrase(
  id: string,
  data: Partial<{ phrase: string; meaning: string; sounds_like: string; tags: string[] }>,
): Promise<PhraseItem> {
  const row = await exclusive(async () => {
    const cur = await db().get<StoredPhrase>('phrases', id)
    if (!cur) throw fail(404, 'NOT_FOUND', 'Phrase not found.')
    const phrase =
      data.phrase !== undefined && data.phrase.trim()
        ? cleanText(data.phrase, 120, true, true)
        : cur.phrase
    const key = phraseKey(phrase)
    if ((await db().all<StoredPhrase>('phrases')).some((p) => p.phrase_key === key && p.id !== id))
      throw fail(409, 'DUPLICATE', `“${phrase}” is already in your phrase bank.`)
    const next: StoredPhrase = {
      ...cur,
      phrase,
      phrase_key: key,
      meaning: data.meaning !== undefined ? cleanText(data.meaning, 500, false) : cur.meaning,
      sounds_like:
        data.sounds_like !== undefined ? cleanText(data.sounds_like, 120, true) : cur.sounds_like,
      tags: data.tags !== undefined ? cleanTags(data.tags) : cur.tags,
      updated_at: nowIso(),
    }
    await db().put('phrases', id, next)
    return next
  })
  const { r } = await resolver()
  return phraseJson(row, r)
}

export async function deletePhrase(id: string): Promise<void> {
  await exclusive(async () => {
    if (!(await db().get('phrases', id))) throw fail(404, 'NOT_FOUND', 'Phrase not found.')
    await db().del('phrases', id)
  })
}

export async function exportPhrases(): Promise<Blob> {
  const { items } = await listPhrases('', '', MAX_PHRASES)
  const body = {
    format: 'studio-bars-phrases',
    schema_version: 1,
    exported_at: nowIso(),
    phrases: items.map((i) => ({
      phrase: i.phrase,
      meaning: i.meaning,
      sounds_like: i.sounds_like,
      tags: i.tags,
    })),
  }
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
}

export async function phraseRhymes(
  phrase: string,
  syllables: number,
  qualities: string[],
  familiarity: 'any' | 'familiar' | 'common' = 'familiar',
  limit = 80,
): Promise<PhraseRhymes> {
  const { d, r, custom } = await resolver()
  if (/\n/.test(phrase) || !phrase.trim() || phrase.length > 120)
    throw fail(422, 'BAD_PHRASE', 'Give one line of text.')
  const want = new Set(qualities.filter(Boolean))
  if (!want.size || [...want].some((q) => !['perfect', 'near', 'assonance'].includes(q)))
    throw fail(422, 'BAD_QUALITY', 'Rhyme types here are perfect, near and assonance.')
  const [phones, unknown] = phrasePhones(phrase, r)
  if (unknown.length)
    throw Object.assign(
      fail(
        422,
        'UNKNOWN_WORDS',
        'I don’t know how these sound yet: ' +
          unknown.join(', ') +
          '. Teach them in the Rhymes tab first.',
      ),
      { words: unknown },
    )
  const have = syllableCount(phones)
  if (have < syllables)
    throw fail(
      422,
      'TOO_SHORT',
      `That phrase has only ${have} syllable(s); choose ${have} or fewer.`,
    )
  const t = tail(phones, syllables)!
  let minZipf: number | null = ZIPF[familiarity]
  const notes = [
    'Experimental: this compares the last sounds of your phrase with single words and your phrase bank. It can miss good rhymes and include loose ones.',
    'Where a word has several ways to say it, only the first dictionary pronunciation of each word in YOUR phrase is used.',
  ]
  if (minZipf !== null && !d.hasFrequency) {
    notes.push(
      'Word-familiarity data is not installed, so results are not filtered by how common a word is.',
    )
    minZipf = null
  }
  const inPhrase = new Set(tokenize(phrase).map((x) => x.norm))
  const vowelSeq = t.filter((p) => VOWELS.has(p)).join(' ')
  type R = {
    text: string
    kind: 'word' | 'mine'
    quality: 'perfect' | 'near' | 'assonance'
    ipa: string
    syllables: number
    zipf: number | null
  }
  const results = new Map<string, R>()
  for (const [w, ph] of d.vowelIndex(syllables).get(vowelSeq) ?? []) {
    if (inPhrase.has(w) || custom.has(w)) continue
    const q = classifyTail(t, tail(ph, syllables) ?? [])
    if (!q || !want.has(q)) continue
    const z = d.zipf(w)
    if (minZipf !== null && d.hasFrequency && (z === null || z < minZipf)) continue
    const old = results.get(w)
    if (!old || (RANK[q] ?? 9) < (RANK[old.quality] ?? 9))
      results.set(w, {
        text: w,
        kind: 'word',
        quality: q,
        ipa: readableIpa(ph),
        syllables: syllableCount(ph),
        zipf: z,
      })
  }
  const own: [string, Phones][] = [...custom].filter(([cw]) => !inPhrase.has(cw))
  for (const item of (await listPhrases('', '', 500)).items) {
    const [ph2, unk] = phrasePhones(item.sounds_like || item.phrase, r)
    if (!unk.length && ph2.length) own.push([item.phrase, ph2])
  }
  const mine = new Map<string, R>()
  for (const [text, ph] of own) {
    const tt = tail(ph, syllables)
    const q = tt ? classifyTail(t, tt) : null
    if (q && want.has(q) && !inPhrase.has(text.toLowerCase()))
      mine.set(text, {
        text,
        kind: 'mine',
        quality: q,
        ipa: readableIpa(ph),
        syllables: syllableCount(ph),
        zipf: null,
      })
  }
  const qo = { perfect: 0, near: 1, assonance: 2 }
  const ranked = [...mine.values(), ...results.values()].sort(
    (a, b) =>
      qo[a.quality] - qo[b.quality] ||
      (a.kind === 'mine' ? 0 : 1) - (b.kind === 'mine' ? 0 : 1) ||
      -(a.zipf ?? 0) + (b.zipf ?? 0) ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  )
  return {
    phrase,
    syllables,
    tail_ipa: readableIpa(t),
    experimental: true,
    notes,
    total: ranked.length,
    results: ranked.slice(0, limit).map(({ zipf: _z, ...rest }) => {
      void _z
      return rest
    }),
  }
}
