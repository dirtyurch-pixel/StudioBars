import { useContext, useEffect, useRef, useState } from 'react'
import { PlayerContext } from '../music/playerContext'
import { loopActive } from '../music/logic'
import type { Content } from '../types'

const SPEEDS = [
  { id: 0, label: 'Off' },
  { id: 18, label: 'Slow' },
  { id: 32, label: 'Medium' },
  { id: 52, label: 'Fast' },
] as const
const SIZES = [22, 26, 30, 36, 42]

/**
 * Performance mode: big, wrapping lyrics for rehearsing. Pick one section or the whole song, auto-scroll at an
 * easy speed, play or pause the beat and switch its A–B loop on and off, without leaving the screen.
 * The screen is kept awake where the browser allows it.
 */
export function PerformView({
  title,
  content,
  startSectionId,
  onClose,
}: {
  title: string
  content: Content
  startSectionId: string
  onClose: () => void
}) {
  const player = useContext(PlayerContext)
  const [only, setOnly] = useState<string | null>(startSectionId)
  const [size, setSize] = useState(() => {
    try {
      return Number(localStorage.getItem('sb-perform-size')) || 30
    } catch {
      return 30
    }
  })
  const [speed, setSpeed] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const savedLoop = useRef(player?.loop ?? { a: null, b: null })

  // keep the screen on while rehearsing
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
    }
    nav.wakeLock?.request('screen').then(
      (l) => (lock = l),
      () => undefined,
    )
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      void lock?.release().catch(() => undefined)
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // gentle auto-scroll (pixels per second)
  useEffect(() => {
    if (!speed) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const el = box.current
      if (el) el.scrollTop += (speed * (now - last)) / 1000
      last = now
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [speed])

  useEffect(() => {
    try {
      localStorage.setItem('sb-perform-size', String(size))
    } catch {
      /* not remembered */
    }
  }, [size])

  const shown = only ? content.filter((s) => s.id === only) : content
  const loopOn = player ? loopActive(player.loop) : false
  const hasLoop = loopOn || loopActive(savedLoop.current)

  return (
    <div className="perform" role="dialog" aria-modal="true" aria-label="Performance mode">
      <div className="perform-top">
        <button className="icon-btn" onClick={onClose} aria-label="Leave performance mode">
          ✕
        </button>
        <b className="perform-title">{title}</b>
        <button
          className="icon-btn"
          onClick={() => setSize((v) => SIZES[Math.max(0, SIZES.indexOf(v) - 1)] ?? 22)}
          aria-label="Smaller text"
        >
          A−
        </button>
        <button
          className="icon-btn"
          onClick={() =>
            setSize((v) => SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(v) + 1)] ?? 42)
          }
          aria-label="Bigger text"
        >
          A+
        </button>
      </div>
      <div className="perform-sections" role="group" aria-label="What to show">
        <button className={`chip${only === null ? ' on' : ''}`} onClick={() => setOnly(null)}>
          Whole song
        </button>
        {content.map((s) => (
          <button
            key={s.id}
            className={`chip${only === s.id ? ' on' : ''}`}
            aria-pressed={only === s.id}
            onClick={() => {
              setOnly(s.id)
              box.current?.scrollTo({ top: 0 })
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="perform-lyrics" ref={box} style={{ fontSize: size }}>
        {shown.map((s) => (
          <section key={s.id} aria-label={s.label}>
            {(!only || content.length > 1) && <h3>{s.label}</h3>}
            {s.lines
              .filter((l) => l.text.trim())
              .map((l) => (
                <p key={l.id}>{l.text}</p>
              ))}
            {!s.lines.some((l) => l.text.trim()) && <p className="muted">(no lines yet)</p>}
          </section>
        ))}
        <div className="perform-end" aria-hidden="true" />
      </div>
      <div className="perform-bar">
        {player?.track ? (
          <>
            <button
              className="btn btn-primary perform-play"
              onClick={player.toggle}
              aria-label={player.playing ? 'Pause music' : 'Play music'}
            >
              {player.playing ? '⏸' : '▶'}
            </button>
            <button
              className={`btn${loopOn ? ' btn-primary' : ''}`}
              disabled={!hasLoop}
              aria-pressed={loopOn}
              title={
                hasLoop
                  ? 'Repeat the A–B part of the beat'
                  : 'Set A and B in the music player first'
              }
              onClick={() => {
                if (loopOn) {
                  savedLoop.current = player.loop
                  player.clearLoop()
                } else if (loopActive(savedLoop.current)) player.setLoop(savedLoop.current)
              }}
            >
              Loop A–B
            </button>
          </>
        ) : (
          <span className="muted perform-hint">
            Load a beat with ♪ Library to rehearse over it.
          </span>
        )}
        <span className="perform-speed" role="group" aria-label="Auto-scroll">
          Scroll
          {SPEEDS.map((sp) => (
            <button
              key={sp.id}
              className={`chip${speed === sp.id ? ' on' : ''}`}
              aria-pressed={speed === sp.id}
              onClick={() => setSpeed(sp.id)}
            >
              {sp.label}
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}
