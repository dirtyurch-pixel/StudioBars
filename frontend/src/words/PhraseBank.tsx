import { useCallback, useEffect, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'
import { useToast } from '../components/toastContext'
import type { PhraseItem } from '../types'
import { HERE } from '../where'

const splitTags = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
const syl = (p: PhraseItem['pronunciation']) =>
  p.syllables_min === p.syllables_max
    ? `${p.syllables_min}`
    : `${p.syllables_min}–${p.syllables_max}`

type Draft = { phrase: string; meaning: string; sounds_like: string; tags: string }
const EMPTY: Draft = { phrase: '', meaning: '', sounds_like: '', tags: '' }

export function PhraseBank({
  onLookup,
  onPhraseRhymes,
}: {
  onLookup: (w: string) => void
  onPhraseRhymes: (p: string) => void
}) {
  const toast = useToast()
  const [items, setItems] = useState<PhraseItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [error, setError] = useState<ApiFail | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [res, t] = await Promise.all([api.listPhrases(q, tag), api.listPhraseTags()])
      setItems(res.items)
      setTotal(res.total)
      setTags(t)
    } catch (e) {
      setError(e instanceof ApiFail ? e : new ApiFail('Unexpected error.'))
    }
  }, [q, tag])

  useEffect(() => {
    const t = setTimeout(() => void load(), 200)
    return () => clearTimeout(t)
  }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const body = {
      phrase: draft.phrase,
      meaning: draft.meaning,
      sounds_like: draft.sounds_like,
      tags: splitTags(draft.tags),
    }
    try {
      if (editing) await api.updatePhrase(editing, body)
      else await api.createPhrase(body)
      setDraft(EMPTY)
      setEditing(null)
      setAdding(false)
      toast(editing ? 'Phrase updated.' : 'Added to your phrase bank.', 'success')
      await load()
    } catch (err) {
      setFormError(err instanceof ApiFail ? err.message : 'Could not save.')
    }
  }
  async function remove(id: string) {
    try {
      await api.deletePhrase(id)
      setConfirmDel(null)
      await load()
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not delete.', 'error')
    }
  }
  async function download() {
    try {
      const blob = await api.exportPhrases()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'studio-bars-phrases.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Export failed.', 'error')
    }
  }

  return (
    <div className="phrase-bank">
      <p className="hint">
        Your own phrases and slang: what they mean, how they sound, and tags. Stored only on {HERE}.
      </p>
      <div className="inline-form">
        <label htmlFor="phrase-search" className="sr">
          Search your phrases
        </label>
        <input
          id="phrase-search"
          className="input input-sm"
          type="search"
          placeholder="Search phrases, meanings, tags"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {!adding && !editing && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add phrase
          </button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by tag">
          <button
            className={`chip chip-btn${tag === '' ? ' on' : ''}`}
            aria-pressed={tag === ''}
            onClick={() => setTag('')}
          >
            All
          </button>
          {tags.map((t) => (
            <button
              key={t.tag}
              className={`chip chip-btn${tag === t.tag ? ' on' : ''}`}
              aria-pressed={tag === t.tag}
              onClick={() => setTag(tag === t.tag ? '' : t.tag)}
            >
              {t.tag} ({t.count})
            </button>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <form
          className="card form"
          onSubmit={save}
          aria-label={editing ? 'Edit phrase' : 'Add phrase'}
        >
          <label htmlFor="ph-phrase">Phrase or slang word</label>
          <input
            id="ph-phrase"
            className="input"
            value={draft.phrase}
            maxLength={120}
            required
            autoFocus
            onChange={(e) => setDraft({ ...draft, phrase: e.target.value })}
          />
          <label htmlFor="ph-meaning">What it means</label>
          <textarea
            id="ph-meaning"
            className="input"
            rows={2}
            value={draft.meaning}
            maxLength={500}
            onChange={(e) => setDraft({ ...draft, meaning: e.target.value })}
          />
          <label htmlFor="ph-sounds">How it sounds: “sounds like…” (optional)</label>
          <input
            id="ph-sounds"
            className="input"
            value={draft.sounds_like}
            maxLength={120}
            placeholder="e.g. finer"
            onChange={(e) => setDraft({ ...draft, sounds_like: e.target.value })}
          />
          <label htmlFor="ph-tags">Tags, separated by commas (optional)</label>
          <input
            id="ph-tags"
            className="input"
            value={draft.tags}
            placeholder="slang, south, hook"
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
          {formError && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false)
                setEditing(null)
                setDraft(EMPTY)
                setFormError('')
              }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!draft.phrase.trim()}>
              {editing ? 'Save changes' : 'Add to my phrases'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="state state-error" role="alert">
          <p>{error.network ? 'Cannot reach the Studio Bars server.' : error.message}</p>
          <button className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {items === null && !error && (
        <p className="hint" role="status">
          Loading…
        </p>
      )}
      {items?.length === 0 && !error && (
        <p className="hint">
          {q || tag
            ? 'No phrases match.'
            : 'Nothing here yet. Add your first phrase or slang word.'}
        </p>
      )}
      <ul className="notes phrase-list">
        {items?.map((p) => (
          <li key={p.id}>
            <div className="phrase-main">
              <b>{p.phrase}</b>
              {p.meaning && <span>{p.meaning}</span>}
              <small>
                {p.pronunciation.known || p.pronunciation.syllables_min > 0 ? (
                  <>
                    {syl(p.pronunciation)} syllables
                    {p.pronunciation.ipa && (
                      <>
                        {' '}
                        · <span className="ipa">/{p.pronunciation.ipa}/</span>
                      </>
                    )}
                  </>
                ) : null}
                {p.sounds_like && <> · sounds like “{p.sounds_like}”</>}
              </small>
              {p.pronunciation.unknown_words.length > 0 && (
                <small className="warn">
                  Not sure how to say: {p.pronunciation.unknown_words.join(', ')}. Add a “sounds
                  like…” so counts and rhymes work.
                </small>
              )}
              {p.tags.length > 0 && <small>{p.tags.map((t) => `#${t}`).join(' ')}</small>}
            </div>
            <div className="actions">
              {!p.phrase.includes(' ') && (
                <button className="btn btn-ghost" onClick={() => onLookup(p.phrase)}>
                  Meaning
                </button>
              )}
              <button
                className="btn btn-ghost"
                onClick={() => onPhraseRhymes(p.sounds_like || p.phrase)}
                title="Experimental"
              >
                Rhymes
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(p.id)
                  setAdding(false)
                  setDraft({
                    phrase: p.phrase,
                    meaning: p.meaning,
                    sounds_like: p.sounds_like,
                    tags: p.tags.join(', '),
                  })
                }}
              >
                Edit
              </button>
              {confirmDel === p.id ? (
                <span className="confirm">
                  Delete?
                  <button className="btn btn-danger" onClick={() => void remove(p.id)}>
                    Yes
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>
                    No
                  </button>
                </span>
              ) : (
                <button
                  className="btn btn-ghost"
                  aria-label={`Delete ${p.phrase}`}
                  onClick={() => setConfirmDel(p.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="actions">
        <small className="hint">
          {total} phrase{total === 1 ? '' : 's'}
        </small>
        {total > 0 && (
          <button className="btn btn-ghost" onClick={() => void download()}>
            Export as a file
          </button>
        )}
      </div>
    </div>
  )
}
