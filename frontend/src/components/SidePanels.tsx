import { useState } from 'react'
import {
  ApiFail,
  addComment,
  deleteComment,
  editComment,
  exportSong,
  type ImportFormat,
} from '../api'
import type { Line, Revision, Song } from '../types'
import { ago } from '../time'
import { useToast } from './toastContext'

export function NotesPanel({
  line,
  lineNumber,
  onSong,
}: {
  line: Line | null
  lineNumber: number
  onSong: (s: Song) => void
}) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)

  if (!line) return <p className="hint">Tap a line to see or add notes for it.</p>

  async function run(fn: () => Promise<Song>) {
    try {
      onSong(await fn())
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not save the note.', 'error')
    }
  }

  return (
    <div className="panel-body">
      <p className="hint">
        Notes on line {lineNumber}: “{line.text || 'empty line'}”
        {line.is_locked ? ' (locked: notes are still allowed)' : ''}
      </p>
      <ul className="notes">
        {line.comments.map((c) => (
          <li key={c.id}>
            {editing?.id === c.id ? (
              <>
                <textarea
                  className="input"
                  rows={2}
                  aria-label="Edit note"
                  value={editing.body}
                  onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                />
                <div className="actions">
                  <button
                    className="btn"
                    disabled={!editing.body.trim()}
                    onClick={() =>
                      void run(() => editComment(c.id, editing.body)).then(() => setEditing(null))
                    }
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>{c.body}</span>
                <span className="actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setEditing({ id: c.id, body: c.body })}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void run(() => deleteComment(c.id))}
                  >
                    Delete
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <label htmlFor="note-new" className="label">
        Add a note
      </label>
      <textarea
        id="note-new"
        className="input"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ideas, reminders, alternatives to try…"
      />
      <button
        className="btn btn-primary"
        disabled={!draft.trim()}
        onClick={() => void run(() => addComment(line.id, draft)).then(() => setDraft(''))}
      >
        Add note
      </button>
    </div>
  )
}

export function HistoryPanel({
  revisions,
  onSnapshot,
  onRestore,
}: {
  revisions: Revision[] | null
  onSnapshot: (description: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
}) {
  const [desc, setDesc] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const kind = { auto: 'Automatic', manual: 'Saved by you', 'pre-restore': 'Before a restore' }

  return (
    <div className="panel-body">
      <label htmlFor="snap-desc" className="label">
        Save a snapshot of this song now
      </label>
      <input
        id="snap-desc"
        className="input"
        value={desc}
        maxLength={200}
        placeholder="Optional name, e.g. “before rewriting verse 2”"
        onChange={(e) => setDesc(e.target.value)}
      />
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await onSnapshot(desc)
          setDesc('')
          setBusy(false)
        }}
      >
        Save snapshot
      </button>
      <h3 className="rhead">Earlier versions</h3>
      {revisions === null && <p className="hint">Loading…</p>}
      {revisions?.length === 0 && (
        <p className="hint">No versions yet. One is saved automatically as you write.</p>
      )}
      <ul className="notes">
        {revisions?.map((r) => (
          <li key={r.id}>
            <span>
              <b>{r.description || kind[r.kind]}</b>
              <br />
              <small>
                {kind[r.kind]} · {ago(r.created_at)} · {r.line_count} lines
              </small>
            </span>
            {confirm === r.id ? (
              <span className="actions">
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await onRestore(r.id)
                    setBusy(false)
                    setConfirm(null)
                  }}
                >
                  Restore it
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn" onClick={() => setConfirm(r.id)}>
                Restore…
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <p className="hint">Your current version is saved first, so a restore can be undone.</p>
      )}
    </div>
  )
}

export function FilesPanel({ songId }: { songId: string }) {
  const toast = useToast()
  async function download(fmt: ImportFormat) {
    try {
      const { blob, name } = await exportSong(songId, fmt)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Export failed.', 'error')
    }
  }
  return (
    <div className="panel-body">
      <p className="hint">Export the saved version of this song.</p>
      <div className="actions">
        <button className="btn" onClick={() => void download('txt')}>
          Text (.txt)
        </button>
        <button className="btn" onClick={() => void download('md')}>
          Markdown (.md)
        </button>
        <button className="btn" onClick={() => void download('json')}>
          Full backup (.json)
        </button>
      </div>
      <p className="hint">
        Text and Markdown keep section names and lyrics. JSON also keeps locks, notes and details.
        Import from the song list.
      </p>
    </div>
  )
}
