import { useEffect, useState } from 'react'
import * as api from '../api'
import { CONCEPT_KINDS, PLAN_LABELS, type Plan } from '../types'
import { msg, useLoad, type CraftProps } from './shared'

export function PlanTab({ songId }: CraftProps) {
  const plan = useLoad(() => api.getPlan(songId), [songId])
  const items = useLoad(() => api.listCraft(songId), [songId])
  const [draft, setDraft] = useState<Plan | null>(null)
  const [state, setState] = useState('')
  const [kind, setKind] = useState<string>('theme')
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (plan.data) setDraft(plan.data)
  }, [plan.data])

  async function save() {
    if (!draft) return
    try {
      await api.putPlan(songId, draft)
      setState('Saved.')
    } catch (e) {
      setState(msg(e))
    }
  }
  async function add() {
    setError('')
    try {
      await api.addCraft({ song_id: songId, kind, text, tags: [] })
      setText('')
      await items.reload()
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div className="ai-panel">
      <h4 className="ai-h">Story plan (advice only, nothing here changes your lyrics)</h4>
      {plan.error && <p className="ai-err">{plan.error}</p>}
      {draft &&
        PLAN_LABELS.map(([k, label]) => (
          <label key={k} className="ai-field">
            <span>{label}</span>
            <textarea
              className="input"
              rows={2}
              maxLength={1000}
              value={draft[k]}
              onChange={(e) => {
                setState('')
                setDraft({ ...draft, [k]: e.target.value })
              }}
            />
          </label>
        ))}
      <div className="actions">
        <button className="btn" onClick={() => void save()} disabled={!draft}>
          Save plan
        </button>
        {state && (
          <span className="muted" role="status">
            {state}
          </span>
        )}
      </div>

      <h4 className="ai-h">Idea board</h4>
      <div className="actions">
        <select
          className="input input-sm"
          aria-label="Idea type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {CONCEPT_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input
          className="input"
          aria-label="New idea"
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" disabled={!text.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
      {error && (
        <p className="ai-err" role="alert">
          {error}
        </p>
      )}
      {items.data?.length === 0 && (
        <p className="muted">No ideas yet: themes, characters, scenes, titles, moods.</p>
      )}
      {items.data?.map((i) => (
        <div key={i.id} className="ai-card">
          <p className="ai-text">{i.text}</p>
          <p className="ai-meta">
            <span className="ai-tag">{i.kind}</span>
          </p>
          <div className="actions">
            <button
              className="btn btn-ghost"
              aria-label={`Delete idea ${i.text}`}
              onClick={() => void api.deleteCraft(i.id).then(items.reload)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
