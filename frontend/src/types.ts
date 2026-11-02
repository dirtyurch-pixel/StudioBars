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

// ---------------------------------------------------------------- phonetics (Phase 2)
export type WordStatus = 'known' | 'custom' | 'derived' | 'guess'
export type Pronunciation = {
  phones: string
  ipa: string
  syllables: number
  stress: string
  source: string
}
export type WordInfo = {
  word: string
  status: WordStatus
  pronunciations: Pronunciation[]
  syllables_min: number
  syllables_max: number
  ambiguous: boolean
  note: string
}
export type LineSyllables = { min: number; max: number; exact: boolean; guessed: boolean }
export type AnalyzedWord = {
  text: string
  start: number
  end: number
  status: WordStatus
  syllables_min: number
  syllables_max: number
  is_end: boolean
  family: number | null
}
export type RhymeFamily = { id: number; sound: string; size: number; end_count: number }
export type Analysis = {
  lines: { syllables: LineSyllables; words: AnalyzedWord[] }[]
  families: RhymeFamily[]
  unknown_words: string[]
}
export type RhymeQuality = 'homophone' | 'rich' | 'perfect' | 'near' | 'assonance' | 'consonance'
export type RhymeResult = {
  word: string
  ipa: string
  syllables: number
  stress: string
  ending: 'masculine' | 'feminine' | 'dactylic'
  quality: RhymeQuality
  zipf: number | null
  custom: boolean
}
export type RhymeResponse = {
  word: WordInfo
  results: RhymeResult[]
  total: number
  notes: string[]
}
export type PhoneticsStatus = {
  dictionary_words: number
  frequency_available: boolean
  pos_available: boolean
  custom_count: number
  quality_help: Record<RhymeQuality, string>
  attribution: string
}
export type CustomPron = {
  word: string
  phones: string
  ipa: string
  syllables: number
  note: string
}

// ---------------------------------------------------------------- meanings, online helper, phrase bank (Phase 3)
export type MeaningShift = { rank: number; of: number; usually_means: string }
export type Synonym = { word: string; shift?: MeaningShift }
export type Chip = { word: string; via?: string }
export type Sense = {
  id: string
  pos: 'n' | 'v' | 'a' | 'r'
  pos_label: string
  sense_no: number
  of: number
  lemma: string
  definition: string
  examples: string[]
  synonyms: Synonym[]
  similar: Synonym[]
  antonyms: Chip[]
  broader: Chip[]
  narrower: Chip[]
  related: Chip[]
  imagery: Chip[]
  said_as: { phones: string; ipa: string; in_dictionary: boolean } | null
  fit: { score: number; matched: string[]; best: boolean } | null
}
export type Meanings = {
  word: string
  found: boolean
  forms: string[]
  senses: Sense[]
  pos_counts: Record<string, number>
  total_senses: number
  context_used: boolean
  reordered: boolean
  notes: string[]
  source: string
}
export type OnlineStatus = {
  enabled: boolean
  service: string
  host: string
  cached_answers: number
  sends: string
  key_notice: string
}
export type OnlineKind = 'related' | 'associated' | 'sounds-like' | 'rhymes' | 'near-rhymes'
export type OnlineResult = {
  source: string
  online: boolean
  from_cache: boolean
  stale: boolean
  fetched_at: string
  query: { word: string; kind: OnlineKind }
  sent: string
  results: { word: string; score: number | null }[]
  notice: string | null
}
export type PhrasePron = {
  known: boolean
  syllables_min: number
  syllables_max: number
  ipa: string
  unknown_words: string[]
  guessed?: boolean
}
export type PhraseItem = {
  id: string
  phrase: string
  meaning: string
  sounds_like: string
  tags: string[]
  pronunciation: PhrasePron
}
export type PhraseRhymeResult = {
  text: string
  kind: 'word' | 'mine'
  quality: 'perfect' | 'near' | 'assonance'
  ipa: string
  syllables: number
}
export type PhraseRhymes = {
  phrase: string
  syllables: number
  tail_ipa: string
  experimental: boolean
  notes: string[]
  total: number
  results: PhraseRhymeResult[]
}

// ---------------------------------------------------------------- Phase 4: AI co-writer

export type AiTaskId =
  | 'next_line'
  | 'rewrite'
  | 'shorter'
  | 'conversational'
  | 'imagery'
  | 'punchline'
  | 'emotion'
  | 'rhyme'
  | 'metaphor'
  | 'wordplay'
  | 'hook'
  | 'structure'
  | 'critique'

export type AiTaskInfo = {
  id: AiTaskId
  label: string
  kind: 'lines' | 'notes'
  needs_line: boolean
  needs_rhyme: boolean
  whole_song: boolean
}

export type AiUsage = {
  month: string
  spent_usd: number
  requests: number
  cap_usd: number
  remaining_usd: number
}

export type AiStatus = {
  enabled: boolean
  provider: 'anthropic' | 'openai_compat'
  model: string
  base_url: string
  cap_usd: number
  price_in: number
  price_out: number
  key: { configured: boolean; source: 'env' | 'file' | 'session' | null; hint: string | null }
  usage: AiUsage
  models: { id: string; label: string; typical_request_usd: number }[]
  providers: { id: string; label: string }[]
  tasks: AiTaskInfo[]
  personas: { id: string; label: string; text: string }[]
  ready: boolean
  disclosure: string
}

export type AiSettingsIn = Partial<{
  enabled: boolean
  provider: string
  model: string
  base_url: string
  cap_usd: number
  price_in: number
  price_out: number
}>

export type AiRequest = {
  song_id: string
  section_id: string
  task: AiTaskId
  target_line_id?: string | null
  rhyme_with_line_id?: string | null
  count?: number
  instruction?: string
  target_syllables?: number | null
  include_other_sections?: boolean
  persona?: string
}

export type AiPrepared = {
  hash: string
  provider: string
  model: string
  system: string
  user: string
  sent: { sections: string[]; lines: number }
  est_input_tokens: number
  max_output_tokens: number
  est_cost_usd: number
  worst_cost_usd: number
  over_budget: boolean
  usage: AiUsage
}

export type AiCandidate = {
  id: string
  text: string
  reason: string
  syllables: { min: number; max: number; exact: boolean; guessed: boolean }
  rhymes_with_target: string | null
}

export type AiResult = {
  kind: 'lines' | 'notes'
  model: string
  suggestions: AiCandidate[]
  notes: string[]
  target_line_id?: string | null
  usage: { input_tokens: number; output_tokens: number; cost_usd: number }
  month: AiUsage
}

// ---------------------------------------------------------------- Phase 5: craft tools

export type CraftItem = {
  id: string
  song_id: string | null
  kind: string
  text: string
  tags: string[]
  created_at: string
}
export const VAULT_KINDS = ['hook', 'punchline', 'bar', 'rhyme', 'idea'] as const
export const CONCEPT_KINDS = [
  'theme',
  'character',
  'scene',
  'title',
  'mood',
  'arc',
  'hook',
  'idea',
] as const

export type Take = {
  id: string
  line_id: string
  text: string
  favourite: boolean
  note: string
  created_at: string
}
export type Plan = {
  scene: string
  conflict: string
  turning_point: string
  emotional_arc: string
  notes: string
}
export const PLAN_LABELS: [keyof Plan, string][] = [
  ['scene', 'Scene: where and when'],
  ['conflict', 'Conflict: what is the tension?'],
  ['turning_point', 'Turning point: what changes?'],
  ['emotional_arc', 'Emotional arc: where does the feeling go?'],
  ['notes', 'Other notes'],
]

export type Subdivision = '8th' | '16th' | 'triplet'
export const SLOTS_PER_BAR: Record<Subdivision, number> = { '8th': 8, '16th': 16, triplet: 12 }
export type FlowGrid = {
  subdivision: Subdivision
  bars: number
  assign: (number | null)[]
  accents: boolean[]
  rests: number[]
}
export type SyllableInfo = {
  word: string
  word_index: number
  stress: 0 | 1 | 2 | null
  first: boolean
  guess: boolean
}

export type ScanResult = {
  cliches: { line_id: string; section: string; phrase: string; text: string }[]
  repeated_lines: {
    text: string
    count: number
    line_ids: string[]
    sections: string[]
    intentional: boolean
  }[]
  reused_phrases: { phrase: string; count: number; line_ids: string[] }[]
  filler: { line_id: string; section: string; words: string[]; text: string }[]
  singability: {
    line_id: string
    section: string
    kind: 'long' | 'crowded'
    text: string
    detail: string
    breath_after: number | null
  }[]
  structure: {
    sections: {
      label: string
      type: string
      lines: number
      avg_syllables: number | null
      spread: number | null
      rhyme_families: number
      end_rhyme_share: number | null
    }[]
    notes: string[]
    disclaimer: string
  }
}
export type Chains = {
  chains: {
    members: {
      line: number
      word: string
      start: number
      end: number
      alternate_pronunciations: boolean
    }[]
    internal: boolean
    weakest_link: string | null
  }[]
  strictness: string
  note: string
}

export type Dna =
  | { empty: true; songs: [] }
  | {
      empty: false
      songs: { id: string; title: string }[]
      lines: number
      avg_syllables_per_line: number | null
      avg_words_per_line: number | null
      end_rhyme_share: number | null
      vocabulary_variety: number | null
      favourite_words: { word: string; count: number }[]
      common_openers: { word: string; count: number }[]
      rhyme_sounds: { sound: string; uses: number }[]
      note: string
    }

export type VocalTake = {
  id: string
  song_id: string
  duration_ms: number
  offset_ms: number
  note: string
  size_bytes: number
  media_type: string
  created_at: string
  available: boolean
  /** phone version: the recording is played straight from the device */
  url?: string
}

export type MelodySketch = {
  notes: { id?: string; start16: number; len16: number; midi: number }[]
  chords: Record<string, string>
}
