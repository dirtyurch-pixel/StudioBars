/**
 * Complete backup of everything the phone version keeps, in one file, and an exact restore.
 *
 * File layout ("Studio Bars backup", .sbbackup):
 *   8 bytes  "SBARCH01"
 *   4 bytes  length of the manifest (little-endian)
 *   manifest JSON (UTF-8): every stored record, with each audio file replaced by {"$media": n}
 *   the audio files, one after another, at the offsets the manifest lists (each with a SHA-256)
 *
 * Records keep their ids, so a restore puts things back exactly as they were (history, takes, recordings,
 * playlists and links still point at the right song or track). The AI key is NEVER included, and the cache
 * of online word answers is left out (it refills by itself).
 */
import { ApiFail } from '../apiFail'
import { KINDS, type Kind, type Op, type Store } from './store'

export const MAGIC = 'SBARCH01'
export const ARCHIVE_FORMAT = 'studio-bars-archive'
export const ARCHIVE_VERSION = 2
const MAX_MANIFEST = 200 * 1024 * 1024

/** Kinds that hold the music library; left out when the writer chooses "without music". */
const MUSIC_KINDS: Kind[] = ['tracks', 'playlists']
const MUSIC_SETTINGS = /^(beats:|link:|music_state$)/
const SECRET_SETTINGS = /^ai_key/
const SKIPPED_KINDS: Kind[] = ['online'] // a cache; refills by itself

export type MediaEntry = {
  kind: Kind
  id: string
  field: string
  offset: number
  size: number
  type: string
  sha256: string
}
export type Manifest = {
  format: typeof ARCHIVE_FORMAT
  schema_version: number
  exported_at: string
  includes_music: boolean
  excluded: string[]
  records: Partial<Record<Kind, [string, unknown][]>>
  media: MediaEntry[]
}
export type Summary = {
  songs: number
  revisions: number
  recordings: number
  tracks: number
  playlists: number
  other: number
  media_bytes: number
}
export type ReadArchive = { manifest: Manifest; media: (n: number) => Blob; summary: Summary }

const fail = (message: string) => new ApiFail(message, { status: 422, code: 'BAD_BACKUP' })

export async function sha256(b: Blob): Promise<string> {
  const buf = await readBytes(b)
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Blob bytes, also on browsers (and test environments) without Blob.arrayBuffer. */
export function readBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer()
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as ArrayBuffer)
    r.onerror = () => rej(r.error)
    r.readAsArrayBuffer(b)
  })
}

const isBlob = (x: unknown): x is Blob => typeof Blob !== 'undefined' && x instanceof Blob

function summarise(m: Manifest): Summary {
  const n = (k: Kind) => m.records[k]?.length ?? 0
  const songs = (m.records.songs ?? []).filter(
    ([, v]) => !(v as { deleted_at?: string }).deleted_at,
  ).length
  const main = ['songs', 'revisions', 'vocals', 'tracks', 'playlists'] as Kind[]
  return {
    songs,
    revisions: n('revisions'),
    recordings: n('vocals'),
    tracks: n('tracks'),
    playlists: n('playlists'),
    other: KINDS.filter((k) => !main.includes(k)).reduce((a, k) => a + n(k), 0),
    media_bytes: m.media.reduce((a, x) => a + x.size, 0),
  }
}

/** How big the music library is, so the writer can choose whether to include it. */
export async function musicBytes(store: Store): Promise<number> {
  return (await store.all<{ blob?: Blob }>('tracks')).reduce((a, t) => a + (t.blob?.size ?? 0), 0)
}

/** Build the backup file, then read it back and check every part before handing it over. */
export async function makeArchive(
  store: Store,
  opts: { includeMusic: boolean; now?: string },
): Promise<{ blob: Blob; name: string; summary: Summary }> {
  const exported_at = opts.now ?? new Date().toISOString()
  const records: Manifest['records'] = {}
  const media: MediaEntry[] = []
  const parts: Blob[] = []
  let offset = 0
  const excluded = [
    'your AI key (never backed up)',
    'saved online word answers (they refill by themselves)',
  ]
  if (!opts.includeMusic)
    excluded.push('music files, playlists and song–music links (you chose to leave music out)')

  for (const kind of KINDS) {
    if (SKIPPED_KINDS.includes(kind)) continue
    if (!opts.includeMusic && MUSIC_KINDS.includes(kind)) continue
    const ids = await store.keys(kind)
    const rows: [string, unknown][] = []
    for (const id of ids) {
      if (kind === 'settings' && SECRET_SETTINGS.test(id)) continue
      if (kind === 'settings' && !opts.includeMusic && MUSIC_SETTINGS.test(id)) continue
      const v = await store.get<Record<string, unknown>>(kind, id)
      if (v === undefined) continue
      let out: unknown = v
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o: Record<string, unknown> = {}
        for (const [field, x] of Object.entries(v)) {
          if (isBlob(x)) {
            media.push({
              kind,
              id,
              field,
              offset,
              size: x.size,
              type: x.type,
              sha256: await sha256(x),
            })
            parts.push(x)
            offset += x.size
            o[field] = { $media: media.length - 1 }
          } else o[field] = x
        }
        out = o
      }
      rows.push([id, out])
    }
    records[kind] = rows
  }

  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    schema_version: ARCHIVE_VERSION,
    exported_at,
    includes_music: opts.includeMusic,
    excluded,
    records,
    media,
  }
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const head = new Uint8Array(12)
  head.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(head.buffer).setUint32(8, json.length, true)
  const blob = new Blob([head, json, ...parts], { type: 'application/octet-stream' })

  // Read our own file back exactly as a restore would. Never report success on a file that does not check out.
  const back = await readArchive(blob)
  const want = summarise(manifest)
  if (JSON.stringify(back.summary) !== JSON.stringify(want))
    throw fail('The backup did not check out after it was made. Nothing was saved; try again.')

  return { blob, name: `studio-bars-backup-${exported_at.slice(0, 10)}.sbbackup`, summary: want }
}

/** Open a backup file and check it completely (every audio part's size and fingerprint). Changes nothing. */
export async function readArchive(file: Blob): Promise<ReadArchive> {
  if (file.size < 12) throw fail('That file is not a Studio Bars backup.')
  const head = new Uint8Array(await readBytes(file.slice(0, 12)))
  if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC)
    throw fail('That file is not a Studio Bars backup.')
  const len = new DataView(head.buffer).getUint32(8, true)
  if (len < 2 || len > MAX_MANIFEST || 12 + len > file.size)
    throw fail('That backup file is damaged or incomplete.')
  let manifest: Manifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(await readBytes(file.slice(12, 12 + len))))
  } catch {
    throw fail('That backup file is damaged or incomplete.')
  }
  if (
    manifest?.format !== ARCHIVE_FORMAT ||
    typeof manifest.records !== 'object' ||
    !Array.isArray(manifest.media)
  )
    throw fail('That file is not a Studio Bars backup.')
  if (manifest.schema_version > ARCHIVE_VERSION)
    throw fail('That backup was made by a newer version of Studio Bars. Update the app first.')
  for (const k of Object.keys(manifest.records))
    if (!(KINDS as string[]).includes(k))
      throw fail('That backup has parts this version does not know.')

  const base = 12 + len
  const media = (n: number) => {
    const m = manifest.media[n]
    return file.slice(base + m.offset, base + m.offset + m.size, m.type)
  }
  for (let n = 0; n < manifest.media.length; n++) {
    const m = manifest.media[n]
    if (base + m.offset + m.size > file.size)
      throw fail('That backup file is incomplete (an audio file is cut off).')
    if ((await sha256(media(n))) !== m.sha256)
      throw fail('That backup file is damaged (an audio file does not match its fingerprint).')
  }
  return { manifest, media, summary: summarise(manifest) }
}

export type RestoreMode = 'merge' | 'replace'
export type RestoreResult = {
  added: number
  kept_existing: number
  songs_on_both: number
  summary: Summary
}

/**
 * Put a checked backup on this device, all in one go (it either all goes in or nothing changes).
 *  merge:   adds everything this device does not have yet; anything already here (same id) is left as it is.
 *  replace: this device ends up exactly like the backup (your AI key on this device is kept).
 * Afterwards everything is read back and compared.
 */
export async function restoreArchive(
  store: Store,
  a: ReadArchive,
  mode: RestoreMode,
): Promise<RestoreResult> {
  const { manifest } = a
  const ops: Op[] = []
  let added = 0
  let kept = 0
  let songsOnBoth = 0
  const expected: { kind: Kind; id: string }[] = []

  const value = (v: unknown): unknown => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v
    const o: Record<string, unknown> = {}
    for (const [f, x] of Object.entries(v as Record<string, unknown>)) {
      const ref = x as { $media?: number } | null
      o[f] =
        ref && typeof ref === 'object' && typeof ref.$media === 'number' ? a.media(ref.$media) : x
    }
    return o
  }

  if (mode === 'replace') {
    for (const kind of KINDS) {
      if (SKIPPED_KINDS.includes(kind)) continue
      if (!manifest.includes_music && MUSIC_KINDS.includes(kind)) continue // music not in the file: leave it
      if (kind === 'settings') {
        // clear settings one by one so the AI key (never in a backup) and music settings without music stay
        for (const id of await store.keys('settings')) {
          if (SECRET_SETTINGS.test(id)) continue
          if (!manifest.includes_music && MUSIC_SETTINGS.test(id)) continue
          ops.push({ kind, id, del: true })
        }
      } else ops.push({ kind, clear: true })
    }
    for (const [k, rows] of Object.entries(manifest.records) as [Kind, [string, unknown][]][])
      for (const [id, v] of rows) {
        if (k === 'settings' && SECRET_SETTINGS.test(id)) continue
        ops.push({ kind: k, id, value: value(v) })
        expected.push({ kind: k, id })
        added++
      }
  } else {
    for (const [k, rows] of Object.entries(manifest.records) as [Kind, [string, unknown][]][]) {
      const have = new Set(await store.keys(k))
      for (const [id, v] of rows) {
        if (k === 'settings' && SECRET_SETTINGS.test(id)) continue
        if (have.has(id)) {
          kept++
          if (k === 'songs') songsOnBoth++
          continue
        }
        ops.push({ kind: k, id, value: value(v) })
        expected.push({ kind: k, id })
        added++
      }
    }
  }

  await store.batch(ops)

  // read back: every record we wrote must be there
  const byKind = new Map<Kind, Set<string>>()
  for (const e of expected) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, new Set(await store.keys(e.kind)))
    if (!byKind.get(e.kind)!.has(e.id))
      throw fail('The restore did not check out: something is missing after restoring. Try again.')
  }
  return { added, kept_existing: kept, songs_on_both: songsOnBoth, summary: a.summary }
}
