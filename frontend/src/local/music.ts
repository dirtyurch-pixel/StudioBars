/**
 * The phone version's music library: your audio files are copied into this browser's database ON THIS DEVICE,
 * with playlists, the last playback position and the music linked to each song. Same rules as backend/app/music.py.
 * Nothing is uploaded anywhere.
 */
import { ApiFail } from '../apiFail'
import { newId } from '../editor/content'
import type { PlaybackSaved, PlaylistDetail, PlaylistSummary, SongAudioLink, Track } from '../types'
import { db, getSong, nowIso } from './localApi'
import { exclusive } from './store'

const fail = (status: number, code: string, message: string) =>
  new ApiFail(message, { status, code })
export const ALLOWED: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
}
const MAX_TRACKS = 2000
const MAX_BYTES = 300 * 1024 * 1024

type StoredTrack = Omit<Track, 'available' | 'duplicate_of'> & {
  blob: Blob
  content_hash: string
  seq: number
}
type StoredPlaylist = {
  id: string
  name: string
  created_at: string
  updated_at: string
  seq: number
  entries: { entry_id: string; track_id: string }[]
}

/** Does the start of the file look like the format its name claims? (same checks as the PC version) */
export function sniffOk(ext: string, h: Uint8Array): boolean {
  const s = (a: number, b: number) => String.fromCharCode(...h.slice(a, b))
  if (ext === 'mp3')
    return s(0, 3) === 'ID3' || (h.length > 1 && h[0] === 0xff && (h[1] & 0xe0) === 0xe0)
  if (ext === 'wav') return s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE'
  if (ext === 'flac') return s(0, 4) === 'fLaC'
  if (ext === 'ogg' || ext === 'opus') return s(0, 4) === 'OggS'
  if (ext === 'm4a') return s(4, 8) === 'ftyp'
  if (ext === 'aac') return h.length > 1 && h[0] === 0xff && (h[1] & 0xf0) === 0xf0
  return false
}

export function splitFilename(raw: string): [string, string] {
  const name = raw.replace(/\\/g, '/').split('/').pop()!.trim().replace(/\0/g, '')
  const dot = name.lastIndexOf('.')
  let stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  if (!stem) stem = name
  return [
    stem.split(/\s+/).filter(Boolean).join(' ').slice(0, 200) || 'Untitled track',
    ext.toLowerCase(),
  ]
}

const urls = new Map<string, string>()
/** The address the player uses for a track on this device. */
export function trackUrl(id: string): string {
  return urls.get(id) ?? ''
}
function trackJson(t: StoredTrack): Track {
  if (!urls.has(t.id)) urls.set(t.id, URL.createObjectURL(t.blob))
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    media_type: t.media_type,
    ext: t.ext,
    size_bytes: t.size_bytes,
    added_at: t.added_at,
    available: true,
    file_version: t.file_version,
  }
}
async function getTrack(id: string): Promise<StoredTrack> {
  const t = await db().get<StoredTrack>('tracks', id)
  if (!t) throw fail(404, 'NOT_FOUND', 'Track not found.')
  return t
}
const cleanDuration = (d: number | null) => (d !== null && d > 0 && d < 86400 ? d : null)

async function readChecked(file: File): Promise<{ title: string; ext: string; hash: string }> {
  const [title, ext] = splitFilename(file.name)
  if (!(ext in ALLOWED))
    throw fail(
      415,
      'UNSUPPORTED_FORMAT',
      `“${file.name}” is not a supported audio type. Use ${Object.keys(ALLOWED).sort().join(', ')}.`,
    )
  if (file.size > MAX_BYTES)
    throw fail(413, 'TOO_LARGE', `That file is larger than ${MAX_BYTES / 1048576} MB.`)
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  if (!file.size || !sniffOk(ext, head))
    throw fail(
      422,
      'BAD_AUDIO',
      `“${file.name}” does not look like a real ${ext} file, so it was not added.`,
    )
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return {
    title,
    ext,
    hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
  }
}

export async function listTracks(): Promise<Track[]> {
  return (await db().all<StoredTrack>('tracks'))
    .sort((a, b) => (a.added_at < b.added_at ? -1 : a.added_at > b.added_at ? 1 : a.seq - b.seq))
    .map(trackJson)
}

export async function uploadTrack(file: File, duration: number | null): Promise<Track> {
  const { title, ext, hash } = await readChecked(file)
  return exclusive(async () => {
    const all = await db().all<StoredTrack>('tracks')
    if (all.length >= MAX_TRACKS)
      throw fail(422, 'LIBRARY_FULL', `The library is limited to ${MAX_TRACKS} tracks.`)
    const dup = all.find((t) => t.content_hash === hash)
    const t: StoredTrack = {
      id: newId(),
      title,
      artist: '',
      album: '',
      duration: cleanDuration(duration),
      media_type: ALLOWED[ext],
      ext,
      size_bytes: file.size,
      added_at: nowIso(),
      file_version: hash.slice(0, 12),
      blob: new Blob([file], { type: ALLOWED[ext] }),
      content_hash: hash,
      seq: all.length,
    }
    await db().put('tracks', t.id, t)
    return { ...trackJson(t), duplicate_of: dup ? dup.id : null }
  })
}

export async function relinkTrack(id: string, file: File, duration: number | null): Promise<Track> {
  await getTrack(id)
  const { ext, hash } = await readChecked(file)
  return exclusive(async () => {
    const t = await getTrack(id)
    Object.assign(t, {
      media_type: ALLOWED[ext],
      ext,
      size_bytes: file.size,
      content_hash: hash,
      file_version: hash.slice(0, 12),
      blob: new Blob([file], { type: ALLOWED[ext] }),
    })
    t.duration = cleanDuration(duration) ?? t.duration
    const old = urls.get(id)
    if (old) URL.revokeObjectURL(old)
    urls.delete(id)
    await db().put('tracks', id, t)
    return trackJson(t)
  })
}

export async function patchTrack(
  id: string,
  data: Partial<Pick<Track, 'title' | 'artist' | 'album'>>,
): Promise<Track> {
  return exclusive(async () => {
    const t = await getTrack(id)
    for (const k of ['title', 'artist', 'album'] as const) {
      const v = data[k]
      if (v === undefined || v === null) continue
      const clean = String(v).trim()
      if (clean.length > 200 || (k === 'title' && !clean))
        throw fail(422, 'INVALID', 'Some of that input is not allowed.')
      t[k] = clean
    }
    await db().put('tracks', id, t)
    return trackJson(t)
  })
}

export async function deleteTrack(id: string): Promise<void> {
  await exclusive(async () => {
    await getTrack(id)
    await db().del('tracks', id)
    for (const p of await db().all<StoredPlaylist>('playlists')) {
      const kept = p.entries.filter((e) => e.track_id !== id)
      if (kept.length !== p.entries.length)
        await db().put('playlists', p.id, { ...p, entries: kept })
    }
    const u = urls.get(id)
    if (u) URL.revokeObjectURL(u)
    urls.delete(id)
  })
}

// ---------------------------------------------------------------- playlists

async function getPl(id: string): Promise<StoredPlaylist> {
  const p = await db().get<StoredPlaylist>('playlists', id)
  if (!p) throw fail(404, 'NOT_FOUND', 'Playlist not found.')
  return p
}
const cleanName = (n: string) => {
  const v = String(n ?? '').trim()
  if (!v || v.length > 200) throw fail(422, 'INVALID', 'A name must be 1 to 200 characters.')
  return v
}

export async function listPlaylists(): Promise<PlaylistSummary[]> {
  const tracks = new Map((await db().all<StoredTrack>('tracks')).map((t) => [t.id, t]))
  return (await db().all<StoredPlaylist>('playlists'))
    .sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.seq - b.seq,
    )
    .map((p) => {
      const ts = p.entries.map((e) => tracks.get(e.track_id)).filter(Boolean) as StoredTrack[]
      return {
        id: p.id,
        name: p.name,
        track_count: ts.length,
        total_duration: ts.reduce((n, t) => n + (t.duration ?? 0), 0),
        updated_at: p.updated_at,
      } as PlaylistSummary
    })
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  const p = await getPl(id)
  const tracks = new Map((await db().all<StoredTrack>('tracks')).map((t) => [t.id, t]))
  return {
    id: p.id,
    name: p.name,
    entries: p.entries
      .filter((e) => tracks.has(e.track_id))
      .map((e) => ({ entry_id: e.entry_id, track: trackJson(tracks.get(e.track_id)!) })),
  }
}

export async function createPlaylist(name: string): Promise<PlaylistDetail> {
  const n = cleanName(name)
  const id = newId()
  await exclusive(async () => {
    const seq = (await db().all('playlists')).length
    const ts = nowIso()
    await db().put('playlists', id, {
      id,
      name: n,
      created_at: ts,
      updated_at: ts,
      seq,
      entries: [],
    } satisfies StoredPlaylist)
  })
  return getPlaylist(id)
}

async function change(id: string, fn: (p: StoredPlaylist) => void | Promise<void>) {
  await exclusive(async () => {
    const p = await getPl(id)
    await fn(p)
    p.updated_at = nowIso()
    await db().put('playlists', id, p)
  })
  return getPlaylist(id)
}

export const renamePlaylist = (id: string, name: string) => {
  const n = cleanName(name)
  return change(id, (p) => void (p.name = n))
}
export async function deletePlaylist(id: string): Promise<void> {
  await exclusive(async () => {
    await getPl(id)
    await db().del('playlists', id) // the audio stays in the library
  })
}
export const addToPlaylist = (id: string, trackId: string) =>
  change(id, async (p) => {
    await getTrack(trackId)
    p.entries.push({ entry_id: newId(), track_id: trackId }) // repeats are allowed on purpose
  })
export const removeFromPlaylist = (id: string, entryId: string) =>
  change(id, (p) => {
    const i = p.entries.findIndex((e) => e.entry_id === entryId)
    if (i < 0) throw fail(404, 'NOT_FOUND', 'That entry is not in this playlist.')
    p.entries.splice(i, 1)
  })
export const reorderPlaylist = (id: string, entryIds: string[]) =>
  change(id, (p) => {
    const have = p.entries.map((e) => e.entry_id).sort()
    if (JSON.stringify(have) !== JSON.stringify([...entryIds].sort()))
      throw fail(
        422,
        'BAD_ORDER',
        'The new order must list every entry of the playlist exactly once.',
      )
    const by = new Map(p.entries.map((e) => [e.entry_id, e]))
    p.entries = entryIds.map((x) => by.get(x)!)
  })

// ---------------------------------------------------------------- playback memory and song links

const DEFAULT_STATE: PlaybackSaved = {
  track_id: null,
  playlist_id: null,
  position_seconds: 0,
  repeat_mode: 'off',
  shuffle_enabled: false,
  volume: 1,
  speed: 1,
}
async function exists(kind: 'tracks' | 'playlists', id: string | null) {
  return id === null || Boolean(await db().get(kind, id))
}

export async function getPlaybackState(): Promise<PlaybackSaved> {
  return (
    (await db().get<{ value: PlaybackSaved }>('settings', 'music_state'))?.value ?? DEFAULT_STATE
  )
}

export async function savePlaybackState(s: PlaybackSaved): Promise<PlaybackSaved> {
  const st: PlaybackSaved = { ...DEFAULT_STATE, ...s }
  if (
    st.position_seconds < 0 ||
    st.position_seconds > 86400 ||
    st.volume < 0 ||
    st.volume > 1 ||
    st.speed < 0.5 ||
    st.speed > 2 ||
    !['off', 'all', 'one'].includes(st.repeat_mode)
  )
    throw fail(422, 'INVALID', 'Some of that input is not allowed.')
  if (!(await exists('tracks', st.track_id)) || !(await exists('playlists', st.playlist_id)))
    throw fail(422, 'NOT_FOUND', 'That track or playlist no longer exists.')
  await db().put('settings', 'music_state', { value: st })
  return st
}

export async function getSongLink(songId: string): Promise<SongAudioLink | null> {
  await getSong(songId)
  return (await db().get<{ value: SongAudioLink }>('settings', 'link:' + songId))?.value ?? null
}

export async function saveSongLink(
  songId: string,
  link: Partial<SongAudioLink>,
): Promise<SongAudioLink | null> {
  const d: SongAudioLink = {
    track_id: null,
    playlist_id: null,
    loop_a: null,
    loop_b: null,
    position_seconds: 0,
    speed: 1,
    ...link,
  }
  if (d.track_id && d.playlist_id)
    throw fail(422, 'INVALID', 'Link a track or a playlist, not both.')
  if (d.loop_a !== null && d.loop_b !== null && d.loop_a >= d.loop_b)
    throw fail(422, 'BAD_LOOP', 'Loop start (A) must be before loop end (B).')
  if (d.speed < 0.5 || d.speed > 2 || d.position_seconds < 0 || d.position_seconds > 86400)
    throw fail(422, 'INVALID', 'Some of that input is not allowed.')
  await getSong(songId)
  if (!(await exists('tracks', d.track_id)) || !(await exists('playlists', d.playlist_id)))
    throw fail(422, 'NOT_FOUND', 'That track or playlist no longer exists.')
  if (d.track_id === null && d.playlist_id === null) {
    await db().del('settings', 'link:' + songId)
    return null
  }
  await db().put('settings', 'link:' + songId, { value: d })
  return d
}
