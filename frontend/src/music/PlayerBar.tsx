import { useEffect, useRef, useState } from 'react'
import { SPEEDS, formatTime, loopActive } from './logic'
import { usePlayer } from './playerContext'

const TEXT_FIELD =
  'input[data-line-input], textarea, input:not([type]), input[type="text"], input[type="search"]'

export function PlayerBar() {
  const p = usePlayer()
  const ref = useRef<HTMLElement>(null)
  const [typing, setTyping] = useState(false)

  // On a phone, shrink to the essentials while a text field has the keyboard open.
  useEffect(() => {
    const small = window.matchMedia?.('(max-width: 860px)')
    const on = (e: FocusEvent) =>
      setTyping(!!small?.matches && !!(e.target as HTMLElement)?.matches?.(TEXT_FIELD))
    const off = () => setTyping(false)
    document.addEventListener('focusin', on)
    document.addEventListener('focusout', off)
    return () => {
      document.removeEventListener('focusin', on)
      document.removeEventListener('focusout', off)
    }
  }, [])

  // Tell the page how tall the bar is so nothing hides behind it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () =>
      document.documentElement.style.setProperty('--player-h', `${el.offsetHeight}px`)
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
      className={`player${typing ? ' compact' : ''}`}
      aria-label="Music player"
      // keep the keyboard and text cursor where they are when a transport button is pressed
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
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
