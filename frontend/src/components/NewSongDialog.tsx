import { useState, type FormEvent } from 'react'
import { ApiFail, createSong } from '../api'
import type { Genre } from '../types'
import { GenrePicker } from './GenrePicker'
import { Modal } from './Modal'

export function NewSongDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [genres, setGenres] = useState<Genre[]>([])
  const [bpm, setBpm] = useState('')
  const [sig, setSig] = useState('')
  const [template, setTemplate] = useState<'blank' | 'verse-chorus'>('blank')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const n = bpm.trim() === '' ? null : Number(bpm)
    if (n !== null && (!Number.isInteger(n) || n < 30 || n > 300)) {
      setError('BPM must be a whole number from 30 to 300, or left empty.')
      return
    }
    setBusy(true)
    try {
      const song = await createSong({
        title: title.trim(),
        genres,
        bpm: n,
        time_signature: sig || null,
        template,
      })
      onCreated(song.id)
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Modal title="New song" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label htmlFor="ns-title">Title</label>
        <input
          id="ns-title"
          className="input"
          value={title}
          maxLength={200}
          autoFocus
          required
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="label">Genres (pick any, or none yet)</span>
        <GenrePicker value={genres} onChange={setGenres} />
        <div className="row2">
          <div>
            <label htmlFor="ns-bpm">BPM (optional)</label>
            <input
              id="ns-bpm"
              className="input"
              inputMode="numeric"
              value={bpm}
              onChange={(e) => setBpm(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </div>
          <div>
            <label htmlFor="ns-sig">Time signature (optional)</label>
            <select
              id="ns-sig"
              className="input"
              value={sig}
              onChange={(e) => setSig(e.target.value)}
            >
              <option value="">Not set</option>
              {['4/4', '3/4', '6/8', '12/8', '2/4'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <label htmlFor="ns-tpl">Start with</label>
        <select
          id="ns-tpl"
          className="input"
          value={template}
          onChange={(e) => setTemplate(e.target.value as 'blank' | 'verse-chorus')}
        >
          <option value="blank">A blank verse</option>
          <option value="verse-chorus">Verse, Chorus, Verse, Bridge</option>
        </select>
        <p className="hint">Sections can be added, renamed, reordered or removed any time.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'Create song'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
