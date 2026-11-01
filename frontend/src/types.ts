export type Genre = 'hip-hop' | 'r&b' | 'house' | 'pop'
export const GENRES: { id: Genre; label: string }[] = [
  { id: 'hip-hop', label: 'Hip-Hop' },
  { id: 'r&b', label: 'R&B' },
  { id: 'house', label: 'House' },
  { id: 'pop', label: 'Pop' },
]

export type SectionType =
  'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'hook' | 'bridge' | 'outro' | 'custom'
export const SECTION_TYPES: SectionType[] = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'hook',
  'bridge',
  'outro',
  'custom',
]

export type Comment = { id: string; body: string; created_at: string; updated_at: string }
export type Line = { id: string; text: string; is_locked: boolean; comments: Comment[] }
export type Section = { id: string; label: string; section_type: SectionType; lines: Line[] }
export type Content = Section[]

export type Song = {
  id: string
  title: string
  concept: string
  mood: string
  point_of_view: string
  bpm: number | null
  time_signature: string | null
  version: number
  created_at: string
  updated_at: string
  genres: Genre[]
  sections: Section[]
}

export type SongSummary = {
  id: string
  title: string
  bpm: number | null
  time_signature: string | null
  updated_at: string
  deleted_at: string | null
  genres: Genre[]
  line_count: number
  locked_count: number
}

export type Revision = {
  id: string
  created_at: string
  kind: 'auto' | 'manual' | 'pre-restore'
  description: string
  line_count: number
  section_count: number
}

export type ImportPreview = {
  title: string
  warnings: string[]
  line_count: number
  locked_count: number
  sections: { label: string; section_type: string; lines: string[] }[]
}

export const MAX_LINE_CHARS = 500
export const MAX_LINES = 2000

// ---------------------------------------------------------------- music
export type Track = {
  id: string
  title: string
  artist: string
  album: string
  duration: number | null
  media_type: string
  ext: string
  size_bytes: number
  added_at: string
  available: boolean
  file_version: string
  duplicate_of?: string | null
}
export type PlaylistSummary = {
  id: string
  name: string
  track_count: number
  total_duration: number
}
export type PlaylistEntry = { entry_id: string; track: Track }
export type PlaylistDetail = { id: string; name: string; entries: PlaylistEntry[] }
export type RepeatMode = 'off' | 'all' | 'one'
export type PlaybackSaved = {
  track_id: string | null
  playlist_id: string | null
  position_seconds: number
  repeat_mode: RepeatMode
  shuffle_enabled: boolean
  volume: number
  speed: number
}
export type SongAudioLink = {
  track_id: string | null
  playlist_id: string | null
  loop_a: number | null
  loop_b: number | null
  position_seconds: number
  speed: number
}
