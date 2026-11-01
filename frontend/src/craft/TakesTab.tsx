import { useState } from 'react'
import * as api from '../api'
import { msg, useLoad, type CraftProps } from './shared'

export function TakesTab({ songId, activeLine, onReplace }: CraftProps) {
  const lineId = activeLine?.id ?? ''
  const takes = useLoad(
    () => (lineId ? api.listTakes(songId, lineId) : Promise.resolve([])),
    [songId, lineId],
  )
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  if (!activeLine) return <p className="muted">Click a line to keep alternative versions of it.</p>

  async function add(t: string) {
    setError('')
    try {
      await api.addTake(songId, lineId, t)
      setText('')
      await takes.reload()
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        Line {activeLine.number}
        {activeLine.locked ? ' (locked)' : ''}: “{activeLine.text || '(empty)'}”. Takes are saved
        versions you can compare. Your lyric only changes when you press Use.
      </p>
      <div className="actions">
        <input
          className="input"
          aria-label="New take"
          maxLength={500}
          placeholder="Another way to say it…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" disabled={!text.trim()} onClick={() => void add(text)}>
          Add take
        </button>
      </div>
      <button
        className="btn btn-ghost"
        disabled={!activeLine.text.trim()}
        onClick={() => void add(activeLine.text)}
      >
        Keep the current line as a take
      </button>
      {error && (
        <p className="ai-err" role="alert">
          {error}
        </p>
      )}
      {takes.data?.length === 0 && <p className="muted">No takes for this line yet.</p>}
      {takes.data?.map((t) => (
        <div key={t.id} className="ai-card">
          <p className="ai-text">{t.text}</p>
          {t.text === activeLine.text && (
            <p className="muted ai-reason">This is what the line says now.</p>
          )}
          <div className="actions">
            <button
              className="btn btn-ghost"
              aria-pressed={t.favourite}
              aria-label={`${t.favourite ? 'Unfavourite' : 'Favourite'} ${t.text}`}
              onClick={() => void api.setTakeFavourite(t.id, !t.favourite).then(takes.reload)}
            >
              {t.favourite ? '★' : '☆'}
            </button>
            {activeLine.locked ? (
              <span className="muted">Unlock the line to use a take.</span>
            ) : confirm === t.id ? (
              <>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirm(null)
                    onReplace(activeLine.id, t.text)
                  }}
                >
                  Yes, use this take
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
                  Keep mine
                </button>
              </>
            ) : (
              <button
                className="btn"
                disabled={t.text === activeLine.text}
                onClick={() => setConfirm(t.id)}
              >
                Use this take…
              </button>
            )}
            <button
              className="btn btn-ghost"
              aria-label={`Delete take ${t.text}`}
              onClick={() => void api.deleteTake(t.id).then(takes.reload)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
