import { useState } from 'react'
import * as api from '../api'
import type { Dna } from '../types'
import { msg, useLoad, type CraftProps } from './shared'

export function DnaTab({ songId }: CraftProps) {
  const approved = useLoad(() => api.getDnaApproved(), [])
  const [profile, setProfile] = useState<Dna | null>(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const included = approved.data?.includes(songId) ?? false

  async function toggle() {
    setError('')
    try {
      if (included) await api.removeDna(songId)
      else await api.approveDna(songId)
      setProfile(null)
      await approved.reload()
    } catch (e) {
      setError(msg(e))
    }
  }
  async function show() {
    setError('')
    try {
      setProfile(await api.getDna())
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        Your writing habits, worked out on this computer from songs <strong>you approve</strong>.
        Only approve songs you wrote yourself. It is never stored as a file and is never sent to the
        AI.
      </p>
      <button className="btn" aria-pressed={included} onClick={() => void toggle()}>
        {included ? 'Remove this song from my style' : 'Include this song in my style'}
      </button>
      <p className="muted">
        {approved.data
          ? `${approved.data.length} song${approved.data.length === 1 ? '' : 's'} included.`
          : ''}
      </p>
      <div className="actions">
        <button className="btn btn-primary" onClick={() => void show()}>
          Show my style
        </button>
        {!confirm ? (
          <button
            className="btn btn-ghost"
            disabled={!approved.data?.length}
            onClick={() => setConfirm(true)}
          >
            Forget everything…
          </button>
        ) : (
          <>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirm(false)
                void api.clearDna().then(() => {
                  setProfile(null)
                  return approved.reload()
                })
              }}
            >
              Yes, forget all
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="ai-err" role="alert">
          {error}
        </p>
      )}
      {profile?.empty && <p className="muted">Nothing yet. Include a song first.</p>}
      {profile && !profile.empty && (
        <div className="ai-results" aria-label="My style">
          <p>
            {profile.lines} lines from {profile.songs.map((s) => s.title || 'Untitled').join(', ')}
          </p>
          <ul>
            <li>
              Average line: about {profile.avg_syllables_per_line} syllables,{' '}
              {profile.avg_words_per_line} words
            </li>
            <li>
              Lines ending on a rhyme:{' '}
              {profile.end_rhyme_share === null
                ? '–'
                : `${Math.round(profile.end_rhyme_share * 100)}%`}
            </li>
            <li>
              Word variety:{' '}
              {profile.vocabulary_variety === null
                ? '–'
                : `${Math.round(profile.vocabulary_variety * 100)}% different words`}
            </li>
          </ul>
          {profile.favourite_words.length > 0 && (
            <p>
              <strong>Words you return to:</strong>{' '}
              {profile.favourite_words.map((w) => `${w.word} (${w.count})`).join(', ')}
            </p>
          )}
          {profile.common_openers.length > 0 && (
            <p>
              <strong>How your lines often start:</strong>{' '}
              {profile.common_openers.map((w) => `${w.word} (${w.count})`).join(', ')}
            </p>
          )}
          {profile.rhyme_sounds.length > 0 && (
            <p>
              <strong>Rhyme sounds you use most:</strong>{' '}
              {profile.rhyme_sounds.map((s) => `${s.sound} (${s.uses})`).join(', ')}
            </p>
          )}
          <p className="muted ai-note">{profile.note}</p>
        </div>
      )}
    </div>
  )
}
