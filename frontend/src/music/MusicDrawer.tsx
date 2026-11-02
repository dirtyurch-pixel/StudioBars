import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { LOCAL } from '../api'
import { ApiFail } from '../api'
import { useToast } from '../components/toastContext'
import type { PlaylistDetail, PlaylistSummary, Track } from '../types'
import { AUDIO_EXTS, extOf, formatTime, probeAudio } from './logic'
import { usePlayer } from './playerContext'

const CONSENT_KEY = 'studiobars.copyConsent'
const readConsent = () => {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

type Result = { name: string; ok: boolean; note: string }

export function MusicDrawer() {
  const p = usePlayer()
  const [tab, setTab] = useState<'tracks' | 'playlists'>('tracks')
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!p.drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    drawerRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.drawerOpen])

  if (!p.drawerOpen) return null
  return (
    <aside className="drawer" aria-label="Music library" ref={drawerRef} tabIndex={-1}>
      <div className="drawer-head">
        <h2>Music</h2>
        <div className="side-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'tracks'}
            className={`tab${tab === 'tracks' ? ' on' : ''}`}
            onClick={() => setTab('tracks')}
          >
            Tracks
          </button>
          <button
            role="tab"
            aria-selected={tab === 'playlists'}
            className={`tab${tab === 'playlists' ? ' on' : ''}`}
            onClick={() => setTab('playlists')}
          >
            Playlists
          </button>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => p.setDrawerOpen(false)}
          aria-label="Close music library"
        >
          ✕
        </button>
      </div>
      <div className="drawer-body">{tab === 'tracks' ? <TracksTab /> : <PlaylistsTab />}</div>
    </aside>
  )
}

// ------------------------------------------------------------------ tracks

function TracksTab() {
  const p = usePlayer()
  const toast = useToast()
  const [consent, setConsent] = useState(readConsent)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [drag, setDrag] = useState(false)

  const loadPlaylists = useCallback(() => {
    api
      .listPlaylists()
      .then(setPlaylists)
      .catch(() => {})
  }, [])
  useEffect(loadPlaylists, [loadPlaylists])

  async function importFiles(files: File[]) {
    if (!files.length) return
    const out: Result[] = []
    setResults([])
    for (const f of files) {
      setBusy(f.name)
      try {
        if (!AUDIO_EXTS.includes(extOf(f.name))) {
          throw new Error(
            `“${f.name}” is not a supported audio type. Use ${AUDIO_EXTS.join(', ')}.`,
          )
        }
        const duration = await probeAudio(f)
        const t = await api.uploadTrack(f, duration)
        out.push({
          name: f.name,
          ok: true,
          note: t.duplicate_of
            ? 'Added. It has the same audio as a track you already have.'
            : 'Added.',
        })
      } catch (e) {
        out.push({
          name: f.name,
          ok: false,
          note: e instanceof Error ? e.message : 'Could not import.',
        })
      }
      setResults([...out])
    }
    setBusy(null)
    await p.refreshLibrary()
  }

  const setConsentSaved = (v: boolean) => {
    setConsent(v)
    try {
      localStorage.setItem(CONSENT_KEY, v ? '1' : '0')
    } catch {
      /* the choice just isn't remembered */
    }
  }

  async function act(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn()
      if (ok) toast(ok, 'success')
      await p.refreshLibrary()
      loadPlaylists()
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'That did not work.', 'error')
    }
  }

  async function relink(t: Track, file: File | undefined) {
    if (!file) return
    try {
      const d = await probeAudio(file)
      await api.relinkTrack(t.id, file, d)
      toast('File relinked. Your playlists are unchanged.', 'success')
      await p.refreshLibrary()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not relink.', 'error')
    }
  }

  return (
    <div className="panel-body">
      <div
        className={`dropzone${drag ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (consent) void importFiles(Array.from(e.dataTransfer.files))
          else toast('Tick the box first so Studio Bars may copy your files.', 'error')
        }}
      >
        <label className="check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsentSaved(e.target.checked)}
          />
          <span>
            Copy the files I choose into Studio Bars’ private storage on{' '}
            <b>{LOCAL ? 'this device' : 'this computer'}</b>. They are never uploaded to the
            internet and stay out of GitHub. Only use music you have the right to play.
          </span>
        </label>
        <label htmlFor="music-files" className="label">
          Add audio files (mp3, wav, flac, ogg, opus, m4a, aac)
        </label>
        <input
          id="music-files"
          type="file"
          multiple
          disabled={!consent || busy !== null}
          accept=".mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,audio/*"
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <p className="hint">
          {LOCAL
            ? 'Music added here stays on this device (it is not part of “Back up all songs”). Music on your PC is not automatically here: add it on each device.'
            : 'On a computer you can also drag files here. Music saved on your PC is not automatically on your phone: import it on each device.'}
        </p>
        {busy && <p role="status">Importing “{busy}”…</p>}
        {results.length > 0 && (
          <ul className="results" aria-label="Import results">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'ok' : 'bad'}>
                <b>
                  {r.ok ? '✓' : '✕'} {r.name}
                </b>{' '}
                {r.note}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.libraryError && (
        <p className="error" role="alert">
          {p.libraryError}
        </p>
      )}
      {p.libraryLoaded && !p.library.length && !p.libraryError && (
        <p className="hint">No tracks yet.</p>
      )}
      <ul className="tracks">
        {p.library.map((t, i) => (
          <li
            key={t.id}
            className={`trk${p.track?.id === t.id ? ' now' : ''}${t.available ? '' : ' missing'}`}
          >
            <button
              className="btn"
              aria-label={`Play ${t.title}`}
              disabled={!t.available}
              onClick={() => p.playList(p.library, i)}
            >
              ▶
            </button>
            <div className="trk-main">
              {editing?.id === t.id ? (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act(() => api.patchTrack(t.id, { title: editing.title }), 'Renamed.').then(
                      () => setEditing(null),
                    )
                  }}
                >
                  <input
                    className="input input-sm"
                    aria-label="Track title"
                    value={editing.title}
                    maxLength={200}
                    autoFocus
                    onChange={(e) => setEditing({ id: t.id, title: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                  />
                  <button className="btn" disabled={!editing.title.trim()}>
                    Save
                  </button>
                </form>
              ) : (
                <b className="trk-title">{t.title}</b>
              )}
              <small>
                {formatTime(t.duration)} · {t.ext}
                {!t.available && <span className="badge-bad"> · File missing</span>}
              </small>
            </div>
            <div className="trk-actions">
              {!t.available && (
                <label className="btn">
                  Relink file
                  <input
                    type="file"
                    hidden
                    accept=".mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,audio/*"
                    onChange={(e) => {
                      void relink(t, e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
              <button
                className="btn btn-ghost"
                onClick={() => p.enqueueNext(t)}
                disabled={!t.available}
                aria-label={`Play ${t.title} next`}
              >
                Play next
              </button>
              <select
                className="input input-sm"
                aria-label={`Add ${t.title} to a playlist`}
                value=""
                onChange={(e) => {
                  const pid = e.target.value
                  if (pid) void act(() => api.addToPlaylist(pid, t.id), 'Added to playlist.')
                }}
              >
                <option value="">+ Playlist…</option>
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                onClick={() => setEditing({ id: t.id, title: t.title })}
              >
                Rename
              </button>
              {confirmDel === t.id ? (
                <span className="confirm">
                  Remove from library and delete the copied file?
                  <button
                    className="btn btn-danger"
                    onClick={() =>
                      void act(() => api.deleteTrack(t.id), 'Track removed.').then(() =>
                        setConfirmDel(null),
                      )
                    }
                  >
                    Yes, remove
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="btn btn-ghost"
                  aria-label={`Remove ${t.title}`}
                  onClick={() => setConfirmDel(t.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {p.upNext.length > 0 && (
        <p className="hint">Up next: {p.upNext.map((t) => t.title).join(' → ')}</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ playlists

function PlaylistsTab() {
  const p = usePlayer()
  const toast = useToast()
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null)
  const [open, setOpen] = useState<PlaylistDetail | null>(null)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  const load = useCallback(async () => {
    try {
      setLists(await api.listPlaylists())
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not load playlists.', 'error')
      setLists([])
    }
  }, [toast])
  useEffect(() => {
    void load()
  }, [load])

  async function run<T>(fn: () => Promise<T>, then?: (r: T) => void) {
    try {
      const r = await fn()
      then?.(r)
      await load()
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'That did not work.', 'error')
    }
  }

  if (open) {
    const ids = open.entries.map((e) => e.entry_id)
    const move = (i: number, d: -1 | 1) => {
      const a = ids.slice()
      ;[a[i], a[i + d]] = [a[i + d], a[i]]
      void run(() => api.reorderPlaylist(open.id, a), setOpen)
    }
    const tracks = open.entries.map((e) => e.track)
    return (
      <div className="panel-body">
        <button
          className="btn btn-ghost"
          onClick={() => {
            setOpen(null)
            setConfirmDel(false)
          }}
        >
          ← All playlists
        </button>
        {renaming === open.id ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(
                () => api.renamePlaylist(open.id, name),
                (r) => {
                  setOpen(r)
                  setRenaming(null)
                },
              )
            }}
          >
            <input
              className="input input-sm"
              aria-label="Playlist name"
              value={name}
              maxLength={200}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn" disabled={!name.trim()}>
              Save
            </button>
          </form>
        ) : (
          <h3 className="pl-name">{open.name}</h3>
        )}
        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={!tracks.some((t) => t.available)}
            onClick={() =>
              p.playList(
                tracks,
                Math.max(
                  0,
                  tracks.findIndex((t) => t.available),
                ),
                { playlistId: open.id },
              )
            }
          >
            ▶ Play playlist
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setRenaming(open.id)
              setName(open.name)
            }}
          >
            Rename
          </button>
          {confirmDel ? (
            <span className="confirm">
              Delete this playlist? The audio files stay in your library.
              <button
                className="btn btn-danger"
                onClick={() =>
                  void run(
                    () => api.deletePlaylist(open.id),
                    () => {
                      setOpen(null)
                      setConfirmDel(false)
                      toast('Playlist deleted. Your tracks are still in the library.', 'success')
                    },
                  )
                }
              >
                Yes, delete playlist
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirmDel(true)}>
              Delete playlist
            </button>
          )}
        </div>
        {open.entries.length === 0 && (
          <p className="hint">Empty. Add tracks below, or from the Tracks tab.</p>
        )}
        <ol className="tracks">
          {open.entries.map((e, i) => (
            <li
              key={e.entry_id}
              className={`trk${p.track?.id === e.track.id && p.playlistId === open.id ? ' now' : ''}${e.track.available ? '' : ' missing'}`}
            >
              <button
                className="btn"
                aria-label={`Play ${e.track.title}`}
                disabled={!e.track.available}
                onClick={() => p.playList(tracks, i, { playlistId: open.id })}
              >
                ▶
              </button>
              <div className="trk-main">
                <b className="trk-title">{e.track.title}</b>
                <small>
                  {formatTime(e.track.duration)}
                  {!e.track.available && <span className="badge-bad"> · File missing</span>}
                </small>
              </div>
              <div className="trk-actions">
                <button
                  className="btn btn-ghost"
                  aria-label={`Move ${e.track.title} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ▲
                </button>
                <button
                  className="btn btn-ghost"
                  aria-label={`Move ${e.track.title} down`}
                  disabled={i === open.entries.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ▼
                </button>
                <button
                  className="btn btn-ghost"
                  aria-label={`Remove ${e.track.title} from playlist`}
                  onClick={() =>
                    void run(() => api.removeFromPlaylist(open.id, e.entry_id), setOpen)
                  }
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <label htmlFor="pl-add" className="label">
          Add a track
        </label>
        <select
          id="pl-add"
          className="input"
          value=""
          onChange={(e) => {
            const id = e.target.value
            if (id) void run(() => api.addToPlaylist(open.id, id), setOpen)
          }}
        >
          <option value="">Choose a track…</option>
          {p.library.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <p className="hint">The same track can appear more than once.</p>
      </div>
    )
  }

  return (
    <div className="panel-body">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run(
            () => api.createPlaylist(name),
            (r) => {
              setName('')
              setOpen(r)
            },
          )
        }}
      >
        <label htmlFor="pl-new" className="sr">
          New playlist name
        </label>
        <input
          id="pl-new"
          className="input input-sm"
          placeholder="New playlist name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!name.trim()}>
          Create playlist
        </button>
      </form>
      {lists === null && <p className="hint">Loading…</p>}
      {lists?.length === 0 && <p className="hint">No playlists yet.</p>}
      <ul className="tracks">
        {lists?.map((l) => (
          <li key={l.id} className="trk">
            <button
              className="btn"
              onClick={() => void run(() => api.getPlaylist(l.id), setOpen)}
              aria-label={`Open playlist ${l.name}`}
            >
              Open
            </button>
            <div className="trk-main">
              <b className="trk-title">{l.name}</b>
              <small>
                {l.track_count} tracks · {formatTime(l.total_duration)}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
