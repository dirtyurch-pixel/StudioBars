/**
 * Craft tools for the phone version, saved on the device: vault and idea board, alternative takes, story plan,
 * flow grids, "My style", melody sketch and chord marks, scratch vocal recordings.
 * Same rules as backend/app/craft.py, dna.py, melody.py and vocals.py. None of this ever changes your lyrics.
 */
import { ApiFail } from '../../apiFail'
import { newId } from '../../editor/content'
import type { Song } from '../../types'
import { loadDictionary } from '../data'
import { db, getSong, nowIso } from '../localApi'
import { STOPWORDS, Resolver, analyzeLines, tokenize } from '../phonetics/words'
import { exclusive } from '../store'
import { lineSyllables, pyRound, rhymeChains, scanStructure, scanText, singability } from './scan'

const fail = (status: number, code: string, message: string) =>
  new ApiFail(message, { status, code })
const VAULT_KINDS = ['hook', 'punchline', 'bar', 'rhyme', 'idea']
const CONCEPT_KINDS = ['theme', 'character', 'scene', 'title', 'mood', 'arc', 'hook', 'idea']
const MAX_ITEMS = 3000
const MAX_TAKES_PER_LINE = 30
const PLAN_FIELDS = ['scene', 'conflict', 'turning_point', 'emotional_arc', 'notes'] as const
const SUBDIVISIONS: Record<string, number> = { '8th': 8, '16th': 16, triplet: 12 }
const MAX_BARS = 2

type Rec = { type: string; id: string; song_id: string | null; [k: string]: unknown }
const all = async <T extends Rec>(type: string) =>
  (await db().all<Rec>('craft')).filter((r) => r.type === type) as T[]

async function resolver() {
  const d = await loadDictionary()
  return new Resolver(
    d,
    new Map(
      (await db().all<{ word: string; phones: string }>('custom')).map((x) => [
        x.word,
        x.phones.split(' '),
      ]),
    ),
  )
}
async function songOk(id: string): Promise<Song> {
  return getSong(id) // 404 for a missing or trashed song
}
const lineIn = (song: Song, lineId: string) =>
  song.sections.some((s) => s.lines.some((l) => l.id === lineId))

// ---------------------------------------------------------------- vault and idea board

type Item = Rec & {
  kind: string
  text: string
  tags: string[]
  created_at: string
  updated_at: string
  seq: number
}
const itemJson = (r: Item) => ({
  id: r.id,
  song_id: r.song_id,
  kind: r.kind,
  text: r.text,
  tags: r.tags,
  created_at: r.created_at,
  updated_at: r.updated_at,
})
function tags(raw: unknown): string[] {
  const out: string[] = []
  for (const t of Array.isArray(raw) ? raw : []) {
    const v = String(t).toLowerCase().split(/\s+/).filter(Boolean).join(' ').slice(0, 30)
    if (v && !out.includes(v)) out.push(v)
  }
  return out.slice(0, 10)
}

export async function listItems(songId: string | null, kind?: string, q = '', tag = '') {
  if (songId) await songOk(songId)
  let rows = (await all<Item>('item')).filter(
    (r) => (songId ? r.song_id === songId : r.song_id === null) && (!kind || r.kind === kind),
  )
  rows.sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.seq - a.seq,
  )
  const needle = q.trim().toLowerCase()
  if (needle)
    rows = rows.filter(
      (i) => i.text.toLowerCase().includes(needle) || i.tags.some((t) => t.includes(needle)),
    )
  if (tag) rows = rows.filter((i) => i.tags.includes(tag.toLowerCase()))
  return rows.map(itemJson)
}

export async function createItem(data: {
  song_id: string | null
  kind: string
  text: string
  tags: string[]
}) {
  const kinds = data.song_id ? CONCEPT_KINDS : VAULT_KINDS
  if (!kinds.includes(data.kind))
    throw fail(422, 'BAD_KIND', `Kind must be one of: ${kinds.join(', ')}.`)
  const text = data.text
    .trim()
    .split(/\r?\n/)
    .map((row) => row.split(/\s+/).filter(Boolean).join(' '))
    .join('\n')
    .trim()
  if (!text || text.length > 1000)
    throw fail(422, 'BAD_TEXT', 'Write something (up to 1000 characters).')
  if (data.song_id) await songOk(data.song_id)
  return exclusive(async () => {
    const items = await all<Item>('item')
    if (items.length >= MAX_ITEMS)
      throw fail(409, 'FULL', 'Too many saved items. Delete some first.')
    const ts = nowIso()
    const r: Item = {
      type: 'item',
      id: newId(),
      song_id: data.song_id,
      kind: data.kind,
      text,
      tags: tags(data.tags),
      created_at: ts,
      updated_at: ts,
      seq: items.length,
    }
    await db().put('craft', 'item:' + r.id, r)
    return itemJson(r)
  })
}

export async function deleteItem(id: string) {
  await exclusive(async () => {
    if (!(await db().get('craft', 'item:' + id))) throw fail(404, 'NOT_FOUND', 'Item not found.')
    await db().del('craft', 'item:' + id)
  })
}

// ---------------------------------------------------------------- alternative takes

type Take = Rec & {
  line_id: string
  text: string
  favourite: boolean
  note: string
  created_at: string
  seq: number
}
const takeJson = (r: Take) => ({
  id: r.id,
  line_id: r.line_id,
  text: r.text,
  favourite: r.favourite,
  note: r.note,
  created_at: r.created_at,
})

export async function listTakes(songId: string, lineId?: string) {
  await songOk(songId)
  return (await all<Take>('take'))
    .filter((t) => t.song_id === songId && (!lineId || t.line_id === lineId))
    .sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.seq - b.seq,
    )
    .map(takeJson)
}

export async function addTake(songId: string, lineId: string, text: string, note = '') {
  const song = await songOk(songId)
  if (!lineIn(song, lineId)) throw fail(404, 'NOT_FOUND', 'That line is not in this song.')
  const t = text.split(/\s+/).filter(Boolean).join(' ')
  if (!t || t.length > 500)
    throw fail(422, 'BAD_TEXT', 'A take is one line of up to 500 characters.')
  return exclusive(async () => {
    const mine = (await all<Take>('take')).filter(
      (x) => x.song_id === songId && x.line_id === lineId,
    )
    if (mine.length >= MAX_TAKES_PER_LINE)
      throw fail(409, 'FULL', 'That line already has the most takes allowed. Delete some first.')
    const r: Take = {
      type: 'take',
      id: newId(),
      song_id: songId,
      line_id: lineId,
      text: t,
      favourite: false,
      note: note.trim().slice(0, 200),
      created_at: nowIso(),
      seq: mine.length,
    }
    await db().put('craft', 'take:' + r.id, r)
    return takeJson(r)
  })
}

export async function setFavourite(id: string, favourite: boolean) {
  return exclusive(async () => {
    const r = await db().get<Take>('craft', 'take:' + id)
    if (!r) throw fail(404, 'NOT_FOUND', 'Take not found.')
    r.favourite = favourite
    await db().put('craft', 'take:' + id, r)
    return takeJson(r)
  })
}

export async function deleteTake(id: string) {
  await exclusive(async () => {
    if (!(await db().get('craft', 'take:' + id))) throw fail(404, 'NOT_FOUND', 'Take not found.')
    await db().del('craft', 'take:' + id)
  })
}

// ---------------------------------------------------------------- story plan

export async function getPlan(songId: string) {
  await songOk(songId)
  const r = await db().get<Rec & { plan: Record<string, string> }>('craft', 'plan:' + songId)
  return Object.fromEntries(PLAN_FIELDS.map((k) => [k, r?.plan[k] ?? ''])) as Record<
    (typeof PLAN_FIELDS)[number],
    string
  >
}

export async function putPlan(songId: string, plan: Record<string, string>) {
  await songOk(songId)
  for (const k of PLAN_FIELDS)
    if (String(plan[k] ?? '').length > 1000)
      throw fail(422, 'INVALID', 'Each part of the plan can be up to 1000 characters.')
  const clean = Object.fromEntries(
    PLAN_FIELDS.map((k) => [
      k,
      String(plan[k] ?? '')
        .trim()
        .slice(0, 1000),
    ]),
  ) as Record<(typeof PLAN_FIELDS)[number], string>
  await db().put('craft', 'plan:' + songId, {
    type: 'plan',
    id: songId,
    song_id: songId,
    plan: clean,
  })
  return clean
}

// ---------------------------------------------------------------- flow grids

type Grid = {
  subdivision: string
  bars: number
  assign: (number | null)[]
  accents: boolean[]
  rests: number[]
}
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

export function validateGrid(g: Grid): Grid {
  if (!(g.subdivision in SUBDIVISIONS))
    throw fail(422, 'BAD_GRID', 'Subdivision must be 8th, 16th or triplet.')
  const bars = g.bars ?? 1
  if (!isInt(bars) || bars < 1 || bars > MAX_BARS)
    throw fail(422, 'BAD_GRID', `A line can cover 1 to ${MAX_BARS} bars.`)
  const slots = SUBDIVISIONS[g.subdivision] * bars
  if (!Array.isArray(g.assign) || g.assign.length > 40)
    throw fail(422, 'BAD_GRID', 'Give a slot (or empty) for each syllable.')
  const seen = new Set<number>()
  const clean = g.assign.map((a) => {
    if (a === null) return null
    if (!isInt(a) || a < 0 || a >= slots)
      throw fail(422, 'BAD_GRID', `Slots run from 0 to ${slots - 1}.`)
    if (seen.has(a)) throw fail(422, 'BAD_GRID', 'Two syllables cannot sit on the same slot.')
    seen.add(a)
    return a
  })
  const accents = g.accents ?? []
  if (!Array.isArray(accents) || accents.length > 40 || accents.some((x) => typeof x !== 'boolean'))
    throw fail(422, 'BAD_GRID', 'Accents must be true/false per syllable.')
  const rests = g.rests ?? []
  if (!Array.isArray(rests) || rests.some((x) => !isInt(x) || x < 0 || x >= slots || seen.has(x)))
    throw fail(422, 'BAD_GRID', 'A rest must be an empty slot inside the line.')
  return {
    subdivision: g.subdivision,
    bars,
    assign: clean,
    accents: accents.slice(0, clean.length),
    rests: [...new Set(rests)].sort((a, b) => a - b),
  }
}

export async function getGrids(songId: string) {
  await songOk(songId)
  const out: Record<string, Grid> = {}
  for (const r of await all<Rec & { line_id: string; grid: Grid }>('grid'))
    if (r.song_id === songId) out[r.line_id] = r.grid
  return out
}

export async function putGrid(songId: string, lineId: string, grid: Grid) {
  const song = await songOk(songId)
  if (!lineIn(song, lineId)) throw fail(404, 'NOT_FOUND', 'That line is not in this song.')
  const clean = validateGrid(grid)
  await db().put('craft', `grid:${songId}:${lineId}`, {
    type: 'grid',
    id: `${songId}:${lineId}`,
    song_id: songId,
    line_id: lineId,
    grid: clean,
  })
  return clean
}

export async function deleteGrid(songId: string, lineId: string) {
  await db().del('craft', `grid:${songId}:${lineId}`)
}

// ---------------------------------------------------------------- analysis

export async function syllables(text: string) {
  return {
    syllables: lineSyllables(text, await resolver()),
    note: 'Stress comes from the dictionary; words it does not know are marked as guesses.',
  }
}

export async function scanSong(songId: string) {
  const song = await songOk(songId)
  const r = await resolver()
  return { ...scanText(song), structure: scanStructure(song, r), singability: singability(song, r) }
}

export async function chains(lines: string[], strictness: string) {
  if (!lines.some((t) => t.trim())) throw fail(422, 'EMPTY', 'Give some lines to look at.')
  if (!['strict', 'normal', 'loose'].includes(strictness))
    throw fail(422, 'INVALID', 'Strictness must be strict, normal or loose.')
  return rhymeChains(lines, await resolver(), strictness)
}

// ---------------------------------------------------------------- My style (Writing DNA)

const MIN_WORD_COUNT = 2
type Dna = Rec & { approved_at: string }

export async function dnaApproved(): Promise<string[]> {
  const rows = (await all<Dna>('dna')).sort((a, b) => (a.approved_at < b.approved_at ? -1 : 1))
  const out: string[] = []
  for (const r of rows) {
    try {
      await getSong(r.id)
      out.push(r.id)
    } catch {
      /* trashed songs are left out */
    }
  }
  return out
}
export async function dnaApprove(songId: string) {
  await songOk(songId)
  if (!(await db().get('craft', 'dna:' + songId)))
    await db().put('craft', 'dna:' + songId, {
      type: 'dna',
      id: songId,
      song_id: songId,
      approved_at: nowIso(),
    })
}
export async function dnaRemove(songId: string) {
  await db().del('craft', 'dna:' + songId)
}
export async function dnaClear() {
  for (const r of await all<Dna>('dna')) await db().del('craft', 'dna:' + r.id)
}

const mostCommon = (m: Map<string, number>, n: number) =>
  [...m]
    .map((e, i) => [e, i] as const)
    .sort((a, b) => b[0][1] - a[0][1] || a[1] - b[1])
    .slice(0, n)
    .map(([e]) => e)

export async function dnaProfile() {
  const ids = await dnaApproved()
  if (!ids.length) return { songs: [], empty: true }
  const r = await resolver()
  const words = new Map<string, number>()
  const openers = new Map<string, number>()
  const sounds = new Map<string, Map<string, number>>()
  const mids: number[] = []
  const wpl: number[] = []
  let endTotal = 0
  let endIn = 0
  let nLines = 0
  const titles: { id: string; title: string }[] = []
  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
  for (const sid of ids) {
    const song = await getSong(sid)
    titles.push({ id: sid, title: song.title })
    for (const sec of song.sections) {
      const texts = sec.lines.map((l) => l.text).filter((t) => t.trim())
      if (!texts.length) continue
      const res = analyzeLines(texts, r)
      texts.forEach((text, i) => {
        const line = res.lines[i]
        nLines++
        const toks = tokenize(text)
        wpl.push(toks.length)
        if (toks.length) inc(openers, toks[0].norm)
        mids.push((line.syllables.min + line.syllables.max) / 2)
        for (const t of toks) if (!STOPWORDS.has(t.norm) && t.norm.length > 2) inc(words, t.norm)
        for (const w of line.words)
          if (w.is_end) {
            endTotal++
            if (w.family !== null) endIn++
          }
      })
      for (const fam of res.families) {
        if (!sounds.has(fam.sound)) sounds.set(fam.sound, new Map())
        inc(sounds.get(fam.sound)!, sec.label, fam.size)
      }
    }
  }
  const allWords = [...words.values()].reduce((a, b) => a + b, 0)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
  return {
    empty: false,
    songs: titles,
    lines: nLines,
    avg_syllables_per_line: mids.length ? pyRound(mean(mids), 1) : null,
    avg_words_per_line: wpl.length ? pyRound(mean(wpl), 1) : null,
    end_rhyme_share: endTotal ? pyRound(endIn / endTotal, 2) : null,
    vocabulary_variety: allWords ? pyRound(words.size / allWords, 2) : null,
    favourite_words: mostCommon(words, 40)
      .filter(([, c]) => c >= MIN_WORD_COUNT)
      .slice(0, 20)
      .map(([word, count]) => ({ word, count })),
    common_openers: mostCommon(openers, 8)
      .filter(([, c]) => c >= MIN_WORD_COUNT)
      .map(([word, count]) => ({ word, count })),
    rhyme_sounds: [...sounds]
      .map((e, i) => [e, i] as const)
      .sort((a, b) => total(b[0][1]) - total(a[0][1]) || a[1] - b[1])
      .slice(0, 8)
      .map(([[sound, c]]) => ({ sound, uses: total(c) })),
    note: 'Computed now from the songs you approved, with simple counting. It describes habits; it is not a judgement and is never sent to the AI.',
  }
}

// ---------------------------------------------------------------- melody sketch and chords

const MAX_NOTES = 600
const MAX_MEL_BARS = 64
const CHORD =
  /^[A-G][#b]?(?:maj|min|m|dim|aug|sus[24]?|add\d{1,2}|\d{1,2}|\+|°|ø|-)*(?:\/[A-G][#b]?)?$/
type MelNote = { id?: string; start16: number; len16: number; midi: number }

export async function getMelody(songId: string) {
  await songOk(songId)
  const r = await db().get<Rec & { notes: MelNote[]; chords: Record<string, string> }>(
    'craft',
    'melody:' + songId,
  )
  return {
    notes: (r?.notes ?? []).slice().sort((a, b) => a.start16 - b.start16 || a.midi - b.midi),
    chords: r?.chords ?? {},
  }
}

export async function putMelody(songId: string, notes: MelNote[], chords: Record<string, string>) {
  await songOk(songId)
  if (notes.length > MAX_NOTES)
    throw fail(422, 'TOO_MANY', `A sketch can have at most ${MAX_NOTES} notes.`)
  const occupied = new Set<string>()
  const cleanNotes = notes.map((n) => {
    const { start16: s, len16: l, midi } = n
    if (
      ![s, l, midi].every(isInt) ||
      s < 0 ||
      s >= MAX_MEL_BARS * 16 ||
      l < 1 ||
      l > 64 ||
      s + l > MAX_MEL_BARS * 16
    )
      throw fail(
        422,
        'BAD_NOTE',
        'A note must sit inside the first 64 bars and last 1 to 64 sixteenths.',
      )
    if (midi < 36 || midi > 96) throw fail(422, 'BAD_NOTE', 'Pitch must be between C2 and C7.')
    for (let t = s; t < s + l; t++) {
      const k = `${t}:${midi}`
      if (occupied.has(k)) throw fail(422, 'BAD_NOTE', 'Two notes of the same pitch overlap.')
      occupied.add(k)
    }
    return { id: newId(), start16: s, len16: l, midi }
  })
  const cleanChords: Record<string, string> = {}
  for (const [barS, symRaw] of Object.entries(chords)) {
    if (!/^-?\d+$/.test(barS)) throw fail(422, 'BAD_CHORD', 'Bar numbers must be whole numbers.')
    const bar = parseInt(barS, 10)
    const sym = String(symRaw).trim()
    if (bar < 0 || bar >= MAX_MEL_BARS)
      throw fail(422, 'BAD_CHORD', `Bars run from 1 to ${MAX_MEL_BARS}.`)
    if (!sym) continue
    if (sym.length > 12 || !CHORD.test(sym))
      throw fail(
        422,
        'BAD_CHORD',
        `“${sym}” is not a chord symbol I understand (try C, Am, G7, Fmaj7, D/F#).`,
      )
    cleanChords[String(bar)] = sym
  }
  await db().put('craft', 'melody:' + songId, {
    type: 'melody',
    id: songId,
    song_id: songId,
    notes: cleanNotes,
    chords: cleanChords,
  })
  return getMelody(songId)
}

// ---------------------------------------------------------------- scratch vocal recordings (audio kept on the device)

type Vocal = {
  id: string
  song_id: string
  blob: Blob
  duration_ms: number
  offset_ms: number
  note: string
  created_at: string
  media_type: string
  size_bytes: number
}
const MAX_VOCAL_BYTES = 150 * 1024 * 1024
const MAX_VOCALS = 100
const urls = new Map<string, string>()
const vocalJson = (v: Vocal) => {
  if (!urls.has(v.id)) urls.set(v.id, URL.createObjectURL(v.blob))
  return {
    id: v.id,
    song_id: v.song_id,
    duration_ms: v.duration_ms,
    offset_ms: v.offset_ms,
    note: v.note,
    size_bytes: v.size_bytes,
    media_type: v.media_type,
    created_at: v.created_at,
    available: true,
    url: urls.get(v.id)!,
  }
}

export async function listVocals(songId: string) {
  await songOk(songId)
  return (await db().all<Vocal>('vocals'))
    .filter((v) => v.song_id === songId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map(vocalJson)
}

export async function addVocal(songId: string, blob: Blob, durationMs: number, offsetMs: number) {
  await songOk(songId)
  if (!blob.size) throw fail(422, 'BAD_AUDIO', 'That does not look like a valid recording.')
  if (blob.size > MAX_VOCAL_BYTES) throw fail(413, 'TOO_LARGE', 'That recording is too large.')
  if (!/^(audio|video)\/(webm|ogg|mp4|x-m4a|wav|x-wav|wave)/.test(blob.type || 'audio/webm'))
    throw fail(415, 'UNSUPPORTED_FORMAT', 'That recording format is not supported.')
  if (!Number.isFinite(durationMs) || durationMs < 0 || Math.abs(offsetMs) > 6 * 3600 * 1000)
    throw fail(422, 'BAD_NUMBER', 'Duration or offset is out of range.')
  return exclusive(async () => {
    if ((await db().all<Vocal>('vocals')).filter((v) => v.song_id === songId).length >= MAX_VOCALS)
      throw fail(409, 'FULL', 'This song already has the most takes allowed. Delete some first.')
    const v: Vocal = {
      id: newId(),
      song_id: songId,
      blob,
      duration_ms: Math.round(durationMs),
      offset_ms: Math.round(offsetMs),
      note: '',
      created_at: nowIso(),
      media_type: blob.type || 'audio/webm',
      size_bytes: blob.size,
    }
    await db().put('vocals', v.id, v)
    return vocalJson(v)
  })
}

export async function patchVocal(id: string, data: { note?: string; offset_ms?: number }) {
  return exclusive(async () => {
    const v = await db().get<Vocal>('vocals', id)
    if (!v) throw fail(404, 'NOT_FOUND', 'Take not found.')
    if (
      data.offset_ms !== undefined &&
      (!Number.isFinite(data.offset_ms) || Math.abs(data.offset_ms) > 6 * 3600 * 1000)
    )
      throw fail(422, 'BAD_NUMBER', 'Offset is out of range.')
    if (data.note !== undefined) v.note = data.note.trim().slice(0, 200)
    if (data.offset_ms !== undefined) v.offset_ms = Math.round(data.offset_ms)
    await db().put('vocals', id, v)
    return vocalJson(v)
  })
}

export async function deleteVocal(id: string) {
  await exclusive(async () => {
    if (!(await db().get('vocals', id))) throw fail(404, 'NOT_FOUND', 'Take not found.')
    await db().del('vocals', id)
    const u = urls.get(id)
    if (u) URL.revokeObjectURL(u)
    urls.delete(id)
  })
}
