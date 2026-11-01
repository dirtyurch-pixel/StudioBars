import type {
  AiPrepared,
  AiRequest,
  AiResult,
  AiSettingsIn,
  AiStatus,
  Analysis,
  Content,
  CustomPron,
  Meanings,
  OnlineKind,
  OnlineResult,
  OnlineStatus,
  PhraseItem,
  PhraseRhymes,
  PhoneticsStatus,
  RhymeResponse,
  WordInfo,
  Genre,
  ImportPreview,
  PlaybackSaved,
  PlaylistDetail,
  PlaylistSummary,
  Revision,
  Song,
  SongAudioLink,
  SongSummary,
  Track,
} from './types'
import { toPayload } from './editor/content'

export type Health = { status: string; service: string; version: string }

const BASE =
  import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:8000`

/** A failed API call. `network` is true when the server could not be reached at all. */
export class ApiFail extends Error {
  status: number
  code: string
  network: boolean
  lineIds: string[]
  currentVersion?: number
  constructor(
    message: string,
    opts: {
      status?: number
      code?: string
      network?: boolean
      lineIds?: string[]
      currentVersion?: number
    } = {},
  ) {
    super(message)
    this.status = opts.status ?? 0
    this.code = opts.code ?? 'ERROR'
    this.network = opts.network ?? false
    this.lineIds = opts.lineIds ?? []
    this.currentVersion = opts.currentVersion
  }
}

async function request(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal,
      headers: init.headers ?? (init.body ? { 'Content-Type': 'application/json' } : undefined),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiFail('Cannot reach the Studio Bars server.', { network: true })
  }
  if (res.ok) return res
  let detail: Record<string, unknown> = {}
  try {
    const body = await res.json()
    detail = typeof body.detail === 'object' && body.detail ? body.detail : { message: body.detail }
  } catch {
    /* non-JSON error body */
  }
  const message =
    typeof detail.message === 'string'
      ? detail.message
      : res.status === 422
        ? 'Some of that input is not allowed.'
        : `The server replied ${res.status}.`
  throw new ApiFail(message, {
    status: res.status,
    code: typeof detail.code === 'string' ? detail.code : 'ERROR',
    lineIds: Array.isArray(detail.line_ids) ? (detail.line_ids as string[]) : [],
    currentVersion: typeof detail.current_version === 'number' ? detail.current_version : undefined,
  })
}

const json = async <T>(p: string, init?: RequestInit, signal?: AbortSignal) =>
  (await request(p, init, signal)).json() as Promise<T>
const body = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
})

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return json<Health>('/health', undefined, signal)
}

export const listSongs = (trash = false, signal?: AbortSignal) =>
  json<SongSummary[]>(`/api/songs${trash ? '?trash=true' : ''}`, undefined, signal)
export const getSong = (id: string, signal?: AbortSignal) =>
  json<Song>(`/api/songs/${id}`, undefined, signal)
export const createSong = (data: {
  title: string
  genres: Genre[]
  bpm?: number | null
  time_signature?: string | null
  template: 'blank' | 'verse-chorus'
}) => json<Song>('/api/songs', body('POST', data))
export const patchSong = (
  id: string,
  data: Partial<Pick<Song, 'title' | 'genres' | 'bpm' | 'time_signature'>>,
) => json<Song>(`/api/songs/${id}`, body('PATCH', data))
export const deleteSong = async (id: string) => {
  await request(`/api/songs/${id}`, body('DELETE'))
}
export const undeleteSong = (id: string) => json<Song>(`/api/songs/${id}/undelete`, body('POST'))
export const saveContent = (id: string, baseVersion: number, content: Content) =>
  json<Song>(
    `/api/songs/${id}/content`,
    body('PUT', { base_version: baseVersion, sections: toPayload(content) }),
  )
export const lockLine = (lineId: string, locked: boolean) =>
  json<Song>(`/api/lines/${lineId}/${locked ? 'lock' : 'unlock'}`, body('POST'))
export const addComment = (lineId: string, text: string) =>
  json<Song>(`/api/lines/${lineId}/comments`, body('POST', { body: text }))
export const editComment = (id: string, text: string) =>
  json<Song>(`/api/comments/${id}`, body('PATCH', { body: text }))
export const deleteComment = (id: string) => json<Song>(`/api/comments/${id}`, body('DELETE'))
export const listRevisions = (id: string) => json<Revision[]>(`/api/songs/${id}/revisions`)
export const createRevision = (id: string, description: string) =>
  json<Revision[]>(`/api/songs/${id}/revisions`, body('POST', { description }))
export const restoreRevision = (revId: string) =>
  json<Song>(`/api/revisions/${revId}/restore`, body('POST'))

export type ImportFormat = 'json' | 'txt' | 'md'
export const previewImport = (format: ImportFormat, content: string, title?: string) =>
  json<ImportPreview>(
    '/api/import/preview',
    body('POST', { format, content, title: title || null }),
  )
export const commitImport = (
  format: ImportFormat,
  content: string,
  title?: string,
  genres: Genre[] = [],
) => json<Song>('/api/import', body('POST', { format, content, title: title || null, genres }))

export async function exportSong(id: string, format: ImportFormat) {
  const res = await request(`/api/songs/${id}/export?format=${format}`)
  const disp = res.headers.get('Content-Disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? `song.${format}`
  return { blob: await res.blob(), name }
}

// ---------------------------------------------------------------- music
export const listTracks = () => json<Track[]>('/api/music/tracks')
export const trackAudioUrl = (t: Pick<Track, 'id' | 'file_version'>) =>
  `${BASE}/api/music/tracks/${t.id}/audio?v=${t.file_version}`

/** Copies one audio file into the library (the file goes to the local backend only). */
export const uploadTrack = (file: File, duration: number | null) =>
  json<Track>('/api/music/tracks', {
    method: 'POST',
    body: file,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      ...(duration ? { 'X-Duration': String(duration) } : {}),
    },
  })
export const relinkTrack = (id: string, file: File, duration: number | null) =>
  json<Track>(`/api/music/tracks/${id}/relink`, {
    method: 'POST',
    body: file,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      ...(duration ? { 'X-Duration': String(duration) } : {}),
    },
  })
export const patchTrack = (id: string, data: Partial<Pick<Track, 'title' | 'artist' | 'album'>>) =>
  json<Track>(`/api/music/tracks/${id}`, body('PATCH', data))
export const deleteTrack = async (id: string) => {
  await request(`/api/music/tracks/${id}`, body('DELETE'))
}
export const listPlaylists = () => json<PlaylistSummary[]>('/api/music/playlists')
export const getPlaylist = (id: string) => json<PlaylistDetail>(`/api/music/playlists/${id}`)
export const createPlaylist = (name: string) =>
  json<PlaylistDetail>('/api/music/playlists', body('POST', { name }))
export const renamePlaylist = (id: string, name: string) =>
  json<PlaylistDetail>(`/api/music/playlists/${id}`, body('PATCH', { name }))
export const deletePlaylist = async (id: string) => {
  await request(`/api/music/playlists/${id}`, body('DELETE'))
}
export const addToPlaylist = (id: string, trackId: string) =>
  json<PlaylistDetail>(`/api/music/playlists/${id}/tracks`, body('POST', { track_id: trackId }))
export const removeFromPlaylist = (id: string, entryId: string) =>
  json<PlaylistDetail>(`/api/music/playlists/${id}/tracks/${entryId}`, body('DELETE'))
export const reorderPlaylist = (id: string, entryIds: string[]) =>
  json<PlaylistDetail>(`/api/music/playlists/${id}/order`, body('PUT', { entry_ids: entryIds }))
export const getPlaybackState = () => json<PlaybackSaved>('/api/music/state')
export const savePlaybackState = (s: PlaybackSaved) =>
  json<PlaybackSaved>('/api/music/state', body('PUT', s))
export const getSongLink = (songId: string) =>
  json<SongAudioLink | null>(`/api/songs/${songId}/audio-link`)
export const saveSongLink = (songId: string, link: Partial<SongAudioLink>) =>
  json<SongAudioLink | null>(`/api/songs/${songId}/audio-link`, body('PUT', link))

// ---------------------------------------------------------------- phonetics (all local, no internet)
export const getPhoneticsStatus = () => json<PhoneticsStatus>('/api/phonetics/status')
export const analyzeLines = (lines: string[], signal?: AbortSignal) =>
  json<Analysis>('/api/phonetics/analyze', body('POST', { lines }), signal)
export const lookupWord = (word: string, signal?: AbortSignal) =>
  json<WordInfo>(`/api/phonetics/word?word=${encodeURIComponent(word)}`, undefined, signal)
export type RhymeQuery = {
  word: string
  qualities: string[]
  includeIdentical: boolean
  minSyllables?: number
  maxSyllables?: number
  pos?: string
  endings: string[]
  familiarity: 'any' | 'familiar' | 'common'
  limit: number
}
export const searchRhymes = (q: RhymeQuery, signal?: AbortSignal) => {
  const p = new URLSearchParams({
    word: q.word,
    qualities: q.qualities.join(','),
    include_identical: String(q.includeIdentical),
    endings: q.endings.join(','),
    familiarity: q.familiarity,
    limit: String(q.limit),
  })
  if (q.minSyllables) p.set('min_syllables', String(q.minSyllables))
  if (q.maxSyllables) p.set('max_syllables', String(q.maxSyllables))
  if (q.pos) p.set('pos', q.pos)
  return json<RhymeResponse>(`/api/phonetics/rhymes?${p}`, undefined, signal)
}
export const listCustomPron = () => json<CustomPron[]>('/api/phonetics/custom')
export const saveCustomPron = (
  word: string,
  data: { sounds_like?: string; phones?: string; note?: string },
) => json<CustomPron>(`/api/phonetics/custom/${encodeURIComponent(word)}`, body('PUT', data))
export const deleteCustomPron = async (word: string) => {
  await request(`/api/phonetics/custom/${encodeURIComponent(word)}`, body('DELETE'))
}

// ---------------------------------------------------------------- meanings (WordNet, local)
export const getMeanings = (word: string, context: string, around = '', signal?: AbortSignal) => {
  const p = new URLSearchParams({ word })
  if (context.trim()) p.set('context', context.slice(0, 600))
  if (around.trim()) p.set('around', around.slice(0, 600))
  return json<Meanings>(`/api/lexicon/word?${p}`, undefined, signal)
}

// ---------------------------------------------------------------- optional online helper
export const getOnlineStatus = () => json<OnlineStatus>('/api/lexicon/online/status')
export const setOnlineEnabled = (enabled: boolean) =>
  json<OnlineStatus>('/api/lexicon/online/settings', body('PUT', { enabled }))
export const getOnlineWords = (word: string, kind: OnlineKind, signal?: AbortSignal) =>
  json<OnlineResult>(
    `/api/lexicon/online/words?word=${encodeURIComponent(word)}&kind=${kind}`,
    undefined,
    signal,
  )

// ---------------------------------------------------------------- phrase bank
export const listPhrases = (q = '', tag = '', signal?: AbortSignal) => {
  const p = new URLSearchParams({ limit: '200' })
  if (q.trim()) p.set('q', q.trim())
  if (tag) p.set('tag', tag)
  return json<{ total: number; items: PhraseItem[] }>(`/api/phrases?${p}`, undefined, signal)
}
export const listPhraseTags = () => json<{ tag: string; count: number }[]>('/api/phrases/tags')
export type PhraseInput = { phrase: string; meaning: string; sounds_like: string; tags: string[] }
export const createPhrase = (data: PhraseInput) =>
  json<PhraseItem>('/api/phrases', body('POST', data))
export const updatePhrase = (id: string, data: Partial<PhraseInput>) =>
  json<PhraseItem>(`/api/phrases/${id}`, body('PATCH', data))
export const deletePhrase = async (id: string) => {
  await request(`/api/phrases/${id}`, body('DELETE'))
}
export const exportPhrases = async () => {
  const res = await request('/api/phrases/export')
  return res.blob()
}
export const phraseRhymes = (
  phrase: string,
  syllables: number,
  qualities: string[],
  signal?: AbortSignal,
) =>
  json<PhraseRhymes>(
    `/api/phonetics/phrase-rhymes?${new URLSearchParams({ phrase, syllables: String(syllables), qualities: qualities.join(','), limit: '80' })}`,
    undefined,
    signal,
  )

// ---------------------------------------------------------------- AI co-writer (Phase 4)
// The key is sent to the local server once and is never returned.
export const getAiStatus = (signal?: AbortSignal) =>
  json<AiStatus>('/api/ai/status', undefined, signal)
export const putAiSettings = (data: AiSettingsIn) =>
  json<AiStatus>('/api/ai/settings', body('PUT', data))
export const putAiKey = (provider: string, key: string) =>
  json<AiStatus>('/api/ai/key', body('PUT', { provider, key }))
export const deleteAiKey = (provider: string) =>
  json<AiStatus>(`/api/ai/key?provider=${encodeURIComponent(provider)}`, body('DELETE'))
export const aiPrepare = (req: AiRequest, signal?: AbortSignal) =>
  json<AiPrepared>('/api/ai/prepare', body('POST', req), signal)
export const aiSuggest = (req: AiRequest, ackHash: string, signal?: AbortSignal) =>
  json<AiResult>('/api/ai/suggest', body('POST', { ...req, ack_hash: ackHash }), signal)
export const aiAccept = (id: string) =>
  json<{ ok: boolean }>(`/api/ai/suggestions/${id}/accept`, body('POST'))
export const aiTest = () =>
  json<{ ok: boolean; month: AiStatus['usage'] }>('/api/ai/test', body('POST'))
