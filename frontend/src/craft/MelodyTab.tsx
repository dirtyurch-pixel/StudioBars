import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import {
  fitReport,
  framesToNotes,
  detectPitch,
  freqToMidi,
  midiName,
  midiToFreq,
  type Frame,
} from '../melody/pitch'
import type { MelodySketch } from '../types'
import { msg, recordingSupported, useLoad, type CraftProps } from './shared'

type Note = MelodySketch['notes'][number]
const LENGTHS = [1, 2, 4, 8]
const MAX_HUM_SECONDS = 20

export function MelodyTab({ songId, sectionLines, bpm }: CraftProps) {
  const tempo = bpm && bpm >= 40 && bpm <= 240 ? bpm : 90
  const saved = useLoad(() => api.getMelody(songId), [songId])
  const [notes, setNotes] = useState<Note[]>([])
  const [chords, setChords] = useState<Record<string, string>>({})
  const [bars, setBars] = useState(2)
  const [len, setLen] = useState(2)
  const [status, setStatus] = useState('')
  const [fit, setFit] = useState('')
  const [playing, setPlaying] = useState(false)
  const [humming, setHumming] = useState(false)
  const audio = useRef<AudioContext | null>(null)
  const hum = useRef<{
    stream: MediaStream
    ctx: AudioContext
    timer: number
    frames: Frame[]
    t0: number
  } | null>(null)

  useEffect(() => {
    if (!saved.data) return
    setNotes(saved.data.notes)
    setChords(saved.data.chords)
    const last = Math.max(
      0,
      ...saved.data.notes.map((n) => Math.ceil((n.start16 + n.len16) / 16)),
      ...Object.keys(saved.data.chords).map((k) => Number(k) + 1),
    )
    setBars(Math.max(2, Math.min(8, last)))
  }, [saved.data])
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => undefined)
      if (hum.current) {
        window.clearInterval(hum.current.timer)
        hum.current.stream.getTracks().forEach((t) => t.stop())
      }
    },
    [],
  )

  const low = Math.min(48, ...notes.map((n) => n.midi)) // C3 upward by default
  const high = Math.max(72, ...notes.map((n) => n.midi)) // up to C5
  const rows: number[] = []
  for (let m = high; m >= low; m--) rows.push(m)
  const cols = bars * 16

  const noteAt = (step: number, midi: number) =>
    notes.find((n) => n.midi === midi && step >= n.start16 && step < n.start16 + n.len16)
  function toggle(step: number, midi: number) {
    setStatus('')
    const hit = noteAt(step, midi)
    if (hit) return setNotes(notes.filter((n) => n !== hit))
    const room = Math.min(len, cols - step)
    // do not run into a note of the same pitch that starts later
    const next = notes.filter((n) => n.midi === midi && n.start16 > step).map((n) => n.start16)
    const l = Math.max(1, Math.min(room, ...next.map((x) => x - step)))
    setNotes(
      [...notes, { start16: step, len16: l, midi }].sort(
        (a, b) => a.start16 - b.start16 || a.midi - b.midi,
      ),
    )
    beep(midi, 0.25)
  }

  function ctxGet() {
    if (!audio.current || audio.current.state === 'closed') audio.current = new AudioContext()
    return audio.current
  }
  function beep(midi: number, dur: number, at = 0) {
    try {
      const c = ctxGet()
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'triangle'
      o.frequency.value = midiToFreq(midi)
      const t = c.currentTime + at
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, dur))
      o.connect(g).connect(c.destination)
      o.start(t)
      o.stop(t + dur + 0.05)
    } catch {
      /* no audio available */
    }
  }
  function play() {
    const sixteenth = 60 / tempo / 4
    notes.forEach((n) => beep(n.midi, n.len16 * sixteenth * 0.95, 0.1 + n.start16 * sixteenth))
    setPlaying(true)
    const end = Math.max(0, ...notes.map((n) => n.start16 + n.len16)) * sixteenth
    window.setTimeout(() => setPlaying(false), (end + 0.3) * 1000)
  }

  async function save() {
    try {
      const r = await api.putMelody(songId, { notes, chords })
      setNotes(r.notes)
      setChords(r.chords)
      setStatus('Sketch saved. Your lyrics were not touched.')
    } catch (e) {
      setStatus(msg(e))
    }
  }

  async function startHum() {
    setStatus('')
    const sup = recordingSupported()
    if (!sup.ok) return setStatus(sup.why)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false },
      })
    } catch {
      return setStatus(
        'The microphone is blocked or missing. Allow it for this site and try again.',
      )
    }
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 4096
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    const frames: Frame[] = []
    const t0 = performance.now()
    const timer = window.setInterval(() => {
      an.getFloatTimeDomainData(buf)
      const f = detectPitch(buf, ctx.sampleRate)
      frames.push({ t: performance.now() - t0, midi: f ? freqToMidi(f) : null })
      if (performance.now() - t0 > MAX_HUM_SECONDS * 1000) stopHum()
    }, 30)
    hum.current = { stream, ctx, timer, frames, t0 }
    setHumming(true)
  }
  function stopHum() {
    const h = hum.current
    if (!h) return
    window.clearInterval(h.timer)
    h.stream.getTracks().forEach((t) => t.stop())
    void h.ctx.close().catch(() => undefined)
    hum.current = null
    setHumming(false)
    const found = framesToNotes(h.frames, tempo)
    if (found.length === 0)
      return setStatus(
        'No clear pitch was heard. Try humming one note at a time, close to the microphone.',
      )
    setNotes(found.map((n) => ({ ...n })))
    setBars(
      Math.max(2, Math.min(8, Math.ceil(Math.max(...found.map((n) => n.start16 + n.len16)) / 16))),
    )
    setStatus(
      `Found ${found.length} notes from your hum. They are a rough guide: fix them by hand, then press Save.`,
    )
  }

  async function checkFit() {
    const texts = sectionLines
      .map((l) => l.text)
      .filter((t) => t.trim())
      .slice(0, 24)
    try {
      const all = await Promise.all(texts.map((t) => api.getSyllables(t)))
      setFit(
        fitReport(
          all.reduce((a, r) => a + r.syllables.length, 0),
          notes.length,
        ),
      )
    } catch (e) {
      setFit(msg(e))
    }
  }

  const sup = recordingSupported()
  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        A rough sketch on a 16th-note grid at {tempo} BPM{bpm ? '' : ' (no BPM set, so 90)'}. It is
        a place to try ideas, not a finished score. Your lyrics are never changed here.
      </p>
      <div className="ai-two">
        <label className="ai-field">
          <span>New note length</span>
          <select className="input" value={len} onChange={(e) => setLen(Number(e.target.value))}>
            {LENGTHS.map((l) => (
              <option key={l} value={l}>
                {l === 1 ? '1/16' : l === 2 ? '1/8' : l === 4 ? '1/4' : '1/2'}
              </option>
            ))}
          </select>
        </label>
        <label className="ai-field">
          <span>Bars</span>
          <select className="input" value={bars} onChange={(e) => setBars(Number(e.target.value))}>
            {[2, 4, 6, 8].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mel-wrap" role="group" aria-label="Melody grid">
        <div
          className="mel-chords"
          style={{ gridTemplateColumns: `repeat(${bars}, minmax(112px, 1fr))` }}
        >
          {Array.from({ length: bars }, (_, b) => (
            <input
              key={b}
              className="input input-sm"
              aria-label={`Chord for bar ${b + 1}`}
              placeholder={`Bar ${b + 1}`}
              maxLength={12}
              value={chords[String(b)] ?? ''}
              onChange={(e) => {
                setStatus('')
                setChords({ ...chords, [String(b)]: e.target.value })
              }}
            />
          ))}
        </div>
        <div className="mel-grid" style={{ gridTemplateColumns: `34px repeat(${cols}, 28px)` }}>
          {rows.map((m) => (
            <MelRow key={m} midi={m} cols={cols} noteAt={noteAt} onCell={toggle} />
          ))}
        </div>
      </div>

      <div className="actions">
        <button className="btn" disabled={notes.length === 0 || playing} onClick={play}>
          {playing ? 'Playing…' : '▶ Play sketch'}
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Save sketch
        </button>
        <button
          className="btn btn-ghost"
          disabled={notes.length === 0}
          onClick={() => setNotes([])}
        >
          Clear notes
        </button>
      </div>
      <div className="actions">
        {!humming ? (
          <button className="btn" disabled={!sup.ok} onClick={() => void startHum()}>
            🎤 Hum a melody
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stopHum}>
            ■ Stop humming
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => void checkFit()}>
          Check lyric fit
        </button>
      </div>
      {!sup.ok && <p className="muted ai-note">{sup.why}</p>}
      {fit && <p role="status">{fit}</p>}
      {status && (
        <p className="ai-ok" role="status">
          {status}
        </p>
      )}
      <p className="muted ai-note">
        Humming turns one clear note at a time into a rough sketch (replacing the grid). It guesses
        the pitch, so check it by ear.
      </p>
    </div>
  )
}

function MelRow({
  midi,
  cols,
  noteAt,
  onCell,
}: {
  midi: number
  cols: number
  noteAt: (s: number, m: number) => Note | undefined
  onCell: (s: number, m: number) => void
}) {
  const black = [1, 3, 6, 8, 10].includes(midi % 12)
  return (
    <>
      <span className={`mel-label${black ? ' black' : ''}`}>{midiName(midi)}</span>
      {Array.from({ length: cols }, (_, s) => {
        const n = noteAt(s, midi)
        return (
          <button
            key={s}
            className={`mel-cell${n ? ' on' : ''}${s % 16 === 0 ? ' bar' : s % 4 === 0 ? ' beat' : ''}${n && n.start16 === s ? ' head' : ''}`}
            aria-label={`${midiName(midi)} step ${s + 1}${n ? ' note' : ''}`}
            aria-pressed={!!n}
            onClick={() => onCell(s, midi)}
          />
        )
      })}
    </>
  )
}
