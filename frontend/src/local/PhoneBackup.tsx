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

/** Phone version only: songs live in this browser, so make backing up obvious and easy. */
export function PhoneBackup({ onRestored }: { onRestored: () => void }) {
  const [kept, setKept] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void askToKeepData().then(setKept)
  }, [])

  async function backup() {
    try {
      const b = await backupAll()
      download(b.blob, b.name)
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
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label="Backup file"
          hidden
          onChange={(e) => void restore(e.target.files?.[0])}
        />
      </div>
      {msg && (
        <p className={msg.ok ? 'ai-ok' : 'ai-err'} role="status">
          {msg.text}
        </p>
      )}
    </section>
  )
}
