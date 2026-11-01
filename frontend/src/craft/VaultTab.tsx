import { useState } from 'react'
import * as api from '../api'
import { VAULT_KINDS } from '../types'
import { msg, useLoad, type CraftProps } from './shared'

export function VaultTab({ activeLine, onInsert }: CraftProps) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<string>('punchline')
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const items = useLoad(() => api.listCraft(null, undefined, q), [q])

  async function save(t: string) {
    setError('')
    try {
      await api.addCraft({
        song_id: null,
        kind,
        text: t,
        tags: tags
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      })
      setText('')
      await items.reload()
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        Your reusable punchlines, hooks and bars. Inserting adds a <strong>copy</strong>; the
        original stays here.
      </p>
      <div className="actions">
        <select
          className="input input-sm"
          aria-label="Vault type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {VAULT_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input
          className="input"
          aria-label="Vault text"
          maxLength={1000}
          placeholder="Write one…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <input
        className="input"
        aria-label="Tags (comma separated)"
        placeholder="tags, comma separated"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <div className="actions">
        <button className="btn" disabled={!text.trim()} onClick={() => void save(text)}>
          Save to vault
        </button>
        <button
          className="btn btn-ghost"
          disabled={!activeLine?.text.trim()}
          onClick={() => activeLine && void save(activeLine.text)}
        >
          Save current line
        </button>
      </div>
      {error && (
        <p className="ai-err" role="alert">
          {error}
        </p>
      )}
      <input
        className="input"
        aria-label="Search vault"
        placeholder="Search text or tags"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {items.data?.length === 0 && (
        <p className="muted">{q ? 'Nothing matches.' : 'The vault is empty.'}</p>
      )}
      {items.data?.map((i) => (
        <div key={i.id} className="ai-card">
          <p className="ai-text">{i.text}</p>
          <p className="ai-meta">
            <span className="ai-tag">{i.kind}</span>
            {i.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </p>
          <div className="actions">
            <button
              className="btn"
              onClick={() => onInsert(i.text.split('\n')[0], activeLine?.id ?? null)}
            >
              Insert copy below
            </button>
            <button
              className="btn btn-ghost"
              aria-label={`Delete ${i.text}`}
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
