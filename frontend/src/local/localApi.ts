/**
 * The phone version's "server", running inside the app. It follows the same rules as backend/app/service.py:
 * locked lines can never change or disappear, saves are refused if the song changed in another tab,
 * history snapshots are kept, and imports always create a NEW song.
 */
import { ApiFail } from '../apiFail'
import { newId } from '../editor/content'
import {
  MAX_LINE_CHARS,
  MAX_LINES,
  type Comment,
  type Content,
  type Genre,
  type ImportPreview,
  type Line,
  type Revision,
  type Section,
  type SectionType,
  type Song,
  type SongSummary,
} from '../types'
import { exclusive, IdbStore, MemoryStore, type Store } from './store'
import {
  MAX_SECTIONS,
  ParseError,
  exportJson,
  exportMd,
  exportTxt,
  parseAny,
  sectionType,
  songFromJson,
  songJson,
  type ParsedSong,
} from './textio'

type StoredSong = Song & { deleted_at: string | null }
type Snapshot = {
  song: Pick<
    Song,
    'title' | 'concept' | 'mood' | 'point_of_view' | 'bpm' | 'time_signature' | 'genres'
  >
  sections: Section[]
}
type StoredRevision = {
  id: string
  song_id: string
  created_at: string
  kind: Revision['kind']
  description: string
  snapshot: Snapshot
}
export type ImportFormat = 'json' | 'txt' | 'md'

const GENRES: Genre[] = ['hip-hop', 'r&b', 'house', 'pop']
const TIME_SIG = /^\d{1,2}\/\d{1,2}$/
export const AUTO_SNAPSHOT_SECONDS = 300

let store: Store | null = null
export function useStore(s: Store) {
  store = s
}
function db(): Store {
  if (!store) store = typeof indexedDB !== 'undefined' ? new IdbStore() : new MemoryStore()
  return store
}

let clock = () => new Date()
export function setClock(fn: () => Date) {
  clock = fn
}
const now = () => clock().toISOString()

const fail = (
  status: number,
  code: string,
  message: string,
  extra: { lineIds?: string[]; currentVersion?: number } = {},
) => new ApiFail(message, { status, code, ...extra })
const notFound = (what = 'Song') => fail(404, 'NOT_FOUND', `${what} not found.`)

function clean(s: StoredSong): Song {
  const { deleted_at: _d, ...song } = s
  void _d
  return structuredClone(song)
}

async function getStored(id: string, includeDeleted = false): Promise<StoredSong> {
  const s = await db().get<StoredSong>('songs', id)
  if (!s || (s.deleted_at && !includeDeleted)) throw notFound()
  return s
}

function validGenres(g: unknown): Genre[] {
  if (!Array.isArray(g) || g.length > 4 || g.some((x) => !GENRES.includes(x as Genre)))
    throw fail(422, 'INVALID', 'Some of that input is not allowed.')
  return [...new Set(g as Genre[])]
}
function validTitle(t: unknown): string {
  const v = typeof t === 'string' ? t.trim() : ''
  if (!v || v.length > 200)
    throw fail(422, 'INVALID', 'Title cannot be empty (and at most 200 characters).')
  return v
}
function validBpm(b: unknown): number | null {
  if (b === null || b === undefined) return null
  if (typeof b !== 'number' || !Number.isInteger(b) || b < 30 || b > 300)
    throw fail(422, 'INVALID', 'BPM must be between 30 and 300.')
  return b
}
function validTs(t: unknown): string | null {
  if (t === null || t === undefined || t === '') return null
  if (typeof t !== 'string' || !TIME_SIG.test(t))
    throw fail(422, 'INVALID', 'Time signature must look like 4/4.')
  return t
}

const blank = (): Line => ({ id: newId(), text: '', is_locked: false, comments: [] })
const TEMPLATES: Record<'blank' | 'verse-chorus', [string, SectionType][]> = {
  blank: [['Verse 1', 'verse']],
  'verse-chorus': [
    ['Verse 1', 'verse'],
    ['Chorus', 'chorus'],
    ['Verse 2', 'verse'],
    ['Bridge', 'bridge'],
  ],
}

// ---------------------------------------------------------------- songs

export async function health() {
  return { status: 'ok', service: 'studio-bars-phone', version: 'phone-1' }
}

export async function listSongs(trash = false): Promise<SongSummary[]> {
  const all = await db().all<StoredSong>('songs')
  return all
    .filter((s) => (trash ? !!s.deleted_at : !s.deleted_at))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .map((s) => ({
      id: s.id,
      title: s.title,
      bpm: s.bpm,
      time_signature: s.time_signature,
      updated_at: s.updated_at,
      deleted_at: s.deleted_at,
      genres: s.genres,
      line_count: s.sections.reduce(
        (n, sec) => n + sec.lines.filter((l) => l.text !== '').length,
        0,
      ),
      locked_count: s.sections.reduce(
        (n, sec) => n + sec.lines.filter((l) => l.is_locked).length,
        0,
      ),
    }))
}

export async function getSong(id: string): Promise<Song> {
  return clean(await getStored(id))
}

export async function createSong(data: {
  title: string
  genres: Genre[]
  bpm?: number | null
  time_signature?: string | null
  template: 'blank' | 'verse-chorus'
}): Promise<Song> {
  const ts = now()
  const song: StoredSong = {
    id: newId(),
    title: validTitle(data.title),
    concept: '',
    mood: '',
    point_of_view: '',
    bpm: validBpm(data.bpm),
    time_signature: validTs(data.time_signature),
    version: 1,
    created_at: ts,
    updated_at: ts,
    genres: validGenres(data.genres ?? []),
    sections: (TEMPLATES[data.template] ?? TEMPLATES.blank).map(([label, t]) => ({
      id: newId(),
      label,
      section_type: t,
      lines: [blank(), blank(), blank(), blank()],
    })),
    deleted_at: null,
  }
  await exclusive(() => db().put('songs', song.id, song))
  return clean(song)
}

export async function patchSong(
  id: string,
  data: Partial<Pick<Song, 'title' | 'genres' | 'bpm' | 'time_signature'>>,
): Promise<Song> {
  return exclusive(async () => {
    const s = await getStored(id)
    if ('title' in data) s.title = validTitle(data.title)
    if ('genres' in data && data.genres !== undefined && data.genres !== null)
      s.genres = validGenres(data.genres)
    if ('bpm' in data) s.bpm = validBpm(data.bpm)
    if ('time_signature' in data) s.time_signature = validTs(data.time_signature)
    s.updated_at = now()
    await db().put('songs', id, s)
    return clean(s)
  })
}

export async function deleteSong(id: string): Promise<void> {
  await exclusive(async () => {
    const s = await getStored(id)
    s.deleted_at = now()
    await db().put('songs', id, s)
  })
}

export async function undeleteSong(id: string): Promise<Song> {
  return exclusive(async () => {
    const s = await getStored(id, true)
    s.deleted_at = null
    s.updated_at = now()
    await db().put('songs', id, s)
    return clean(s)
  })
}

// ---------------------------------------------------------------- content

const lockedOf = (s: Song) =>
  new Map(
    s.sections.flatMap((sec) =>
      sec.lines.filter((l) => l.is_locked).map((l) => [l.id, l.text] as const),
    ),
  )
const lockViolations = (locked: Map<string, string>, texts: Map<string, string>) =>
  [...locked]
    .filter(([id, t]) => texts.get(id) !== t)
    .map(([id]) => id)
    .sort()

const ID_OK = /^[A-Za-z0-9_-]{8,64}$/

export async function saveContent(
  id: string,
  baseVersion: number,
  content: Content,
): Promise<Song> {
  const secIds = content.map((s) => s.id)
  const lineIds = content.flatMap((s) => s.lines.map((l) => l.id))
  if (new Set(secIds).size !== secIds.length || new Set(lineIds).size !== lineIds.length)
    throw fail(422, 'DUPLICATE_ID', 'Duplicate section or line ids.')
  if (lineIds.length > MAX_LINES)
    throw fail(422, 'TOO_MANY_LINES', `Too many lines (limit ${MAX_LINES}).`)
  if (content.length > MAX_SECTIONS)
    throw fail(422, 'INVALID', `Too many sections (limit ${MAX_SECTIONS}).`)
  for (const s of content) {
    const label = s.label.trim()
    if (!ID_OK.test(s.id) || !label || label.length > 60)
      throw fail(422, 'INVALID', 'Some of that input is not allowed.')
    for (const l of s.lines)
      if (!ID_OK.test(l.id) || l.text.length > MAX_LINE_CHARS || /[\r\n]/.test(l.text))
        throw fail(422, 'INVALID', 'Some of that input is not allowed.')
  }
  return exclusive(async () => {
    const song = await getStored(id)
    if (song.version !== baseVersion)
      throw fail(409, 'VERSION_CONFLICT', 'This song was changed somewhere else.', {
        currentVersion: song.version,
      })
    // refuse ids that belong to a different song
    const mine = new Set(song.sections.flatMap((s) => [s.id, ...s.lines.map((l) => l.id)]))
    const wanted = new Set([...secIds, ...lineIds].filter((x) => !mine.has(x)))
    if (wanted.size) {
      for (const other of await db().all<StoredSong>('songs')) {
        if (other.id === id) continue
        if (other.sections.some((s) => wanted.has(s.id) || s.lines.some((l) => wanted.has(l.id))))
          throw fail(422, 'FOREIGN_ID', 'An id belongs to another song.')
      }
    }
    const texts = new Map(content.flatMap((s) => s.lines.map((l) => [l.id, l.text] as const)))
    const bad = lockViolations(lockedOf(song), texts)
    if (bad.length)
      throw fail(423, 'LOCKED_LINES', 'Locked lines cannot be changed or removed.', {
        lineIds: bad,
      })
    const old = new Map(song.sections.flatMap((s) => s.lines.map((l) => [l.id, l] as const)))
    song.sections = content.map((s) => ({
      id: s.id,
      label: s.label.trim(),
      section_type: sectionType(s.section_type),
      lines: s.lines.map((l) => {
        const prev = old.get(l.id)
        return prev
          ? { ...prev, text: prev.is_locked ? prev.text : l.text }
          : { id: l.id, text: l.text, is_locked: false, comments: [] }
      }),
    }))
    song.version += 1
    song.updated_at = now()
    await db().put('songs', id, song)
    await maybeAutoSnapshot(song)
    return clean(song)
  })
}

async function findLine(lineId: string): Promise<{ song: StoredSong; line: Line }> {
  for (const s of await db().all<StoredSong>('songs')) {
    if (s.deleted_at) continue
    for (const sec of s.sections) {
      const line = sec.lines.find((l) => l.id === lineId)
      if (line) return { song: s, line }
    }
  }
  throw notFound('Line')
}

export async function lockLine(lineId: string, locked: boolean): Promise<Song> {
  return exclusive(async () => {
    const { song, line } = await findLine(lineId)
    line.is_locked = locked
    await db().put('songs', song.id, song)
    return clean(song)
  })
}

function validBody(b: string) {
  const v = b.trim()
  if (!v || v.length > 2000) throw fail(422, 'INVALID', 'A note must be 1 to 2000 characters.')
  return v
}

export async function addComment(lineId: string, body: string): Promise<Song> {
  const text = validBody(body)
  return exclusive(async () => {
    const { song, line } = await findLine(lineId)
    const ts = now()
    line.comments.push({ id: newId(), body: text, created_at: ts, updated_at: ts })
    await db().put('songs', song.id, song)
    return clean(song)
  })
}

async function findComment(id: string): Promise<{ song: StoredSong; line: Line; c: Comment }> {
  for (const s of await db().all<StoredSong>('songs'))
    for (const sec of s.sections)
      for (const line of sec.lines) {
        const c = line.comments.find((x) => x.id === id)
        if (c) return { song: s, line, c }
      }
  throw notFound('Comment')
}

export async function editComment(id: string, body: string): Promise<Song> {
  const text = validBody(body)
  return exclusive(async () => {
    const { song, c } = await findComment(id)
    c.body = text
    c.updated_at = now()
    await db().put('songs', song.id, song)
    return clean(song)
  })
}

export async function deleteComment(id: string): Promise<Song> {
  return exclusive(async () => {
    const { song, line } = await findComment(id)
    line.comments = line.comments.filter((x) => x.id !== id)
    await db().put('songs', song.id, song)
    return clean(song)
  })
}

// ---------------------------------------------------------------- history

const snapshotOf = (s: Song): Snapshot => ({
  song: {
    title: s.title,
    concept: s.concept,
    mood: s.mood,
    point_of_view: s.point_of_view,
    bpm: s.bpm,
    time_signature: s.time_signature,
    genres: [...s.genres],
  },
  sections: structuredClone(s.sections),
})

async function writeRevision(song: Song, kind: Revision['kind'], description: string) {
  const r: StoredRevision = {
    id: newId(),
    song_id: song.id,
    created_at: now(),
    kind,
    description,
    snapshot: snapshotOf(song),
  }
  await db().put('revisions', r.id, r)
}

async function revisionsOf(songId: string) {
  return (await db().all<StoredRevision>('revisions'))
    .filter((r) => r.song_id === songId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

async function maybeAutoSnapshot(song: Song) {
  const last = (await revisionsOf(song.id))[0]
  if (
    last &&
    (clock().getTime() - new Date(last.created_at).getTime()) / 1000 < AUTO_SNAPSHOT_SECONDS
  )
    return
  await writeRevision(song, 'auto', 'Automatic snapshot')
}

export async function listRevisions(songId: string): Promise<Revision[]> {
  await getStored(songId)
  return (await revisionsOf(songId)).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    kind: r.kind,
    description: r.description,
    line_count: r.snapshot.sections.reduce((n, s) => n + s.lines.filter((l) => l.text).length, 0),
    section_count: r.snapshot.sections.length,
  }))
}

export async function createRevision(songId: string, description: string): Promise<Revision[]> {
  await exclusive(async () =>
    writeRevision(await getStored(songId), 'manual', description.trim() || 'Manual snapshot'),
  )
  return listRevisions(songId)
}

export async function restoreRevision(revId: string): Promise<Song> {
  return exclusive(async () => {
    const rev = await db().get<StoredRevision>('revisions', revId)
    if (!rev) throw notFound('Revision')
    const song = await getStored(rev.song_id)
    const snapTexts = new Map(
      rev.snapshot.sections.flatMap((s) => s.lines.map((l) => [l.id, l.text] as const)),
    )
    const bad = lockViolations(lockedOf(song), snapTexts)
    if (bad.length)
      throw fail(
        423,
        'LOCKED_LINES',
        'Restoring this version would change or remove locked lines. Unlock them first.',
        { lineIds: bad },
      )
    await writeRevision(song, 'pre-restore', 'Before restoring an earlier version')
    const existing = new Map(song.sections.flatMap((s) => s.lines.map((l) => [l.id, l] as const)))
    song.sections = rev.snapshot.sections.map((s) => ({
      id: s.id,
      label: s.label,
      section_type: s.section_type,
      lines: s.lines.map((l) => {
        const cur = existing.get(l.id)
        if (cur) return { ...cur, text: cur.is_locked ? cur.text : l.text } // existing lines keep their lock and notes
        return structuredClone(l)
      }),
    }))
    Object.assign(song, rev.snapshot.song, { genres: [...rev.snapshot.song.genres] })
    song.version += 1
    song.updated_at = now()
    await db().put('songs', song.id, song)
    return clean(song)
  })
}

// ---------------------------------------------------------------- import / export

function parsed(format: ImportFormat, content: string): ParsedSong {
  try {
    return parseAny(content, format)
  } catch (e) {
    if (e instanceof ParseError) throw fail(422, 'IMPORT_FAILED', e.message)
    throw e
  }
}

export async function previewImport(
  format: ImportFormat,
  content: string,
  title?: string,
): Promise<ImportPreview> {
  const p = parsed(format, content)
  return {
    title: title || p.title || 'Imported song',
    warnings: p.warnings,
    line_count: p.sections.reduce((n, s) => n + s.lines.length, 0),
    locked_count: p.sections.reduce((n, s) => n + s.lines.filter((l) => l.is_locked).length, 0),
    sections: p.sections.map((s) => ({
      label: s.label,
      section_type: s.section_type,
      lines: s.lines.map((l) => l.text),
    })),
  }
}

function songFromParsed(p: ParsedSong, title?: string, genres: Genre[] = []): StoredSong {
  const ts = now()
  const bpm =
    p.bpm !== null && Number.isInteger(p.bpm) && p.bpm >= 30 && p.bpm <= 300 ? p.bpm : null
  return {
    id: newId(),
    title: (title || p.title || 'Imported song').trim().slice(0, 200) || 'Imported song',
    concept: p.concept,
    mood: p.mood,
    point_of_view: p.point_of_view,
    bpm,
    time_signature: p.time_signature && TIME_SIG.test(p.time_signature) ? p.time_signature : null,
    version: 1,
    created_at: ts,
    updated_at: ts,
    genres: [...new Set(genres.length ? genres : p.genres)],
    sections: p.sections.map((s) => ({
      id: newId(),
      label: s.label,
      section_type: sectionType(s.section_type),
      lines: s.lines.map((l) => ({
        id: newId(),
        text: l.text,
        is_locked: l.is_locked,
        comments: l.comments.map((body) => ({ id: newId(), body, created_at: ts, updated_at: ts })),
      })),
    })),
    deleted_at: null,
  }
}

/** Always creates a NEW song; an import never overwrites existing lyrics. */
export async function commitImport(
  format: ImportFormat,
  content: string,
  title?: string,
  genres: Genre[] = [],
): Promise<Song> {
  const song = songFromParsed(parsed(format, content), title, genres)
  await exclusive(() => db().put('songs', song.id, song))
  return clean(song)
}

export async function exportSong(
  id: string,
  format: ImportFormat,
): Promise<{ blob: Blob; name: string }> {
  const song = await getSong(id)
  const safe =
    song.title
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'song'
  if (format === 'txt')
    return {
      blob: new Blob([exportTxt(song)], { type: 'text/plain;charset=utf-8' }),
      name: `${safe}.txt`,
    }
  if (format === 'md')
    return {
      blob: new Blob([exportMd(song)], { type: 'text/markdown;charset=utf-8' }),
      name: `${safe}.md`,
    }
  return {
    blob: new Blob([exportJson(song, now())], { type: 'application/json' }),
    name: `${safe}.json`,
  }
}

// ---------------------------------------------------------------- whole-library backup (the phone's safety net)

export async function backupAll(): Promise<{ blob: Blob; name: string; count: number }> {
  const songs = (await db().all<StoredSong>('songs')).filter((s) => !s.deleted_at)
  const at = now()
  const body = {
    format: 'studio-bars-backup',
    schema_version: 1,
    exported_at: at,
    songs: songs.map((s) => songJson(clean(s), at)),
  }
  return {
    blob: new Blob([JSON.stringify(body, null, 2) + '\n'], { type: 'application/json' }),
    name: `studio-bars-backup-${at.slice(0, 10)}.json`,
    count: songs.length,
  }
}

/** Adds every song in a backup as a NEW song. Nothing already on this device is changed. */
export async function restoreBackup(content: string): Promise<number> {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    throw fail(422, 'IMPORT_FAILED', 'That file is not a Studio Bars backup.')
  }
  const d = data as { format?: unknown; schema_version?: unknown; songs?: unknown }
  if (!d || d.format !== 'studio-bars-backup' || d.schema_version !== 1 || !Array.isArray(d.songs))
    throw fail(422, 'IMPORT_FAILED', 'That file is not a Studio Bars backup.')
  let songs: StoredSong[]
  try {
    songs = d.songs.map((s) => songFromParsed(songFromJson(s as Record<string, unknown>)))
  } catch (e) {
    throw fail(
      422,
      'IMPORT_FAILED',
      e instanceof ParseError ? e.message : 'A song in the backup could not be read.',
    )
  }
  await exclusive(async () => {
    for (const s of songs) await db().put('songs', s.id, s)
  })
  return songs.length
}

/** Ask the browser not to clear our storage when space runs low (it may still say no). */
export async function askToKeepData(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
