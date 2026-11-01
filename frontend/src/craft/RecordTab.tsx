import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { usePlayer } from '../music/playerContext'
import { msg, recordingSupported, useLoad, type CraftProps } from './shared'

const MAX_SECONDS = 600

const fmt = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function RecordTab({ songId }: CraftProps) {
  const player = usePlayer()
  const takes = useLoad(() => api.listVocals(songId), [songId])
  const support = recordingSupported()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [withBeat, setWithBeat] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const rec = useRef<{
    r: MediaRecorder
    stream: MediaStream
    chunks: Blob[]
    t0: number
    offset: number
  } | null>(null)
  const timer = useRef<number | null>(null)
  const timeRef = useRef(player.time)
  timeRef.current = player.time

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current)
      rec.current?.stream.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  async function start() {
    setError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'The microphone is blocked. Allow it for this site in your browser settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : 'Could not start the microphone.',
      )
      return
    }
    const r = new MediaRecorder(stream)
    const chunks: Blob[] = []
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const offset = Math.round(timeRef.current * 1000)
    rec.current = { r, stream, chunks, t0: performance.now(), offset }
    r.start(1000)
    if (withBeat && player.track && !player.playing) player.toggle()
    setRecording(true)
    setElapsed(0)
    timer.current = window.setInterval(() => {
      const ms = performance.now() - (rec.current?.t0 ?? 0)
      setElapsed(ms)
      if (ms > MAX_SECONDS * 1000) void stop()
    }, 250)
  }

  async function stop() {
    const cur = rec.current
    if (!cur) return
    if (timer.current) window.clearInterval(timer.current)
    setRecording(false)
    setBusy(true)
    const done = new Promise<void>((res) => (cur.r.onstop = () => res()))
    if (cur.r.state !== 'inactive') cur.r.stop()
    await done
    cur.stream.getTracks().forEach((t) => t.stop())
    rec.current = null
    if (withBeat && player.playing) player.pause()
    const dur = performance.now() - cur.t0
    try {
      const blob = new Blob(cur.chunks, { type: cur.r.mimeType || 'audio/webm' })
      await api.uploadVocal(songId, blob, dur, cur.offset)
      await takes.reload()
    } catch (e) {
      setError(msg(e, 'Could not save the recording.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        Record a rough vocal against the song. Recordings stay on the computer running Studio Bars
        and are never sent anywhere. Timing is approximate: it notes where the music was when you
        pressed record, and you can nudge it.
      </p>
      {!support.ok ? (
        <p className="warn" role="status">
          {support.why}
        </p>
      ) : (
        <>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={withBeat}
              disabled={recording}
              onChange={(e) => setWithBeat(e.target.checked)}
            />
            <span>
              {player.track
                ? `Play “${player.track.title}” while I record`
                : 'No music is loaded (load a track to record over it)'}
            </span>
          </label>
          <div className="actions">
            {!recording ? (
              <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
                ● Record
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => void stop()}>
                ■ Stop and save ({fmt(elapsed)})
              </button>
            )}
            {busy && <span className="muted">Saving…</span>}
          </div>
          {withBeat && (
            <p className="muted ai-note">
              Use headphones so the music does not get into the recording.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="ai-err" role="alert">
          {error}
        </p>
      )}
      {takes.error && <p className="ai-err">{takes.error}</p>}
      {takes.data?.length === 0 && <p className="muted">No recordings yet.</p>}
      {takes.data?.map((t, i) => (
        <div key={t.id} className="ai-card">
          <p className="ai-text">
            Take {i + 1} · {fmt(t.duration_ms)}
          </p>
          {t.available ? (
            <audio
              controls
              preload="none"
              src={api.vocalUrl(t.id)}
              aria-label={`Playback of take ${i + 1}`}
            />
          ) : (
            <p className="ai-err">The recording file is missing from the media folder.</p>
          )}
          <TakeEdit take={t} onSaved={takes.reload} />
          <div className="actions">
            {confirmDel === t.id ? (
              <>
                <button
                  className="btn btn-danger"
                  onClick={() =>
                    void api.deleteVocal(t.id).then(() => {
                      setConfirmDel(null)
                      return takes.reload()
                    })
                  }
                >
                  Yes, delete take {i + 1}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmDel(t.id)}>
                Delete…
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function TakeEdit({
  take,
  onSaved,
}: {
  take: { id: string; note: string; offset_ms: number }
  onSaved: () => Promise<void>
}) {
  const [note, setNote] = useState(take.note)
  const [offset, setOffset] = useState(String(take.offset_ms))
  const [state, setState] = useState('')
  async function save() {
    const n = Number(offset)
    if (!Number.isFinite(n)) return setState('Offset must be a number.')
    try {
      await api.patchVocal(take.id, { note, offset_ms: Math.round(n) })
      setState('Saved.')
      await onSaved()
    } catch (e) {
      setState(msg(e))
    }
  }
  return (
    <div className="ai-two">
      <label className="ai-field">
        <span>Note</span>
        <input
          className="input"
          maxLength={200}
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            setState('')
          }}
        />
      </label>
      <label className="ai-field">
        <span>Starts at (ms into the music)</span>
        <input
          className="input"
          inputMode="numeric"
          value={offset}
          onChange={(e) => {
            setOffset(e.target.value)
            setState('')
          }}
        />
      </label>
      <button className="btn btn-ghost" onClick={() => void save()}>
        Save note and timing
      </button>
      {state && (
        <span className="muted" role="status">
          {state}
        </span>
      )}
    </div>
  )
}
