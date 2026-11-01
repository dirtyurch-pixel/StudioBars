import { useState } from 'react'
import { ApiFail, commitImport, previewImport, type ImportFormat } from '../api'
import type { ImportPreview } from '../types'
import { Modal } from './Modal'

const MAX_BYTES = 1_000_000

function guessFormat(name: string, text: string): ImportFormat {
  const n = name.toLowerCase()
  if (n.endsWith('.json') || text.trimStart().startsWith('{')) return 'json'
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'md'
  return 'txt'
}

export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [format, setFormat] = useState<ImportFormat>('txt')
  const [title, setTitle] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onFile(f: File | undefined) {
    if (!f) return
    setError('')
    setPreview(null)
    if (f.size > MAX_BYTES) {
      setError('That file is larger than 1 MB. Lyrics files should be much smaller.')
      return
    }
    const content = await f.text()
    setText(content)
    setFormat(guessFormat(f.name, content))
    // use the CURRENT title: the user may have typed one while the file was being read
    setTitle((current) => current || f.name.replace(/\.[^.]+$/, ''))
  }

  async function runPreview() {
    setBusy(true)
    setError('')
    try {
      setPreview(await previewImport(format, text, title.trim() || undefined))
    } catch (e) {
      setPreview(null)
      setError(e instanceof ApiFail ? e.message : 'Could not read that text.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    try {
      const song = await commitImport(format, text, title.trim() || undefined)
      onImported(song.id)
    } catch (e) {
      setError(e instanceof ApiFail ? e.message : 'Import failed.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Import lyrics" onClose={onClose} wide>
      <div className="form">
        <label htmlFor="im-file">Choose a .txt, .md or Studio Bars .json file</label>
        <input
          id="im-file"
          type="file"
          accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <label htmlFor="im-text">…or paste text</label>
        <textarea
          id="im-text"
          className="input"
          rows={6}
          value={text}
          placeholder={'[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n…'}
          onChange={(e) => {
            setText(e.target.value)
            setPreview(null)
          }}
        />
        <div className="row2">
          <div>
            <label htmlFor="im-format">Format</label>
            <select
              id="im-format"
              className="input"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as ImportFormat)
                setPreview(null)
              }}
            >
              <option value="txt">Plain text</option>
              <option value="md">Markdown</option>
              <option value="json">Studio Bars JSON</option>
            </select>
          </div>
          <div>
            <label htmlFor="im-title">Title (optional)</label>
            <input
              id="im-title"
              className="input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </div>
        <p className="hint">
          Importing always creates a new song. It never changes a song you already have.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <div className="preview" aria-label="Import preview">
            <strong>
              “{preview.title}” — {preview.sections.length} sections, {preview.line_count} lines
              {preview.locked_count ? `, ${preview.locked_count} locked` : ''}
            </strong>
            {preview.warnings.map((w) => (
              <p key={w} className="warn">
                {w}
              </p>
            ))}
            <ul>
              {preview.sections.map((s, i) => (
                <li key={i}>
                  <b>{s.label}</b> ({s.lines.length} lines): {s.lines.slice(0, 2).join(' / ')}
                  {s.lines.length > 2 ? ' …' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={runPreview} disabled={busy || !text.trim()}>
            Preview
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={busy || !preview}>
            Import as new song
          </button>
        </div>
      </div>
    </Modal>
  )
}
