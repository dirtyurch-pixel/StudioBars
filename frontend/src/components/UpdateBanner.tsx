import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateReady, updateReady } from '../update'

/** "A new version is ready" with a Reload button. Shown only when an update has downloaded. */
export function UpdateBanner() {
  const [ready, setReady] = useState(updateReady)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => onUpdateReady(() => setReady(true)), [])
  if (!ready) return null
  return (
    <div className="banner update-banner" role="status">
      <span>A new version of Studio Bars is ready.</span>
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          // save any open song first; never reload over unsaved writing
          const waits: Promise<boolean>[] = []
          window.dispatchEvent(new CustomEvent('sb-save-now', { detail: { waits } }))
          const ok = (await Promise.all(waits)).every(Boolean)
          if (!ok) {
            setBusy(false)
            setError(
              'Your latest writing has not saved yet, so the update waits. Try again in a moment.',
            )
            return
          }
          applyUpdate()
        }}
      >
        {busy ? 'Saving and updating…' : 'Reload to update'}
      </button>
      {error && <span className="ai-err">{error}</span>}
    </div>
  )
}
