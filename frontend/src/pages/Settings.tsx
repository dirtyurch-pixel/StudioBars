import { useEffect, useState } from 'react'
import * as api from '../api'
import { ApiFail, LOCAL } from '../api'
import { AiSetup } from '../ai/AiSetup'
import { PhoneBackup } from '../local/PhoneBackup'
import { goHome } from '../route'
import type { AiStatus } from '../types'
import { OnlineSwitch } from '../words/OnlineHelper'

const WAVE_PREF = 'sb-show-wave'

function readWave(): boolean {
  try {
    const v = localStorage.getItem(WAVE_PREF)
    if (v !== null) return v === '1'
  } catch {
    /* storage blocked */
  }
  return !window.matchMedia?.('(max-width: 860px)').matches
}

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`

/** One place for every setting: AI, the online word helper, the player, and (phone) storage and backups. */
export default function Settings() {
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [aiError, setAiError] = useState('')
  const [wave, setWave] = useState(readWave)
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null)

  useEffect(() => {
    document.title = 'Settings · Studio Bars'
    api
      .getAiStatus()
      .then(setAi, (e) =>
        setAiError(e instanceof ApiFail ? e.message : 'Could not load the AI settings.'),
      )
    if (LOCAL && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((e) => setStorage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
        .catch(() => {})
    }
  }, [])

  function toggleWave(on: boolean) {
    setWave(on)
    try {
      localStorage.setItem(WAVE_PREF, on ? '1' : '0')
    } catch {
      /* not saved; fine */
    }
    window.dispatchEvent(new CustomEvent('sb-wave', { detail: on }))
  }

  return (
    <main className="page settings">
      <header className="dash-head">
        <div>
          <h1 className="brand">
            <i /> Settings
          </h1>
          <p className="hint">Studio Bars</p>
        </div>
        <button className="btn" onClick={goHome}>
          ← My songs
        </button>
      </header>

      <section className="card set-sec" aria-labelledby="set-ai">
        <h2 id="set-ai">AI co-writer</h2>
        {aiError ? (
          <p className="ai-err">{aiError}</p>
        ) : ai ? (
          <AiSetup status={ai} onStatus={setAi} />
        ) : (
          <p className="muted">Loading…</p>
        )}
        <p className="hint">Once it is on, open a song and use its AI tab to ask for ideas.</p>
      </section>

      <section className="card set-sec" aria-labelledby="set-words">
        <h2 id="set-words">Words and rhymes</h2>
        <OnlineSwitch />
      </section>

      <section className="card set-sec" aria-labelledby="set-music">
        <h2 id="set-music">Music player</h2>
        <label className="check">
          <input type="checkbox" checked={wave} onChange={(e) => toggleWave(e.target.checked)} />
          <span>Show the waveform and beat markers in the player</span>
        </label>
        <p className="hint">
          Add or remove music with <b>♪ Library</b> in the player at the bottom.
        </p>
      </section>

      {LOCAL && (
        <section className="card set-sec" id="restore" aria-labelledby="set-store">
          <h2 id="set-store">Storage and backups</h2>
          {storage && (
            <p>
              Using about <b>{mb(storage.used)}</b> on this device
              {storage.quota ? ` (the browser allows about ${mb(storage.quota)})` : ''}.
            </p>
          )}
          <PhoneBackup onRestored={() => {}} />
        </section>
      )}
    </main>
  )
}
