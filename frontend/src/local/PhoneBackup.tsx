import { useEffect, useRef, useState } from 'react'
import { ApiFail } from '../apiFail'
import { goSettings } from '../route'
import {
  makeArchive,
  musicBytes,
  readArchive,
  readBytes,
  restoreArchive,
  type ReadArchive,
  type Summary,
} from './archive'
import { askToKeepData, db, restoreBackup } from './localApi'
import { exclusive } from './store'

const LAST = 'sb-last-backup'
const MUSIC_PREF = 'sb-backup-music'
const FLASH = 'sb-restore-flash'
const DAY = 86400000

function getItem(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function setItem(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* not remembered; fine */
  }
}

function lastText(t: number | null): string {
  if (!t) return 'No backup made yet'
  const days = Math.floor((Date.now() - t) / DAY)
  return days < 1
    ? 'Last backup made today'
    : days === 1
      ? 'Last backup made yesterday'
      : `Last backup made ${days} days ago`
}

const mb = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / (1024 * 1024)).toFixed(1)} MB`

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function describe(s: Summary): string {
  const parts = [plural(s.songs, 'song'), plural(s.revisions, 'history snapshot')]
  if (s.recordings) parts.push(plural(s.recordings, 'recording'))
  if (s.tracks) parts.push(plural(s.tracks, 'music track'))
  if (s.playlists) parts.push(plural(s.playlists, 'playlist'))
  return parts.join(' · ') + (s.media_bytes ? ` (${mb(s.media_bytes)} of audio)` : '')
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

type Msg = { ok: boolean; text: string }

/**
 * Phone version only: everything lives in this browser, so backing up must be easy and complete.
 * `compact` is the slim strip on the home screen; the full panel (with restore) lives in Settings.
 */
export function PhoneBackup({
  onRestored,
  compact = false,
}: {
  onRestored: () => void
  compact?: boolean
}) {
  const [kept, setKept] = useState<boolean | null>(null)
  const [last, setLast] = useState<number | null>(() => Number(getItem(LAST)) || null)
  const [withMusic, setWithMusic] = useState(() => getItem(MUSIC_PREF) !== '0')
  const [music, setMusic] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [made, setMade] = useState<{ blob: Blob; name: string } | null>(null)
  const [pending, setPending] = useState<{ archive: ReadArchive; name: string } | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void askToKeepData().then(setKept)
    void musicBytes(db()).then(setMusic, () => setMusic(null))
    const flash = sessionStorage.getItem(FLASH)
    if (flash) {
      sessionStorage.removeItem(FLASH)
      setMsg({ ok: true, text: flash })
    }
  }, [])

  async function backup() {
    setBusy('Making and checking your backup…')
    setMsg(null)
    setMade(null)
    try {
      const b = await exclusive(() => makeArchive(db(), { includeMusic: withMusic }))
      download(b.blob, b.name)
      setMade(b)
      const now = Date.now()
      setLast(now)
      setItem(LAST, String(now))
      setMsg({
        ok: true,
        text: `Backup checked ✓ ${describe(b.summary)}. Download started (${b.name}, ${mb(b.blob.size)}). Keep a copy somewhere safe, like Google Drive, not only on this phone.`,
      })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiFail ? e.message : 'Could not make the backup.' })
    } finally {
      setBusy(null)
    }
  }

  async function share() {
    if (!made) return
    const f = new File([made.blob], made.name, { type: 'application/octet-stream' })
    try {
      await navigator.share({ files: [f], title: 'Studio Bars backup' })
    } catch {
      /* cancelled */
    }
  }

  async function choose(f: File | undefined) {
    if (file.current) file.current.value = ''
    if (!f) return
    setMsg(null)
    setPending(null)
    setConfirmReplace(false)
    setBusy('Checking the backup file…')
    try {
      const first = new TextDecoder().decode(await readBytes(f.slice(0, 1)))
      if (first === '{') {
        // an older songs-only backup (.json): adds the songs as new copies, as before
        const n = await restoreBackup(await f.text())
        setMsg({
          ok: true,
          text: `Added ${plural(n, 'song')} from that older backup. Nothing already here was changed. (Older backups only hold lyrics.)`,
        })
        onRestored()
        return
      }
      setPending({ archive: await readArchive(f), name: f.name })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiFail ? e.message : 'Could not read that backup.' })
    } finally {
      setBusy(null)
    }
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!pending) return
    setBusy('Restoring…')
    setMsg(null)
    try {
      const r = await exclusive(() => restoreArchive(db(), pending.archive, mode))
      const text =
        mode === 'replace'
          ? `Restored and checked ✓ This device now matches the backup: ${describe(r.summary)}.`
          : `Restored and checked ✓ Added ${plural(r.added, 'item')} that were missing.` +
            (r.songs_on_both
              ? ` ${plural(r.songs_on_both, 'song was', 'songs were')} already on this device and kept as they are here.`
              : '')
      try {
        sessionStorage.setItem(FLASH, text)
      } catch {
        /* message lost; fine */
      }
      onRestored()
      window.location.reload() // start fresh so music and recordings load from the restored data
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof ApiFail ? e.message : 'Could not restore. Nothing was changed.',
      })
      setBusy(null)
    }
  }

  const status = (busy || msg) && (
    <p className={busy ? 'muted' : msg?.ok ? 'ai-ok' : 'ai-err'} role="status">
      {busy ?? msg?.text}
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
          <b>Back up your work</b>
          <small>Saved on this device. {lastText(last)}</small>
        </span>
        <button
          className={`btn ${stale ? 'btn-primary' : ''} btn-sm`}
          onClick={() => void backup()}
          disabled={!!busy}
          aria-label="Back up everything"
        >
          Back up
        </button>
        <button className="btn btn-ghost btn-sm" onClick={goSettings} aria-label="Manage backups">
          Manage
        </button>
        {status}
      </section>
    )
  }

  const s = pending?.archive.summary
  return (
    <section className="phone-note backup-panel" aria-label="Back up and restore">
      <p>
        <strong>Saved on this device.</strong> Everything lives in this browser only, so back up now
        and then and keep the file somewhere safe.
        {kept === false && ' This browser may clear stored data when space runs low.'}
      </p>
      <p className="hint">
        A backup holds every song (and the trash), all history snapshots, takes, notes, melody
        sketches, your recordings, pronunciations, the phrase bank and your settings. It never holds
        your AI key. {lastText(last)}.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={withMusic}
          onChange={(e) => {
            setWithMusic(e.target.checked)
            setItem(MUSIC_PREF, e.target.checked ? '1' : '0')
          }}
        />
        <span>
          Include music files, playlists and beat markers
          {music !== null ? ` (${mb(music)})` : ''}
        </span>
      </label>
      <div className="actions">
        <button className="btn btn-primary" onClick={() => void backup()} disabled={!!busy}>
          Back up everything
        </button>
        {made &&
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [new File([], made.name)] }) && (
            <button className="btn" onClick={() => void share()}>
              Save to Drive / share…
            </button>
          )}
        <button className="btn btn-ghost" onClick={() => file.current?.click()} disabled={!!busy}>
          Restore a backup…
        </button>
        <input
          ref={file}
          type="file"
          aria-label="Backup file"
          hidden
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </div>
      {status}
      {pending && s && (
        <div className="restore-box" role="group" aria-label="Restore this backup">
          <p>
            <b>Backup checked ✓</b> made{' '}
            {new Date(pending.archive.manifest.exported_at).toLocaleString()}: {describe(s)}.
            {!pending.archive.manifest.includes_music && ' It has no music.'}
          </p>
          {confirmReplace ? (
            <div className="actions">
              <span className="ai-err">
                Replace everything? Songs and recordings on this device that are not in the backup
                will be removed.
              </span>
              <button
                className="btn btn-danger"
                onClick={() => void restore('replace')}
                disabled={!!busy}
              >
                Yes, replace everything
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmReplace(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="actions">
              <button
                className="btn btn-primary"
                onClick={() => void restore('merge')}
                disabled={!!busy}
              >
                Add what’s missing
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmReplace(true)}
                disabled={!!busy}
              >
                Replace everything on this device…
              </button>
              <button className="btn btn-ghost" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}
          <p className="hint">
            “Add what’s missing” never changes anything already here. If a song is on both, this
            device’s version is kept.
          </p>
        </div>
      )}
    </section>
  )
}
