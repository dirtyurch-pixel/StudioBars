import { useCallback, useEffect, useState } from 'react'
import { ApiFail, LOCAL, deleteSong, listSongs, undeleteSong } from '../api'
import { ImportDialog } from '../components/ImportDialog'
import { NewSongDialog } from '../components/NewSongDialog'
import { PhoneBackup } from '../local/PhoneBackup'
import { useToast } from '../components/toastContext'
import { goSettings, goSong } from '../route'
import { ago } from '../time'
import { GENRES, type SongSummary } from '../types'

const genreLabel = (id: string) => GENRES.find((g) => g.id === id)?.label ?? id

export default function Dashboard() {
  const toast = useToast()
  const [songs, setSongs] = useState<SongSummary[] | null>(null)
  const [trash, setTrash] = useState<SongSummary[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [error, setError] = useState<ApiFail | null>(null)
  const [dialog, setDialog] = useState<'new' | 'import' | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [a, b] = await Promise.all([listSongs(false), listSongs(true)])
      setSongs(a)
      setTrash(b)
    } catch (e) {
      setError(e instanceof ApiFail ? e : new ApiFail('Unexpected error.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(id: string) {
    try {
      await deleteSong(id)
      setConfirmId(null)
      toast('Moved to trash. You can restore it below.', 'success')
      await load()
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not delete.', 'error')
    }
  }

  async function restore(id: string) {
    try {
      await undeleteSong(id)
      toast('Song restored.', 'success')
      await load()
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not restore.', 'error')
    }
  }

  return (
    <main className="page">
      <header className="dash-head">
        <div>
          <h1 className="brand">
            <i /> Studio Bars
          </h1>
          <p className="hint">My songs</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={goSettings} aria-label="Settings">
            ⚙ Settings
          </button>
          <button className="btn" onClick={() => setDialog('import')}>
            Import
          </button>
          <button className="btn btn-primary" onClick={() => setDialog('new')}>
            + New song
          </button>
        </div>
      </header>

      {LOCAL && <PhoneBackup onRestored={() => void load()} />}
      {error && (
        <div className="state state-error" role="alert">
          <p>
            {error.network
              ? 'Cannot reach the Studio Bars server. Is it running? Start it with scripts/dev.sh or scripts/dev.ps1.'
              : error.message}
          </p>
          <button className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!error && songs === null && (
        <p className="state" role="status">
          Loading your songs…
        </p>
      )}
      {!error && songs?.length === 0 && (
        <div className="state">
          <h2>No songs yet</h2>
          <p>Start a new song, or import lyrics you already have.</p>
          <button className="btn btn-primary" onClick={() => setDialog('new')}>
            + New song
          </button>
        </div>
      )}

      <ul className="song-list">
        {songs?.map((s) => (
          <li key={s.id} className="song-card">
            <button className="song-open" onClick={() => goSong(s.id)}>
              <span className="song-title">{s.title}</span>
              <span className="song-meta">
                {s.genres.map(genreLabel).join(' · ') || 'No genre'}
                {s.bpm ? ` · ${s.bpm} BPM` : ''} · {s.line_count} lines
                {s.locked_count ? ` · 🔒 ${s.locked_count}` : ''} · {ago(s.updated_at)}
              </span>
            </button>
            {confirmId === s.id ? (
              <span className="confirm" role="group" aria-label={`Delete ${s.title}?`}>
                Move to trash?
                <button className="btn btn-danger" onClick={() => void remove(s.id)}>
                  Yes, delete
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmId(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="btn btn-ghost"
                aria-label={`Delete ${s.title}`}
                onClick={() => setConfirmId(s.id)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {trash.length > 0 && (
        <section className="trash">
          <button className="btn btn-ghost" onClick={() => setShowTrash((v) => !v)}>
            {showTrash ? 'Hide' : 'Show'} trash ({trash.length})
          </button>
          {showTrash && (
            <ul className="song-list">
              {trash.map((s) => (
                <li key={s.id} className="song-card">
                  <span className="song-open">
                    <span className="song-title">{s.title}</span>
                    <span className="song-meta">Deleted {ago(s.deleted_at ?? s.updated_at)}</span>
                  </span>
                  <button className="btn" onClick={() => void restore(s.id)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {dialog === 'new' && (
        <NewSongDialog onClose={() => setDialog(null)} onCreated={(id) => goSong(id)} />
      )}
      {dialog === 'import' && (
        <ImportDialog onClose={() => setDialog(null)} onImported={(id) => goSong(id)} />
      )}
    </main>
  )
}
