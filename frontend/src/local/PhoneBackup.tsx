import { useEffect, useRef, useState } from 'react'
import { ApiFail } from '../apiFail'
import { askToKeepData, backupAll, restoreBackup } from './localApi'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const LAST = 'sb-last-backup'
const DAY = 86400000

function readLast(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST))
    return v > 0 ? v : null
  } catch {
    return null
  }
}

function lastText(t: number | null): string {
  if (!t) return 'Not backed up yet'
  const days = Math.floor((Date.now() - t) / DAY)
  return days < 1
    ? 'Backed up today'
    : days === 1
      ? 'Backed up yesterday'
      : `Last backup ${days} days ago`
}

/**
 * Phone version only: songs live in this browser, so make backing up obvious and easy.
 * `compact` is the slim strip on the home screen; the full panel lives in Settings.
 */
export function PhoneBackup({
  onRestored,
  compact = false,
}: {
  onRestored: () => void
  compact?: boolean
}) {
  const [kept, setKept] = useState<boolean | null>(null)
  const [last, setLast] = useState<number | null>(readLast)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void askToKeepData().then(setKept)
  }, [])

  async function backup() {
    try {
      const b = await backupAll()
      download(b.blob, b.name)
      const now = Date.now()
      setLast(now)
      try {
        localStorage.setItem(LAST, String(now))
      } catch {
        /* not remembered; fine */
      }
      setMsg({
        ok: true,
        text: `Backup of ${b.count} song${b.count === 1 ? '' : 's'} saved to your downloads.`,
      })
    } catch {
      setMsg({ ok: false, text: 'Could not make the backup.' })
    }
  }

  async function restore(f: File | undefined) {
    if (!f) return
    try {
      const n = await restoreBackup(await f.text())
      setMsg({
        ok: true,
        text: `Added ${n} song${n === 1 ? '' : 's'} from the backup. Nothing already here was changed.`,
      })
      onRestored()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiFail ? e.message : 'Could not read that backup.' })
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  const fileInput = (
    <input
      ref={file}
      type="file"
      accept=".json,application/json"
      aria-label="Backup file"
      hidden
      onChange={(e) => void restore(e.target.files?.[0])}
    />
  )
  const status = msg && (
    <p className={msg.ok ? 'ai-ok' : 'ai-err'} role="status">
      {msg.text}
    </p>
  )

  if (compact) {
    const stale = !last || Date.now() - last > 7 * DAY
    return (
      <section
        className={`backup-strip${stale ? ' stale' : ''}`}
        aria-label="Your songs on this device"
      >
        <span className="backup-icon" aria-hidden="true">
          💾
        </span>
        <span className="backup-text">
          <b>Saved on this device.</b> <small>{lastText(last)}</small>
        </span>
        <button
          className={`btn ${stale ? 'btn-primary' : 'btn-ghost'} btn-sm`}
          onClick={() => void backup()}
          aria-label="Back up all songs"
        >
          Back up
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => file.current?.click()}
          aria-label="Restore a backup"
        >
          Restore
        </button>
        {fileInput}
        {status}
      </section>
    )
  }

  return (
    <section className="phone-note" aria-label="Your songs on this device">
      <p>
        <strong>Saved on this device.</strong> Your songs live in this browser only. Nothing is sent
        anywhere. Back up now and then, and before clearing your browser data.
        {kept === false &&
          ' This browser may clear stored data when space runs low, so backups matter.'}
      </p>
      <div className="actions">
        <button className="btn" onClick={() => void backup()}>
          Back up all songs
        </button>
        <button className="btn btn-ghost" onClick={() => file.current?.click()}>
          Restore a backup
        </button>
        {fileInput}
      </div>
      {status}
    </section>
  )
}
