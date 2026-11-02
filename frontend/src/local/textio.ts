/**
 * Plain-text / Markdown / JSON conversion for the phone version.
 * A line-for-line port of backend/app/textio.py so files move between the PC and phone versions unchanged.
 */
import { MAX_LINE_CHARS, MAX_LINES, type Genre, type SectionType, type Song } from '../types'

export const MAX_SECTIONS = 100
const SECTION_WORDS = '(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro)'
const BRACKET = /^\s*\[(.+?)\]\s*$/
const MD_HEAD = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/
const WORD_HEAD = new RegExp(`^\\s*(${SECTION_WORDS}(?:\\s+\\d+)?)\\s*:\\s*$`, 'i')
const GENRE_IDS: Genre[] = ['hip-hop', 'r&b', 'house', 'pop']
const TYPES: SectionType[] = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'hook',
  'bridge',
  'outro',
  'custom',
]

export class ParseError extends Error {}

export type ParsedLine = { text: string; is_locked: boolean; comments: string[] }
export type ParsedSection = { label: string; section_type: string; lines: ParsedLine[] }
export type ParsedSong = {
  title: string | null
  sections: ParsedSection[]
  genres: Genre[]
  bpm: number | null
  time_signature: string | null
  concept: string
  mood: string
  point_of_view: string
  warnings: string[]
}

const pl = (text: string): ParsedLine => ({ text, is_locked: false, comments: [] })
const rstrip = (s: string) => s.replace(/\s+$/, '')

export function inferType(label: string): SectionType {
  const low = label.toLowerCase().trim()
  if (/^pre[- ]?chorus/.test(low)) return 'pre-chorus'
  for (const t of ['intro', 'verse', 'chorus', 'hook', 'bridge', 'outro'] as const)
    if (low.startsWith(t)) return t
  return 'custom'
}

export const sectionType = (t: string): SectionType =>
  TYPES.includes(t as SectionType) ? (t as SectionType) : 'custom'

function finish(sections: ParsedSection[]): ParsedSection[] {
  const out: ParsedSection[] = []
  for (const s of sections) {
    const lines = s.lines.slice()
    while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop()
    while (lines.length && !lines[0].text.trim()) lines.shift()
    if (lines.length) out.push({ ...s, lines })
  }
  return out
}

function checkLimits(sections: ParsedSection[]) {
  if (sections.length > MAX_SECTIONS)
    throw new ParseError(`Too many sections (limit ${MAX_SECTIONS}).`)
  if (sections.reduce((n, s) => n + s.lines.length, 0) > MAX_LINES)
    throw new ParseError(`Too many lines (limit ${MAX_LINES}).`)
}

const empty = (
  title: string | null,
  sections: ParsedSection[],
  warnings: string[] = [],
): ParsedSong => ({
  title,
  sections,
  genres: [],
  bpm: null,
  time_signature: null,
  concept: '',
  mood: '',
  point_of_view: '',
  warnings,
})

export function parseText(content: string, fmt: 'txt' | 'md'): ParsedSong {
  const text = content
    .replace(/^\uFEFF+/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  let title: string | null = null
  let sections: ParsedSection[] = []
  let current: ParsedSection | null = null
  const warnings: string[] = []
  let sawHeader = false
  const raw = text.split('\n')
  for (let idx = 0; idx < raw.length; idx++) {
    const line = rstrip(raw[idx])
    let header: string | null = null
    const md = fmt === 'md' ? MD_HEAD.exec(line) : null
    if (md) {
      const level = md[1].length
      const label = md[2].trim()
      if (level === 1 && title === null && sections.length === 0 && current === null) {
        title = label
        continue
      }
      header = label
    } else if (BRACKET.test(line)) header = BRACKET.exec(line)![1].trim()
    else if (WORD_HEAD.test(line)) header = WORD_HEAD.exec(line)![1].trim()
    if (header !== null) {
      sawHeader = true
      current = { label: header.slice(0, 60), section_type: inferType(header), lines: [] }
      sections.push(current)
      continue
    }
    if (current === null && !line.trim()) continue
    if (fmt === 'md' && current === null && /^(Genres|BPM):/.test(line)) continue
    if (line.length > MAX_LINE_CHARS)
      throw new ParseError(`Line ${idx + 1} is longer than ${MAX_LINE_CHARS} characters.`)
    if (current === null) {
      current = { label: 'Section 1', section_type: 'custom', lines: [] }
      sections.push(current)
    }
    current.lines.push(pl(line))
  }
  if (!sawHeader) {
    const blocks: string[][] = [[]]
    for (const ln of sections.flatMap((s) => s.lines)) {
      if (ln.text.trim()) blocks[blocks.length - 1].push(ln.text)
      else if (blocks[blocks.length - 1].length) blocks.push([])
    }
    const full = blocks.filter((b) => b.length)
    sections = full.map((b, i) => ({
      label: `Section ${i + 1}`,
      section_type: 'custom',
      lines: b.map(pl),
    }))
    warnings.push(
      sections.length > 1
        ? 'No section headers found, so blank lines were used to split sections.'
        : 'No section headers found; everything is in one section.',
    )
  }
  sections = finish(sections)
  checkLimits(sections)
  if (!sections.length) throw new ParseError('No lyrics were found in that text.')
  return empty(title, sections, warnings)
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** One song object from a Studio Bars export (shared by single-song files and full backups). */
export function songFromJson(data: Json): ParsedSong {
  const song = data.song
  const secs = data.sections
  if (!isObj(song) || !Array.isArray(secs))
    throw new ParseError('The song export is missing required parts.')
  const sections: ParsedSection[] = secs.map((s) => {
    if (!isObj(s) || !Array.isArray(s.lines))
      throw new ParseError('The song export is missing required parts.')
    const lines = s.lines.map((ln) => {
      if (!isObj(ln) || typeof ln.text !== 'string' || ln.text.includes('\n'))
        throw new ParseError('A lyric line is not valid text.')
      if (ln.text.length > MAX_LINE_CHARS)
        throw new ParseError(`A line is longer than ${MAX_LINE_CHARS} characters.`)
      const comments = Array.isArray(ln.comments)
        ? ln.comments.map((c) => (isObj(c) ? String(c.body ?? '') : '')).filter((b) => b.trim())
        : []
      return { text: ln.text, is_locked: Boolean(ln.is_locked), comments }
    })
    if (s.label === undefined) throw new ParseError('The song export is missing required parts.')
    return {
      label: String(s.label).trim().slice(0, 60) || 'Section',
      section_type: typeof s.section_type === 'string' ? s.section_type : 'custom',
      lines,
    }
  })
  const parsed: ParsedSong = {
    title: String(song.title ?? '') || null,
    sections,
    genres: Array.isArray(song.genres)
      ? (song.genres.filter((g) => GENRE_IDS.includes(g as Genre)) as Genre[])
      : [],
    bpm: typeof song.bpm === 'number' ? song.bpm : null,
    time_signature: typeof song.time_signature === 'string' ? song.time_signature : null,
    concept: String(song.concept ?? '').slice(0, 2000),
    mood: String(song.mood ?? '').slice(0, 200),
    point_of_view: String(song.point_of_view ?? '').slice(0, 200),
    warnings: [],
  }
  checkLimits(parsed.sections)
  if (!parsed.sections.length) throw new ParseError('The song export contains no sections.')
  return parsed
}

export function parseJson(content: string): ParsedSong {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (e) {
    throw new ParseError(
      `That is not valid JSON (${e instanceof Error ? e.message : 'unreadable'}).`,
    )
  }
  if (!isObj(data) || data.format !== 'studio-bars-song') {
    if (isObj(data) && data.format === 'studio-bars-backup')
      throw new ParseError(
        'This is a full backup. Use “Restore a backup” on the songs page instead.',
      )
    throw new ParseError('This JSON is not a Studio Bars song export.')
  }
  if (data.schema_version !== 1) throw new ParseError('Unsupported export version.')
  return songFromJson(data)
}

export const parseAny = (content: string, fmt: 'json' | 'txt' | 'md'): ParsedSong =>
  fmt === 'json' ? parseJson(content) : parseText(content, fmt)

// ---------------------------------------------------------------- export (same output as the PC version)

export function exportTxt(song: Song): string {
  return (
    song.sections
      .map((s) => [`[${s.label}]`, ...s.lines.map((l) => l.text)].join('\n'))
      .join('\n\n') + '\n'
  )
}

export function exportMd(song: Song): string {
  const parts = [`# ${song.title}`]
  const meta: string[] = []
  if (song.genres.length) meta.push('Genres: ' + song.genres.join(', '))
  if (song.bpm) meta.push(`BPM: ${song.bpm}`)
  if (meta.length) parts.push(meta.join('  \n'))
  for (const s of song.sections)
    parts.push([`## ${s.label}`, ...s.lines.map((l) => l.text)].join('\n'))
  return parts.join('\n\n') + '\n'
}

export function songJson(song: Song, exportedAt: string) {
  return {
    format: 'studio-bars-song',
    schema_version: 1,
    exported_at: exportedAt,
    song: {
      title: song.title,
      concept: song.concept,
      mood: song.mood,
      point_of_view: song.point_of_view,
      bpm: song.bpm,
      time_signature: song.time_signature,
      genres: song.genres,
    },
    sections: song.sections.map((s) => ({
      label: s.label,
      section_type: s.section_type,
      lines: s.lines.map((l) => ({
        text: l.text,
        is_locked: l.is_locked,
        comments: l.comments.map((c) => ({ body: c.body })),
      })),
    })),
  }
}

export const exportJson = (song: Song, exportedAt: string) =>
  JSON.stringify(songJson(song, exportedAt), null, 2) + '\n'
