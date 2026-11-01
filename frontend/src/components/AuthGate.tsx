import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'

/** Shows a PIN screen only when the server has a PIN set (phone/tablet use). Local use never sees it. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'open' | 'locked'>('checking')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    try {
      const s = await api.authStatus()
      setState(!s.required || s.ok ? 'open' : 'locked')
    } catch {
      setState('open') // server unreachable: let the editor show its normal offline banner
    }
  }, [])

  useEffect(() => {
    void check()
    const onLocked = () => setState('locked')
    window.addEventListener('sb-locked', onLocked)
    return () => window.removeEventListener('sb-locked', onLocked)
  }, [check])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.authLogin(pin)
      setPin('')
      setState('open')
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'checking') return <p className="muted lock-wait">Loading…</p>
  if (state === 'open') return <>{children}</>
  return (
    <main className="lock-screen">
      <form onSubmit={submit} className="lock-card" aria-label="Enter PIN">
        <h1>Studio Bars</h1>
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          className="input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        {error && (
          <p className="ai-err" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !pin}>
          Open
        </button>
      </form>
    </main>
  )
}
