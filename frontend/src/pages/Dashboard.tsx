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
  const [query, setQuery] = useState('')

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

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 5
      ? 'Late night session'
      : h < 12
        ? 'Good morning'
        : h < 18
          ? 'Good afternoon'
          : 'Good evening'
  })()
  const shown = songs?.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <main className="page home">
      <header className="home-top">
        <h1 className="brand">
          <i /> Studio Bars
        </h1>
        <button className="icon-btn" onClick={goSettings} aria-label="Settings" title="Settings">
          ⚙
        </button>
      </header>

      <section className="home-hero">
        <p className="home-greet">{greeting}</p>
        <h2 className="home-title">What are we writing today?</h2>
        <div className="home-tiles">
          <button
            className="tile tile-new"
            onClick={() => setDialog('new')}
            aria-label="+ New song"
          >
            <span className="tile-icon" aria-hidden="true">
              ＋
            </span>
            <span className="tile-text">
              <b>New song</b>
              <small>Start on a fresh pad</small>
            </span>
          </button>
          <button
            className="tile tile-import"
            onClick={() => setDialog('import')}
            aria-label="Import"
          >
            <span className="tile-icon" aria-hidden="true">
              ⇣
            </span>
            <span className="tile-text">
              <b>Import</b>
              <small>Paste or open lyrics</small>
            </span>
          </button>
        </div>
      </section>

      {LOCAL && <PhoneBackup compact onRestored={() => void load()} />}

      {!!songs?.length && (
        <div className="home-sec">
          <h2>
            My songs <span className="count">{songs.length}</span>
          </h2>
          {songs.length > 4 && (
            <input
              className="input home-search"
              type="search"
              placeholder="Search songs"
              aria-label="Search songs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
      )}
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
        <div className="state home-empty">
          <div className="pad-art" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <h2>No songs yet</h2>
          <p>Your first bars start here. Start a new song, or import lyrics you already have.</p>
          <button className="btn btn-primary" onClick={() => setDialog('new')}>
            + New song
          </button>
        </div>
      )}
      {!!songs?.length && shown?.length === 0 && (
        <p className="hint">No song titles match “{query}”.</p>
      )}

      <ul className="song-list song-grid">
        {shown?.map((s) => (
          <li key={s.id} className="song-card">
            <button className="song-open" onClick={() => goSong(s.id)}>
              <span className="song-title">{s.title}</span>
              {(s.genres.length > 0 || !!s.bpm) && (
                <span className="song-chips">
                  {s.genres.map((g) => (
                    <span key={g} className="chip">
                      {genreLabel(g)}
                    </span>
                  ))}
                  {s.bpm ? <span className="chip chip-dim">{s.bpm} BPM</span> : null}
                </span>
              )}
              <span className="song-meta">
                {s.line_count} line{s.line_count === 1 ? '' : 's'}
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
                className="icon-btn song-del"
                aria-label={`Delete ${s.title}`}
                title="Move to trash"
                onClick={() => setConfirmId(s.id)}
              >
                🗑
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
