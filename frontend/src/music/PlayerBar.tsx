import { useEffect, useRef, useState } from 'react'
import { SPEEDS, formatTime, loopActive } from './logic'
import { usePlayer } from './playerContext'
import { Waveform } from './Waveform'

const EXPAND_DELAY_MS = 450
const WAVE_PREF = 'sb-show-wave'

function initialWave(): boolean {
  try {
    const v = localStorage.getItem(WAVE_PREF)
    if (v !== null) return v === '1'
  } catch {
    /* storage blocked: fall back to the screen size */
  }
  return true // on phones it only shows in the full player, so it can be on by default
}
const TEXT_FIELD =
  'input[data-line-input], textarea, input:not([type]), input[type="text"], input[type="search"]'

export function PlayerBar() {
  const p = usePlayer()
  const ref = useRef<HTMLElement>(null)
  const [typing, setTyping] = useState(false)
  const [showWave, setShowWave] = useState(initialWave)
  // phones: a slim bar; the full player (waveform, loop, speed, library) opens as a full screen
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    document.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [expanded])
  useEffect(() => {
    const on = (e: Event) => setShowWave(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('sb-wave', on)
    return () => window.removeEventListener('sb-wave', on)
  }, [])
  const toggleWave = () =>
    setShowWave((v) => {
      try {
        localStorage.setItem(WAVE_PREF, v ? '0' : '1')
      } catch {
        /* not saved; fine */
      }
      return !v
    })

  // On a phone, shrink to the essentials while a text field has the keyboard open.
  // It grows back only after a short delay: a tap on a button takes focus away from the field
  // the instant the finger lands, and growing at that moment would slide the bar over the
  // button and lose the tap.
  useEffect(() => {
    const small = window.matchMedia?.('(max-width: 860px)')
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setTyping(false), EXPAND_DELAY_MS)
    }
    const on = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      // a box inside the player itself (the tempo box) must not hide the player
      if (small?.matches && el?.matches?.(TEXT_FIELD) && !ref.current?.contains(el)) {
        clearTimeout(timer)
        setTyping(true)
      } else later() // focus moved to a button or link: wait before growing, so the tap lands
    }
    const off = later
    document.addEventListener('focusin', on)
    document.addEventListener('focusout', off)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', on)
      document.removeEventListener('focusout', off)
    }
  }, [])

  // Tell the page how tall the bar is so nothing hides behind it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => {
      if (el.classList.contains('expanded')) return // full screen: keep the slim bar's height for the page
      document.documentElement.style.setProperty('--player-h', `${el.offsetHeight}px`)
    }
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--player-h')
    }
  }, [])

  const dur = p.duration ?? p.track?.duration ?? 0
  const pct = (s: number) => (dur > 0 ? Math.min(100, Math.max(0, (s / dur) * 100)) : 0)
  const hasLoop = loopActive(p.loop)

  return (
    <section
      ref={ref}
      className={`player${typing ? ' compact' : ''}${expanded ? ' expanded' : ''}`}
      aria-label="Music player"
      // keep the keyboard and text cursor where they are when a transport button is pressed
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
      {p.track && !expanded && (
        <span className="pl-progress" style={{ width: `${pct(p.time)}%` }} aria-hidden="true" />
      )}
      <div className="pl-sheet-head">
        <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close player">
          ⌄
        </button>
        <b>Now playing</b>
        <button
          className="btn btn-sm"
          onClick={() => {
            setExpanded(false)
            p.setDrawerOpen(true)
          }}
        >
          Library
        </button>
      </div>
      <div className="pl-main">
        <button className="pl-btn" aria-label="Previous track" onClick={p.prev} disabled={!p.track}>
          ⏮
        </button>
        <button
          className="pl-btn pl-play"
          aria-label={p.playing ? 'Pause' : 'Play'}
          onClick={p.toggle}
          disabled={!p.track || p.status === 'error'}
        >
          {p.playing ? '⏸' : '▶'}
        </button>
        <button className="pl-btn" aria-label="Next track" onClick={p.next} disabled={!p.track}>
          ⏭
        </button>
        <div className="pl-info" aria-live="polite">
          {p.track ? (
            <>
              <b className="pl-title">{p.track.title}</b>
              <small>
                {p.status === 'loading' ? 'Loading… ' : ''}
                {p.track.artist ? `${p.track.artist} · ` : ''}
                {p.queueLength > 1 ? `${p.queuePos + 1} of ${p.queueLength} · ` : ''}
                {formatTime(p.time)} / {formatTime(dur || null)}
              </small>
            </>
          ) : (
            <>
              <b className="pl-title">{p.libraryLoaded ? 'No music loaded' : 'Music'}</b>
              <small>
                {p.libraryError
                  ? 'Music library unavailable.'
                  : 'Import your own tracks to listen while you write.'}
              </small>
            </>
          )}
        </div>
        <button
          className="btn btn-ghost pl-lib"
          onClick={() => p.setDrawerOpen(!p.drawerOpen)}
          aria-expanded={p.drawerOpen}
          aria-label="Music library and playlists"
        >
          ♪ Library
        </button>
        {p.track && (
          <button
            className="icon-btn pl-expand"
            onClick={() => setExpanded(true)}
            aria-label="Open player"
            aria-expanded={expanded}
          >
            ⌃
          </button>
        )}
      </div>

      {p.error && (
        <p className="pl-error" role="alert">
          {p.error}
        </p>
      )}

      {p.track && (
        <div className="pl-seek">
          <span className="pl-time">{formatTime(p.time)}</span>
          <div className="pl-slider">
            {hasLoop && (
              <span
                className="pl-loop"
                style={{
                  left: `${pct(p.loop.a as number)}%`,
                  width: `${pct(p.loop.b as number) - pct(p.loop.a as number)}%`,
                }}
                aria-hidden="true"
              />
            )}
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={dur || 0}
              step={0.1}
              value={Math.min(p.time, dur || 0)}
              disabled={!dur || p.status === 'error'}
              aria-valuetext={`${formatTime(p.time)} of ${formatTime(dur || null)}`}
              onChange={(e) => p.seek(Number(e.target.value))}
            />
          </div>
          <span className="pl-time">{formatTime(dur || null)}</span>
        </div>
      )}

      {p.track && showWave && <Waveform />}

      {p.track && (
        <div className="pl-extra">
          <button
            className="pl-btn"
            aria-label={p.muted ? 'Unmute' : 'Mute'}
            onClick={p.toggleMute}
          >
            {p.muted || p.volume === 0 ? '🔇' : '🔊'}
          </button>
          <input
            className="pl-vol"
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={p.muted ? 0 : p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
          />
          <button
            className={`pl-btn${p.shuffle ? ' on' : ''}`}
            aria-label="Shuffle"
            aria-pressed={p.shuffle}
            onClick={p.toggleShuffle}
          >
            🔀
          </button>
          <button
            className={`pl-btn${p.repeat !== 'off' ? ' on' : ''}`}
            aria-label={`Repeat: ${p.repeat}`}
            onClick={p.cycleRepeat}
          >
            {p.repeat === 'one' ? '🔂' : '🔁'}
            <small>{p.repeat === 'off' ? 'off' : p.repeat}</small>
          </button>
          <button
            className={`pl-btn${showWave ? ' on' : ''}`}
            aria-label="Show waveform and beats"
            aria-pressed={showWave}
            onClick={toggleWave}
          >
            〰 <small>wave</small>
          </button>
          <span className="pl-sep" aria-hidden="true" />
          <button
            className={`pl-btn pl-ab${p.loop.a !== null ? ' on' : ''}`}
            aria-label="Set loop start (A) here"
            onClick={p.markA}
          >
            A
          </button>
          <button
            className={`pl-btn pl-ab${p.loop.b !== null ? ' on' : ''}`}
            aria-label="Set loop end (B) here"
            onClick={p.markB}
          >
            B
          </button>
          <button
            className="pl-btn"
            aria-label="Clear loop"
            onClick={p.clearLoop}
            disabled={p.loop.a === null && p.loop.b === null}
          >
            ✕ loop
          </button>
          <span className="pl-loop-text" aria-live="polite">
            {hasLoop
              ? `Looping ${formatTime(p.loop.a)}–${formatTime(p.loop.b)}`
              : p.loop.a !== null || p.loop.b !== null
                ? `A ${formatTime(p.loop.a)} · B ${formatTime(p.loop.b)} (set both)`
                : ''}
          </span>
          <label className="pl-speed">
            Speed
            <select
              aria-label="Playback speed"
              value={p.speed}
              onChange={(e) => p.setSpeed(Number(e.target.value))}
              disabled={!p.pitchSupported}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
              {!(SPEEDS as readonly number[]).includes(p.speed) && (
                <option value={p.speed}>{p.speed}×</option>
              )}
            </select>
          </label>
        </div>
      )}
      {p.loopError && (
        <p className="pl-error" role="alert">
          {p.loopError}
        </p>
      )}
      {p.track && !p.pitchSupported && (
        <p className="pl-error">
          This browser cannot keep the pitch steady when the speed changes, so the speed control is
          switched off.
        </p>
      )}
    </section>
  )
}
