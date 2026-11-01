import { useEffect, useState } from 'react'
import { fetchHealth, type Health } from './api'

type State =
  { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error'; message: string }

export function BackendStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const ctl = new AbortController()
    fetchHealth(ctl.signal)
      .then((health) => setState({ kind: 'ok', health }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Unknown error' })
      })
    return () => ctl.abort()
  }, [])

  if (state.kind === 'loading') return <p role="status">Checking backend…</p>
  if (state.kind === 'ok')
    return (
      <p role="status" style={{ color: 'var(--accent)' }}>
        Backend OK (version {state.health.version})
      </p>
    )
  return (
    <p role="alert" style={{ color: 'var(--danger)' }}>
      Backend not reachable: {state.message}. Start it with scripts/dev.sh or scripts/dev.ps1.
    </p>
  )
}
