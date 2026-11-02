import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'
import type { OnlineKind, OnlineResult, OnlineStatus } from '../types'

const KIND_LABEL: Record<OnlineKind, string> = {
  related: 'Related words',
  associated: 'Often used with',
  'sounds-like': 'Sounds like',
  rhymes: 'Rhymes',
  'near-rhymes': 'Near rhymes',
}

/** Switch for the optional online helper, with a plain statement of what it does and sends. */
export function OnlineSwitch({ onChange }: { onChange?: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<OnlineStatus | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .getOnlineStatus()
      .then(setStatus)
      .catch(() => setError('Cannot reach the Studio Bars server.'))
  }, [])
  async function toggle(on: boolean) {
    setError('')
    try {
      const s = await api.setOnlineEnabled(on)
      setStatus(s)
      onChange?.(s.enabled)
    } catch (e) {
      setError(e instanceof ApiFail ? e.message : 'Could not change that.')
    }
  }
  if (!status)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null
  return (
    <div className="card online-switch">
      <label className="check">
        <input
          type="checkbox"
          checked={status.enabled}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <b>Use the online word helper ({status.service})</b>
          <br />
          <small>
            Off by default. When on, looking a word up here also asks <b>{status.host}</b> over the
            internet. {status.sends} Answers are saved so repeats work offline.
          </small>
        </span>
      </label>
      <small className="hint">{status.key_notice}</small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Online ideas for one word. Always labelled as coming from the internet or from a saved copy. */
export function OnlineResults({ word, kinds }: { word: string; kinds: OnlineKind[] }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [kind, setKind] = useState<OnlineKind>(kinds[0])
  const [data, setData] = useState<OnlineResult | null>(null)
  const [error, setError] = useState<ApiFail | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api
      .getOnlineStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false))
  }, [])

  const run = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    if (!enabled || !word) {
      setData(null)
      return
    }
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    api
      .getOnlineWords(word, kind, ctl.signal)
      .then((r) => {
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setData(null)
        setError(e instanceof ApiFail ? e : new ApiFail('Unexpected error.'))
        setLoading(false)
      })
    return () => ctl.abort()
  }, [enabled, word, kind, tick])

  return (
    <div className="online-results">
      <OnlineSwitch onChange={setEnabled} />
      {enabled && word && (
        <>
          <div className="chips" role="group" aria-label="What to ask for">
            {kinds.map((k) => (
              <button
                key={k}
                className={`chip chip-btn${kind === k ? ' on' : ''}`}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {loading && (
            <p role="status" className="hint">
              Asking…
            </p>
          )}
          {error && (
            <div className="state state-error" role="alert">
              <p>{error.network ? 'Cannot reach the Studio Bars server.' : error.message}</p>
              <button className="btn" onClick={run}>
                Try again
              </button>
            </div>
          )}
          {data && (
            <section aria-label="Online results">
              <p className={`origin ${data.online ? 'origin-live' : 'origin-saved'}`}>
                {data.online
                  ? '🌐 Online · live from Datamuse'
                  : data.stale
                    ? '💾 Saved copy (offline)'
                    : '💾 Saved copy'}
                {' · '}
                {data.sent}
              </p>
              {data.notice && (
                <p className="warn" role="status">
                  {data.notice}
                </p>
              )}
              {data.results.length === 0 && (
                <p className="hint">Nothing came back for “{data.query.word}”.</p>
              )}
              <div className="words">
                {data.results.map((r) => (
                  <span key={r.word} className="chip-word chip-online">
                    {r.word}
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {enabled === false && (
        <p className="hint">
          Turn the helper on above if you want extra ideas from the internet. Everything else here
          works without it.
        </p>
      )}
    </div>
  )
}
