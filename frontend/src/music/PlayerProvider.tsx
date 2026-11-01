import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as api from '../api'
import { useToast } from '../components/toastContext'
import type { PlaybackSaved, RepeatMode, Track } from '../types'
import { loopActive, loopJump, makeOrder, nextPos, prevPos, setLoopPoint, type Loop } from './logic'
import { PlayerContext, type PlayOptions, type PlayStatus, type PlayerValue } from './playerContext'

const NO_LOOP: Loop = { a: null, b: null }

function applyPitch(a: HTMLAudioElement) {
  const x = a as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }
  if ('preservesPitch' in a) a.preservesPitch = true
  if ('mozPreservesPitch' in a) x.mozPreservesPitch = true
  if ('webkitPreservesPitch' in a) x.webkitPreservesPitch = true
}
const pitchOk = (a: HTMLAudioElement) =>
  'preservesPitch' in a || 'mozPreservesPitch' in a || 'webkitPreservesPitch' in a

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName)
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  // One audio element for the whole app. It lives here, above every page and editor,
  // so moving between songs, sections and panels can never restart or stop it.
  const [audio] = useState(() => {
    const a = new Audio()
    a.preload = 'metadata'
    applyPitch(a)
    return a
  })

  const [library, setLibrary] = useState<Track[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [playlistId, setPlaylistId] = useState<string | null>(null)
  const [queuePos, setQueuePos] = useState(0)
  const [queueLength, setQueueLength] = useState(0)
  const [upNext, setUpNext] = useState<Track[]>([])
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
  const [status, setStatus] = useState<PlayStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [repeat, setRepeatState] = useState<RepeatMode>('off')
  const [shuffle, setShuffleState] = useState(false)
  const [speed, setSpeedState] = useState(1)
  const [loop, setLoopState] = useState<Loop>(NO_LOOP)
  const [loopError, setLoopError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const items = useRef<Track[]>([])
  const order = useRef<number[]>([])
  const pos = useRef(0)
  const upNextRef = useRef<Track[]>([])
  const interlude = useRef(false)
  const repeatRef = useRef<RepeatMode>('off')
  const shuffleRef = useRef(false)
  const loopRef = useRef<Loop>(NO_LOOP)
  const speedRef = useRef(1)
  const pendingSeek = useRef<number | null>(null)
  const lastTime = useRef(0)
  const trackRef = useRef<Track | null>(null)
  const playlistRef = useRef<string | null>(null)
  const restored = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  trackRef.current = track
  playlistRef.current = playlistId

  // ------------------------------------------------------------ persistence
  const persist = useCallback(
    (now = false) => {
      if (!restored.current) return
      const run = () => {
        const body: PlaybackSaved = {
          track_id: trackRef.current?.id ?? null,
          playlist_id: playlistRef.current,
          position_seconds: Math.max(0, Math.min(86400, audio.currentTime || 0)),
          repeat_mode: repeatRef.current,
          shuffle_enabled: shuffleRef.current,
          volume: audio.volume,
          speed: speedRef.current,
        }
        api.savePlaybackState(body).catch(() => {
          /* remembering the last position is a convenience; never interrupt playback */
        })
      }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (now) run()
      else saveTimer.current = setTimeout(run, 800)
    },
    [audio],
  )

  // ------------------------------------------------------------ library
  const refreshLibrary = useCallback(async () => {
    try {
      const tracks = await api.listTracks()
      setLibrary(tracks)
      setLibraryError(null)
      const byId = new Map(tracks.map((t) => [t.id, t]))
      items.current = items.current.map((t) => byId.get(t.id) ?? t)
      setTrack((cur) => (cur ? (byId.get(cur.id) ?? cur) : cur))
      setUpNext((u) => {
        const next = u.filter((t) => byId.has(t.id)).map((t) => byId.get(t.id) as Track)
        upNextRef.current = next
        return next
      })
    } catch (e) {
      setLibraryError(e instanceof api.ApiFail ? e.message : 'Could not load the music library.')
    } finally {
      setLibraryLoaded(true)
    }
  }, [])

  // ------------------------------------------------------------ loading tracks
  const loadTrack = useCallback(
    (t: Track, autoplay: boolean, startAt = 0) => {
      setTrack(t)
      trackRef.current = t
      setError(null)
      setTime(startAt)
      setDuration(t.duration)
      lastTime.current = startAt
      if (!t.available) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        setStatus('error')
        setError('The audio file is missing. Open the library and use “Relink file”.')
        setPlaying(false)
        return false
      }
      setStatus('loading')
      pendingSeek.current = startAt > 0 ? startAt : null
      audio.src = api.trackAudioUrl(t)
      audio.playbackRate = speedRef.current
      audio.defaultPlaybackRate = speedRef.current
      applyPitch(audio)
      audio.load()
      if (autoplay) {
        audio.play().catch((e: unknown) => {
          setPlaying(false)
          if (e instanceof DOMException && e.name === 'NotAllowedError') {
            toast(
              'Press play to start. Your browser needs a tap before it will play sound.',
              'info',
            )
          }
        })
      }
      return true
    },
    [audio, toast],
  )

  const syncQueueInfo = () => {
    setQueuePos(pos.current)
    setQueueLength(items.current.length)
  }

  const playList = useCallback(
    (list: Track[], index: number, opts: PlayOptions = {}) => {
      if (!list.length || !list[index]) return
      items.current = list
      interlude.current = false
      order.current = makeOrder(list.length, shuffleRef.current, index)
      pos.current = shuffleRef.current ? 0 : index
      setPlaylistId(opts.playlistId ?? null)
      playlistRef.current = opts.playlistId ?? null
      if (opts.speed !== undefined) {
        speedRef.current = opts.speed
        setSpeedState(opts.speed)
      }
      const l = opts.loop ?? NO_LOOP
      loopRef.current = l
      setLoopState(l)
      setLoopError(null)
      syncQueueInfo()
      loadTrack(list[index], opts.autoplay ?? true, opts.startAt ?? 0)
      persist(true)
    },
    [loadTrack, persist],
  )

  const playTrack = useCallback((t: Track) => playList([t], 0), [playList])

  const advance = useCallback(
    (manual: boolean) => {
      if (upNextRef.current.length) {
        const [t, ...rest] = upNextRef.current
        upNextRef.current = rest
        setUpNext(rest)
        interlude.current = true
        loadTrack(t, true)
        return
      }
      interlude.current = false
      const n = items.current.length
      let target = nextPos(pos.current, n, repeatRef.current, manual)
      if (target === null) {
        audio.pause()
        setPlaying(false)
        persist(true)
        return
      }
      if (target === 0 && pos.current === n - 1 && shuffleRef.current && n > 1) {
        const last = order.current[n - 1]
        const fresh = makeOrder(n, true, Math.floor(Math.random() * n))
        if (fresh[0] === last) [fresh[0], fresh[1]] = [fresh[1], fresh[0]]
        order.current = fresh
        target = 0
      }
      // skip over files that are missing, but never loop forever
      for (let tries = 0; tries < n; tries++) {
        const t = items.current[order.current[target as number]]
        if (t?.available) {
          pos.current = target as number
          syncQueueInfo()
          loadTrack(t, true)
          persist(true)
          return
        }
        const nxt = nextPos(target as number, n, repeatRef.current, true)
        if (nxt === null) break
        target = nxt
      }
      audio.pause()
      setPlaying(false)
    },
    [audio, loadTrack, persist],
  )

  const next = useCallback(() => advance(true), [advance])
  const prev = useCallback(() => {
    const n = items.current.length
    if (!n) return
    const target = interlude.current
      ? pos.current
      : prevPos(pos.current, n, repeatRef.current, audio.currentTime)
    if (target === pos.current && !interlude.current) {
      audio.currentTime = 0
      lastTime.current = 0
      setTime(0)
      return
    }
    interlude.current = false
    pos.current = target
    syncQueueInfo()
    const t = items.current[order.current[target]]
    if (t) loadTrack(t, true)
    persist(true)
  }, [audio, loadTrack, persist])

  // ------------------------------------------------------------ transport
  const toggle = useCallback(() => {
    if (!trackRef.current) return
    if (audio.paused) {
      if (!audio.src) return
      audio.play().catch(() => setPlaying(false))
    } else audio.pause()
  }, [audio])
  const pause = useCallback(() => audio.pause(), [audio])

  const seek = useCallback(
    (sec: number) => {
      const max = Number.isFinite(audio.duration) ? audio.duration : sec
      const t = Math.max(0, Math.min(sec, max))
      audio.currentTime = t
      lastTime.current = t
      setTime(t)
    },
    [audio],
  )
  const skip = useCallback((d: number) => seek((audio.currentTime || 0) + d), [audio, seek])

  const setVolume = useCallback(
    (v: number) => {
      const x = Math.max(0, Math.min(1, v))
      audio.volume = x
      setVolumeState(x)
      if (x > 0) {
        audio.muted = false
        setMuted(false)
      }
      persist()
    },
    [audio, persist],
  )
  const toggleMute = useCallback(() => {
    audio.muted = !audio.muted
    setMuted(audio.muted)
  }, [audio])
  const cycleRepeat = useCallback(() => {
    const nxt: RepeatMode =
      repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off'
    repeatRef.current = nxt
    setRepeatState(nxt)
    persist()
  }, [persist])
  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current
    shuffleRef.current = on
    setShuffleState(on)
    const n = items.current.length
    if (n) {
      const curItem = order.current[pos.current] ?? 0
      order.current = makeOrder(n, on, curItem)
      pos.current = on ? 0 : curItem
      syncQueueInfo()
    }
    persist()
  }, [persist])
  const setSpeed = useCallback(
    (s: number) => {
      speedRef.current = s
      setSpeedState(s)
      audio.playbackRate = s
      audio.defaultPlaybackRate = s
      applyPitch(audio)
      persist()
    },
    [audio, persist],
  )

  const markA = useCallback(() => {
    const r = setLoopPoint(loopRef.current, 'a', audio.currentTime || 0)
    setLoopError(r.error ?? null)
    if (!r.error) {
      loopRef.current = r.loop
      setLoopState(r.loop)
    }
  }, [audio])
  const markB = useCallback(() => {
    const r = setLoopPoint(loopRef.current, 'b', audio.currentTime || 0)
    setLoopError(r.error ?? null)
    if (!r.error) {
      loopRef.current = r.loop
      setLoopState(r.loop)
    }
  }, [audio])
  const clearLoop = useCallback(() => {
    loopRef.current = NO_LOOP
    setLoopState(NO_LOOP)
    setLoopError(null)
  }, [])
  const setLoop = useCallback((l: Loop) => {
    loopRef.current = l
    setLoopState(l)
    setLoopError(null)
  }, [])
  const enqueueNext = useCallback((t: Track) => {
    upNextRef.current = [...upNextRef.current, t]
    setUpNext(upNextRef.current)
  }, [])

  // ------------------------------------------------------------ audio element events
  useEffect(() => {
    const onMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : null)
      audio.playbackRate = speedRef.current
      if (pendingSeek.current !== null) {
        const max = Number.isFinite(audio.duration) ? audio.duration : pendingSeek.current
        audio.currentTime = Math.min(pendingSeek.current, max)
        lastTime.current = audio.currentTime
        setTime(audio.currentTime)
        pendingSeek.current = null
      }
      setStatus('ready')
    }
    const onTime = () => {
      const t = audio.currentTime
      const jump = loopJump(loopRef.current, lastTime.current, t)
      if (jump !== null) {
        audio.currentTime = jump
        lastTime.current = jump
        setTime(jump)
        return
      }
      lastTime.current = t
      setTime(t)
    }
    const onPlay = () => {
      setPlaying(true)
      setStatus((s) => (s === 'error' ? s : 'ready'))
    }
    const onPause = () => {
      setPlaying(false)
      persist(true)
    }
    const onEnded = () => {
      if (loopActive(loopRef.current)) {
        const a = loopRef.current.a as number
        audio.currentTime = a
        lastTime.current = a
        audio.play().catch(() => setPlaying(false))
        return
      }
      advance(false)
    }
    const onWaiting = () => setStatus((s) => (s === 'error' ? s : 'loading'))
    const onCanPlay = () => setStatus((s) => (s === 'error' ? s : 'ready'))
    const onError = () => {
      if (!audio.getAttribute('src')) return
      setStatus('error')
      setPlaying(false)
      const code = audio.error?.code
      setError(
        code === 4
          ? "This browser can't play that file, or the file is missing. Open the library to relink it."
          : 'The audio could not be loaded. Check that the Studio Bars server is running.',
      )
      void refreshLibrary()
    }
    const ev: [string, () => void][] = [
      ['loadedmetadata', onMeta],
      ['timeupdate', onTime],
      ['play', onPlay],
      ['pause', onPause],
      ['ended', onEnded],
      ['waiting', onWaiting],
      ['canplay', onCanPlay],
      ['error', onError],
    ]
    ev.forEach(([n, f]) => audio.addEventListener(n, f))
    return () => ev.forEach(([n, f]) => audio.removeEventListener(n, f))
  }, [audio, advance, persist, refreshLibrary])

  // precise loop edge: check every frame while a loop is playing
  useEffect(() => {
    if (!playing || !loopActive(loop)) return
    let raf = 0
    const tick = () => {
      const t = audio.currentTime
      const jump = loopJump(loopRef.current, lastTime.current, t)
      if (jump !== null) {
        audio.currentTime = jump
        lastTime.current = jump
      } else lastTime.current = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audio, playing, loop])

  // remember position every 10 s while playing
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => persist(true), 10000)
    return () => clearInterval(id)
  }, [playing, persist])

  // ------------------------------------------------------------ restore last session (never auto-plays)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [tracks, st] = await Promise.all([api.listTracks(), api.getPlaybackState()])
        if (cancelled) return
        setLibrary(tracks)
        setLibraryLoaded(true)
        audio.volume = st.volume
        setVolumeState(st.volume)
        repeatRef.current = st.repeat_mode
        setRepeatState(st.repeat_mode)
        shuffleRef.current = st.shuffle_enabled
        setShuffleState(st.shuffle_enabled)
        speedRef.current = st.speed
        setSpeedState(st.speed)
        const t = tracks.find((x) => x.id === st.track_id)
        if (t && !trackRef.current) {
          let list = [t]
          let idx = 0
          if (st.playlist_id) {
            try {
              const pl = await api.getPlaylist(st.playlist_id)
              const li = pl.entries.map((e) => e.track)
              const i = li.findIndex((x) => x.id === t.id)
              if (i >= 0) {
                list = li
                idx = i
              }
            } catch {
              /* the playlist was removed; just load the track */
            }
          }
          if (!cancelled && !trackRef.current) {
            items.current = list
            order.current = makeOrder(list.length, st.shuffle_enabled, idx)
            pos.current = st.shuffle_enabled ? 0 : idx
            setPlaylistId(list.length > 1 ? st.playlist_id : null)
            playlistRef.current = list.length > 1 ? st.playlist_id : null
            syncQueueInfo()
            loadTrack(t, false, st.position_seconds)
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLibraryError(
            e instanceof api.ApiFail ? e.message : 'Could not load the music library.',
          )
          setLibraryLoaded(true)
        }
      } finally {
        restored.current = true
      }
    })()
    return () => {
      cancelled = true
    }
    // run once at startup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ keyboard (never while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.key === ' ') {
        if (!trackRef.current) return
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') skip(-5)
      else if (e.key === 'ArrowRight') skip(5)
      else if (e.key === '[') markA()
      else if (e.key === ']') markB()
      else if (e.key === '\\') clearLoop()
      else if (e.key.toLowerCase() === 'm') toggleMute()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, skip, markA, markB, clearLoop, toggleMute])

  // lock-screen / notification controls where the browser offers them
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    if (track && typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({ title: track.title, artist: track.artist || 'Studio Bars' })
    }
    ms.setActionHandler('play', () => toggle())
    ms.setActionHandler('pause', () => pause())
    ms.setActionHandler('previoustrack', () => prev())
    ms.setActionHandler('nexttrack', () => next())
  }, [track, toggle, pause, prev, next])

  const value = useMemo<PlayerValue>(
    () => ({
      library,
      libraryLoaded,
      libraryError,
      refreshLibrary,
      track,
      playlistId,
      queuePos,
      queueLength,
      upNext,
      playing,
      time,
      duration,
      status,
      error,
      volume,
      muted,
      repeat,
      shuffle,
      speed,
      pitchSupported: pitchOk(audio),
      loop,
      loopError,
      drawerOpen,
      setDrawerOpen,
      playList,
      playTrack,
      toggle,
      pause,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      setSpeed,
      markA,
      markB,
      clearLoop,
      setLoop,
      enqueueNext,
    }), // fmt: skip
    [
      library,
      libraryLoaded,
      libraryError,
      refreshLibrary,
      track,
      playlistId,
      queuePos,
      queueLength,
      upNext,
      playing,
      time,
      duration,
      status,
      error,
      volume,
      muted,
      repeat,
      shuffle,
      speed,
      audio,
      loop,
      loopError,
      drawerOpen,
      playList,
      playTrack,
      toggle,
      pause,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      setSpeed,
      markA,
      markB,
      clearLoop,
      setLoop,
      enqueueNext,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}
