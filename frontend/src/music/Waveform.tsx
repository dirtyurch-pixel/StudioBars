import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'
import type { Track } from '../types'
import { formatTime, loopActive } from './logic'
import { usePlayer } from './playerContext'
import {
  MAX_BPM,
  MAX_WAVE_BYTES,
  MIN_BPM,
  addTap,
  barBeat,
  beatTimes,
  computePeaks,
  nearestBeat,
  tapTempo,
  type Beats,
} from './wave'

const BUCKETS = 800
const HEIGHT = 56
const cache = new Map<string, number[]>()

type WaveState = { key: string; peaks: number[] | null; note: string | null }

/** Read the track's audio once and turn it into a row of loudness bars. Kept in memory for a few tracks. */
async function loadPeaks(t: Track, signal: AbortSignal): Promise<number[]> {
  const key = `${t.id}:${t.file_version}`
  const hit = cache.get(key)
  if (hit) return hit
  const res = await fetch(api.trackAudioUrl(t), { signal, credentials: 'same-origin' })
  if (!res.ok) throw new Error('fetch')
  const data = await res.arrayBuffer()
  const Ctx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!Ctx) throw new Error('no audio')
  const ctx = new Ctx(1, 1, 44100)
  const buf = await new Promise<AudioBuffer>((ok, bad) => {
    const p = ctx.decodeAudioData(data, ok, bad)
    if (p && typeof p.then === 'function') p.then(ok, bad)
  })
  const chans: Float32Array[] = []
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c))
  const peaks = computePeaks(chans, BUCKETS)
  cache.set(key, peaks)
  if (cache.size > 8) cache.delete(cache.keys().next().value as string)
  return peaks
}

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function Waveform() {
  const p = usePlayer()
  const t = p.track
  const canvas = useRef<HTMLCanvasElement>(null)
  const [wave, setWave] = useState<WaveState>({ key: '', peaks: null, note: null })
  const [width, setWidth] = useState(0)
  const [beats, setBeats] = useState<Beats | null>(null)
  const [beatsFor, setBeatsFor] = useState<string | null>(null)
  const [bpmText, setBpmText] = useState('')
  const [taps, setTaps] = useState<number[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const edited = useRef(false) // the writer typed a tempo before the saved one arrived
  const dur = p.duration ?? t?.duration ?? 0
  const key = t ? `${t.id}:${t.file_version}` : ''

  // peaks for the loaded track
  useEffect(() => {
    if (!t) return
    if (!t.available) {
      setWave({ key, peaks: null, note: 'The audio file is missing, so there is no waveform.' })
      return
    }
    if (t.size_bytes > MAX_WAVE_BYTES) {
      setWave({ key, peaks: null, note: 'This file is too big to draw. Beat markers still work.' })
      return
    }
    const ctl = new AbortController()
    setWave({ key, peaks: cache.get(key) ?? null, note: null })
    loadPeaks(t, ctl.signal).then(
      (peaks) => setWave({ key, peaks, note: null }),
      () => {
        if (!ctl.signal.aborted)
          setWave({ key, peaks: null, note: 'This browser could not read the audio to draw it.' })
      },
    )
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // saved beat markers for the loaded track
  useEffect(() => {
    if (!t) return
    let live = true
    setBeats(null)
    setBeatsFor(null)
    setTaps([])
    setMsg(null)
    edited.current = false
    api.getTrackBeats(t.id).then(
      (b) => {
        if (!live) return
        setBeats(b)
        setBeatsFor(t.id)
        if (!edited.current) setBpmText(b ? String(b.bpm) : '')
      },
      () => live && setBeatsFor(t.id),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id])

  // follow the canvas width
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const set = () => setWidth(el.clientWidth)
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // draw
  useEffect(() => {
    const el = canvas.current
    if (!el || !width) return
    const dpr = window.devicePixelRatio || 1
    el.width = Math.round(width * dpr)
    el.height = Math.round(HEIGHT * dpr)
    const g = el.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, HEIGHT)
    const x = (s: number) => (dur > 0 ? (s / dur) * width : 0)
    const accent = css('--accent', '#ff6a36')
    const muted = css('--text-muted', '#b9b4ad')
    const text = css('--text', '#f5f0e7')
    const playedX = x(Math.min(p.time, dur))

    if (loopActive(p.loop)) {
      g.fillStyle = 'rgba(255, 106, 54, 0.18)'
      g.fillRect(x(p.loop.a as number), 0, x(p.loop.b as number) - x(p.loop.a as number), HEIGHT)
    }
    const peaks = wave.key === key ? wave.peaks : null
    const mid = HEIGHT / 2
    if (peaks && peaks.length) {
      const step = width / peaks.length
      for (let i = 0; i < peaks.length; i++) {
        const px = i * step
        const h = Math.max(1, peaks[i] * (HEIGHT - 6))
        g.fillStyle = px < playedX ? accent : muted
        g.globalAlpha = px < playedX ? 0.95 : 0.55
        g.fillRect(px, mid - h / 2, Math.max(1, step - 0.5), h)
      }
      g.globalAlpha = 1
    } else {
      g.fillStyle = muted
      g.globalAlpha = 0.4
      g.fillRect(0, mid - 1, width, 2)
      g.globalAlpha = 1
    }
    if (beats && dur > 0) {
      const all = beatTimes(beats, 0, dur, 4000)
      const tight = all.length > 1 && x(all[1].t) - x(all[0].t) < 4 // too dense: bars only
      for (const b of all) {
        if (tight && !b.bar) continue
        g.fillStyle = b.bar ? text : muted
        g.fillRect(Math.round(x(b.t)), b.bar ? 0 : HEIGHT - 10, b.bar ? 2 : 1, b.bar ? HEIGHT : 10)
      }
    }
    g.fillStyle = text
    g.fillRect(Math.round(playedX) - 1, 0, 2, HEIGHT)
  }, [width, wave, key, p.time, p.loop, beats, dur])

  const seekAt = useCallback(
    (clientX: number) => {
      const el = canvas.current
      if (!el || !dur) return
      const r = el.getBoundingClientRect()
      p.seek(Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur)))
    },
    [dur, p],
  )

  async function save(next: Beats | null) {
    if (!t) return
    setMsg(null)
    try {
      if (next) {
        const saved = await api.saveTrackBeats(t.id, next)
        setBeats(saved)
        setBpmText(String(saved.bpm))
      } else {
        await api.clearTrackBeats(t.id)
        setBeats(null)
        setBpmText('')
        setTaps([])
      }
    } catch (e) {
      setMsg(e instanceof ApiFail ? e.message : 'Could not save the beat markers.')
    }
  }

  function tap() {
    const now = performance.now()
    const next = addTap(taps, now)
    setTaps(next)
    const bpm = tapTempo(next)
    if (bpm !== null) {
      setBpmText(String(bpm))
      void save({ bpm, offset: beats?.offset ?? 0 })
    }
  }

  function typedBpm() {
    const v = Number(bpmText)
    if (!bpmText.trim()) return
    if (!Number.isFinite(v) || v < MIN_BPM || v > MAX_BPM) {
      setMsg(`Tempo must be ${MIN_BPM} to ${MAX_BPM} BPM.`)
      return
    }
    if (v !== beats?.bpm) void save({ bpm: v, offset: beats?.offset ?? 0 })
  }

  function snapLoop() {
    if (!beats || !loopActive(p.loop)) return
    const a = nearestBeat(beats, p.loop.a as number)
    let b = nearestBeat(beats, p.loop.b as number)
    if (b <= a) b = Math.round((a + 60 / beats.bpm) * 1000) / 1000
    p.setLoop({ a, b: Math.min(b, dur || b) })
  }

  if (!t) return null
  const pos = beats ? barBeat(beats, p.time) : null
  const tapsLeft = Math.max(0, 3 - taps.length)

  return (
    <div className="pl-wave">
      <canvas
        ref={canvas}
        className="pl-wave-canvas"
        style={{ height: HEIGHT }}
        role="img"
        aria-label={
          wave.peaks ? 'Waveform of the track. Tap to jump there.' : 'Track timeline. Tap to jump.'
        }
        data-ready={wave.key === key && wave.peaks ? 'yes' : 'no'}
        onPointerDown={(e) => seekAt(e.clientX)}
      />
      {wave.key === key && wave.note && <p className="pl-wave-note">{wave.note}</p>}
      <div className="pl-beats" aria-label="Beat markers">
        <button
          className="pl-btn"
          onClick={tap}
          disabled={beatsFor !== t.id}
          aria-label="Tap tempo"
          title="Tap along with the beat"
        >
          👆 Tap
        </button>
        <label className="pl-bpm">
          BPM
          <input
            className="input"
            inputMode="decimal"
            aria-label="Tempo (BPM)"
            placeholder="—"
            value={bpmText}
            disabled={beatsFor !== t.id}
            onChange={(e) => {
              edited.current = true
              setBpmText(e.target.value)
            }}
            onBlur={typedBpm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </label>
        <button
          className="pl-btn"
          disabled={!beats}
          onClick={() => beats && save({ ...beats, offset: Math.max(0, p.time) })}
          aria-label="Set beat 1 here"
        >
          1 here
        </button>
        <button
          className="pl-btn"
          disabled={!beats || !loopActive(p.loop)}
          onClick={snapLoop}
          aria-label="Snap loop to the beat"
        >
          Snap loop
        </button>
        <button
          className="pl-btn"
          disabled={!beats}
          onClick={() => save(null)}
          aria-label="Clear beat markers"
        >
          ✕ beats
        </button>
        <span className="pl-beat-text" aria-live="polite">
          {taps.length > 0 && tapsLeft > 0
            ? `Keep tapping… (${tapsLeft} more)`
            : beats
              ? pos
                ? `${beats.bpm} BPM · bar ${pos.bar}, beat ${pos.beat}`
                : `${beats.bpm} BPM · beat 1 at ${formatTime(beats.offset)}`
              : 'Tap along to set the tempo.'}
        </span>
      </div>
      {msg && (
        <p className="pl-error" role="alert">
          {msg}
        </p>
      )}
    </div>
  )
}
