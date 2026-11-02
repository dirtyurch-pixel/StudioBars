import type {
  MelodySketch,
  VocalTake,
  Dna,
  Chains,
  CraftItem,
  FlowGrid,
  Plan,
  ScanResult,
  SyllableInfo,
  Take,
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

import { ApiFail } from './apiFail'
import * as local from './local/localApi'
import * as localWords from './local/localWords'
import * as localOnline from './local/localOnline'
export { ApiFail }

/** Phone version: everything is kept on this device and there is no server. */
export const LOCAL = import.meta.env.VITE_LOCAL === '1'

/** Phone version: turn any unexpected problem into a plain message that says what happened. */
function loc<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiFail) throw e
    const why = e instanceof Error ? e.message : String(e)
    throw new ApiFail(`Something went wrong on this device: ${why}`, { code: 'DEVICE_ERROR' })
  })
}

async function request(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  if (LOCAL)
    throw new ApiFail('This part is not in the phone version yet.', {
      status: 501,
      code: 'NOT_IN_PHONE',
    })
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
  if (res.status === 401 && detail.code === 'PIN_REQUIRED')
    window.dispatchEvent(new Event('sb-locked'))
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
  if (LOCAL) return loc(local.health())
  return json<Health>('/health', undefined, signal)
}

export const listSongs = (trash = false, signal?: AbortSignal) =>
  LOCAL
    ? loc(local.listSongs(trash))
    : json<SongSummary[]>(`/api/songs${trash ? '?trash=true' : ''}`, undefined, signal)
export const getSong = (id: string, signal?: AbortSignal) =>
  LOCAL ? loc(local.getSong(id)) : json<Song>(`/api/songs/${id}`, undefined, signal)
export const createSong = (data: {
  title: string
  genres: Genre[]
  bpm?: number | null
  time_signature?: string | null
  template: 'blank' | 'verse-chorus'
}) => (LOCAL ? loc(local.createSong(data)) : json<Song>('/api/songs', body('POST', data)))
export const patchSong = (
  id: string,
  data: Partial<Pick<Song, 'title' | 'genres' | 'bpm' | 'time_signature'>>,
) => (LOCAL ? loc(local.patchSong(id, data)) : json<Song>(`/api/songs/${id}`, body('PATCH', data)))
export const deleteSong = async (id: string) => {
  if (LOCAL) return loc(local.deleteSong(id))
  await request(`/api/songs/${id}`, body('DELETE'))
}
export const undeleteSong = (id: string) =>
  LOCAL ? loc(local.undeleteSong(id)) : json<Song>(`/api/songs/${id}/undelete`, body('POST'))
export const saveContent = (id: string, baseVersion: number, content: Content) =>
  LOCAL
    ? loc(local.saveContent(id, baseVersion, content))
    : json<Song>(
        `/api/songs/${id}/content`,
        body('PUT', { base_version: baseVersion, sections: toPayload(content) }),
      )
export const lockLine = (lineId: string, locked: boolean) =>
  LOCAL
    ? loc(local.lockLine(lineId, locked))
    : json<Song>(`/api/lines/${lineId}/${locked ? 'lock' : 'unlock'}`, body('POST'))
export const addComment = (lineId: string, text: string) =>
  LOCAL
    ? loc(local.addComment(lineId, text))
    : json<Song>(`/api/lines/${lineId}/comments`, body('POST', { body: text }))
export const editComment = (id: string, text: string) =>
  LOCAL
    ? loc(local.editComment(id, text))
    : json<Song>(`/api/comments/${id}`, body('PATCH', { body: text }))
export const deleteComment = (id: string) =>
  LOCAL ? loc(local.deleteComment(id)) : json<Song>(`/api/comments/${id}`, body('DELETE'))
export const listRevisions = (id: string) =>
  LOCAL ? loc(local.listRevisions(id)) : json<Revision[]>(`/api/songs/${id}/revisions`)
export const createRevision = (id: string, description: string) =>
  LOCAL
    ? loc(local.createRevision(id, description))
    : json<Revision[]>(`/api/songs/${id}/revisions`, body('POST', { description }))
export const restoreRevision = (revId: string) =>
  LOCAL
    ? loc(local.restoreRevision(revId))
    : json<Song>(`/api/revisions/${revId}/restore`, body('POST'))

export type ImportFormat = 'json' | 'txt' | 'md'
export const previewImport = (format: ImportFormat, content: string, title?: string) =>
  LOCAL
    ? loc(local.previewImport(format, content, title))
    : json<ImportPreview>(
        '/api/import/preview',
        body('POST', { format, content, title: title || null }),
      )
export const commitImport = (
  format: ImportFormat,
  content: string,
  title?: string,
  genres: Genre[] = [],
) =>
  LOCAL
    ? loc(local.commitImport(format, content, title, genres))
    : json<Song>('/api/import', body('POST', { format, content, title: title || null, genres }))

export async function exportSong(id: string, format: ImportFormat) {
  if (LOCAL) return loc(local.exportSong(id, format))
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
export const getPhoneticsStatus = () =>
  LOCAL ? loc(localWords.phoneticsStatus()) : json<PhoneticsStatus>('/api/phonetics/status')
export const analyzeLines = (lines: string[], signal?: AbortSignal) =>
  LOCAL
    ? loc(localWords.analyzeLines(lines))
    : json<Analysis>('/api/phonetics/analyze', body('POST', { lines }), signal)
export const lookupWord = (word: string, signal?: AbortSignal) =>
  LOCAL
    ? loc(localWords.lookupWord(word))
    : json<WordInfo>(`/api/phonetics/word?word=${encodeURIComponent(word)}`, undefined, signal)
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
  if (LOCAL) return loc(localWords.searchRhymes(q))
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
export const listCustomPron = () =>
  LOCAL ? loc(localWords.listCustomPron()) : json<CustomPron[]>('/api/phonetics/custom')
export const saveCustomPron = (
  word: string,
  data: { sounds_like?: string; phones?: string; note?: string },
) =>
  LOCAL
    ? loc(localWords.saveCustomPron(word, data))
    : json<CustomPron>(`/api/phonetics/custom/${encodeURIComponent(word)}`, body('PUT', data))
export const deleteCustomPron = async (word: string) => {
  if (LOCAL) return loc(localWords.deleteCustomPron(word))
  await request(`/api/phonetics/custom/${encodeURIComponent(word)}`, body('DELETE'))
}

// ---------------------------------------------------------------- meanings (WordNet, local)
export const getMeanings = (word: string, context: string, around = '', signal?: AbortSignal) => {
  if (LOCAL) return loc(localWords.getMeanings(word, context, around))
  const p = new URLSearchParams({ word })
  if (context.trim()) p.set('context', context.slice(0, 600))
  if (around.trim()) p.set('around', around.slice(0, 600))
  return json<Meanings>(`/api/lexicon/word?${p}`, undefined, signal)
}

// ---------------------------------------------------------------- optional online helper
export const getOnlineStatus = () =>
  LOCAL ? loc(localOnline.onlineStatus()) : json<OnlineStatus>('/api/lexicon/online/status')
export const setOnlineEnabled = (enabled: boolean) =>
  LOCAL
    ? loc(localOnline.setOnlineEnabled(enabled))
    : json<OnlineStatus>('/api/lexicon/online/settings', body('PUT', { enabled }))
/** Autocomplete for the lookup boxes (phone version only, and only when the online helper is on). */
export const suggestWords = (prefix: string): Promise<string[]> =>
  LOCAL ? localOnline.suggestWords(prefix).catch(() => []) : Promise.resolve([])
export const getOnlineWords = (word: string, kind: OnlineKind, signal?: AbortSignal) =>
  LOCAL
    ? loc(localOnline.onlineWords(word, kind))
    : json<OnlineResult>(
        `/api/lexicon/online/words?word=${encodeURIComponent(word)}&kind=${kind}`,
        undefined,
        signal,
      )

// ---------------------------------------------------------------- phrase bank
export const listPhrases = (q = '', tag = '', signal?: AbortSignal) => {
  if (LOCAL) return loc(localWords.listPhrases(q, tag))
  const p = new URLSearchParams({ limit: '200' })
  if (q.trim()) p.set('q', q.trim())
  if (tag) p.set('tag', tag)
  return json<{ total: number; items: PhraseItem[] }>(`/api/phrases?${p}`, undefined, signal)
}
export const listPhraseTags = () =>
  LOCAL
    ? loc(localWords.listPhraseTags())
    : json<{ tag: string; count: number }[]>('/api/phrases/tags')
export type PhraseInput = { phrase: string; meaning: string; sounds_like: string; tags: string[] }
export const createPhrase = (data: PhraseInput) =>
  LOCAL ? loc(localWords.createPhrase(data)) : json<PhraseItem>('/api/phrases', body('POST', data))
export const updatePhrase = (id: string, data: Partial<PhraseInput>) =>
  LOCAL
    ? loc(localWords.updatePhrase(id, data))
    : json<PhraseItem>(`/api/phrases/${id}`, body('PATCH', data))
export const deletePhrase = async (id: string) => {
  if (LOCAL) return loc(localWords.deletePhrase(id))
  await request(`/api/phrases/${id}`, body('DELETE'))
}
export const exportPhrases = async () => {
  if (LOCAL) return loc(localWords.exportPhrases())
  const res = await request('/api/phrases/export')
  return res.blob()
}
export const phraseRhymes = (
  phrase: string,
  syllables: number,
  qualities: string[],
  signal?: AbortSignal,
) =>
  LOCAL
    ? loc(localWords.phraseRhymes(phrase, syllables, qualities))
    : json<PhraseRhymes>(
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

// ---------------------------------------------------------------- PIN lock (phone / tablet access)
export const authStatus = () => json<{ required: boolean; ok: boolean }>('/api/auth/status')
export const authLogin = (pin: string) =>
  json<{ required: boolean; ok: boolean }>('/api/auth/login', body('POST', { pin }))
export const authLogout = () => json<{ ok: boolean }>('/api/auth/logout', body('POST'))

// ---------------------------------------------------------------- craft tools (Phase 5)
export const listCraft = (songId: string | null, kind?: string, q = '', tag = '') => {
  const p = new URLSearchParams()
  if (songId) p.set('song_id', songId)
  if (kind) p.set('kind', kind)
  if (q.trim()) p.set('q', q.trim())
  if (tag) p.set('tag', tag)
  return json<CraftItem[]>(`/api/craft/items?${p}`)
}
export const addCraft = (data: {
  song_id: string | null
  kind: string
  text: string
  tags: string[]
}) => json<CraftItem>('/api/craft/items', body('POST', data))
export const deleteCraft = async (id: string) => {
  await request(`/api/craft/items/${id}`, body('DELETE'))
}
export const listTakes = (songId: string, lineId: string) =>
  json<Take[]>(`/api/craft/songs/${songId}/takes?line_id=${encodeURIComponent(lineId)}`)
export const addTake = (songId: string, lineId: string, text: string, note = '') =>
  json<Take>(`/api/craft/songs/${songId}/takes`, body('POST', { line_id: lineId, text, note }))
export const setTakeFavourite = (id: string, favourite: boolean) =>
  json<Take>(`/api/craft/takes/${id}/favourite`, body('PUT', { favourite }))
export const deleteTake = async (id: string) => {
  await request(`/api/craft/takes/${id}`, body('DELETE'))
}
export const getPlan = (songId: string) => json<Plan>(`/api/craft/songs/${songId}/plan`)
export const putPlan = (songId: string, plan: Plan) =>
  json<Plan>(`/api/craft/songs/${songId}/plan`, body('PUT', plan))
export const getGrids = (songId: string) =>
  json<Record<string, FlowGrid>>(`/api/craft/songs/${songId}/grids`)
export const putGrid = (songId: string, lineId: string, grid: FlowGrid) =>
  json<FlowGrid>(`/api/craft/songs/${songId}/grids/${lineId}`, body('PUT', grid))
export const deleteGrid = async (songId: string, lineId: string) => {
  await request(`/api/craft/songs/${songId}/grids/${lineId}`, body('DELETE'))
}
export const getSyllables = (text: string, signal?: AbortSignal) =>
  json<{ syllables: SyllableInfo[] }>(
    `/api/craft/syllables?text=${encodeURIComponent(text)}`,
    undefined,
    signal,
  )
export const scanSong = (songId: string) => json<ScanResult>(`/api/craft/songs/${songId}/scan`)
export const getChains = (lines: string[], strictness: string) =>
  json<Chains>('/api/craft/chains', body('POST', { lines, strictness }))
export const getDna = () => json<Dna>('/api/craft/dna')
export const getDnaApproved = () => json<string[]>('/api/craft/dna/approved')
export const approveDna = async (songId: string) => {
  await request(`/api/craft/dna/songs/${songId}`, body('PUT'))
}
export const removeDna = async (songId: string) => {
  await request(`/api/craft/dna/songs/${songId}`, body('DELETE'))
}
export const clearDna = async () => {
  await request('/api/craft/dna', body('DELETE'))
}

// scratch vocal takes (Phase 6)
export const listVocals = (songId: string) => json<VocalTake[]>(`/api/craft/songs/${songId}/vocals`)
export const uploadVocal = (songId: string, blob: Blob, durationMs: number, offsetMs: number) =>
  json<VocalTake>(`/api/craft/songs/${songId}/vocals`, {
    method: 'POST',
    body: blob,
    headers: {
      'Content-Type': blob.type || 'audio/webm',
      'X-Duration-Ms': String(Math.round(durationMs)),
      'X-Offset-Ms': String(Math.round(offsetMs)),
    },
  })
export const patchVocal = (id: string, data: { note?: string; offset_ms?: number }) =>
  json<VocalTake>(`/api/craft/vocals/${id}`, body('PATCH', data))
export const deleteVocal = async (id: string) => {
  await request(`/api/craft/vocals/${id}`, body('DELETE'))
}
export const vocalUrl = (id: string) => `${BASE}/api/craft/vocals/${id}/audio`

// melody sketch and chords (Phase 8)
export const getMelody = (songId: string) => json<MelodySketch>(`/api/craft/songs/${songId}/melody`)
export const putMelody = (songId: string, sketch: Omit<MelodySketch, never>) =>
  json<MelodySketch>(
    `/api/craft/songs/${songId}/melody`,
    body('PUT', {
      notes: sketch.notes.map(({ start16, len16, midi }) => ({ start16, len16, midi })),
      chords: sketch.chords,
    }),
  )
