import { createContext, useContext } from 'react'
import type { RepeatMode, Track } from '../types'
import type { Loop } from './logic'

export type PlayStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PlayOptions = {
  playlistId?: string | null
  autoplay?: boolean
  startAt?: number
  loop?: Loop
  speed?: number
}

export type PlayerValue = {
  // library
  library: Track[]
  libraryLoaded: boolean
  libraryError: string | null
  refreshLibrary: () => Promise<void>
  // what is loaded
  track: Track | null
  playlistId: string | null
  queuePos: number
  queueLength: number
  upNext: Track[]
  // transport state
  playing: boolean
  time: number
  duration: number | null
  status: PlayStatus
  error: string | null
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  speed: number
  pitchSupported: boolean
  loop: Loop
  loopError: string | null
  // ui
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  // actions
  playList: (items: Track[], index: number, opts?: PlayOptions) => void
  playTrack: (t: Track) => void
  toggle: () => void
  pause: () => void
  seek: (sec: number) => void
  skip: (delta: number) => void
  next: () => void
  prev: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  cycleRepeat: () => void
  toggleShuffle: () => void
  setSpeed: (s: number) => void
  markA: () => void
  markB: () => void
  clearLoop: () => void
  setLoop: (l: Loop) => void
  enqueueNext: (t: Track) => void
}

export const PlayerContext = createContext<PlayerValue | null>(null)

export function usePlayer(): PlayerValue {
  const v = useContext(PlayerContext)
  if (!v) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return v
}
