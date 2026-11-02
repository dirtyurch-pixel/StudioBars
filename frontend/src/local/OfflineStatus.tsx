import { useCallback, useEffect, useState } from 'react'
import { POS_FILE, POS_ORDER } from './lexicon/wordnet'

const BASE = `${import.meta.env.BASE_URL}data/`
const DICT = ['cmudict.txt', 'frequency_en.txt']
const MEANINGS = POS_ORDER.flatMap((p) => [
  `wordnet/index.${POS_FILE[p]}.txt`,
  `wordnet/${POS_FILE[p]}.exc.txt`,
  `wordnet/data.${POS_FILE[p]}.txt`,
])

async function saved(files: string[]): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  for (const f of files) if (!(await caches.match(BASE + f, { ignoreVary: true }))) return false
  return true
}

type State = { app: boolean; dict: boolean; meanings: boolean }

/** Phone version: what works with no connection, and a button to download word meanings for offline use. */
export function OfflineStatus() {
  const [s, setS] = useState<State | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const check = useCallback(async () => {
    setS({
      app: !!navigator.serviceWorker?.controller,
      dict: await saved(DICT),
      meanings: await saved(MEANINGS),
    })
  }, [])
  useEffect(() => {
    void check()
  }, [check])

  async function download(files: string[]) {
    setErr('')
    try {
      let n = 0
      for (const f of files) {
        setBusy(`Downloading… ${Math.round((n / files.length) * 100)}%`)
        // the app's offline helper keeps a copy of everything it fetches
        const res = await fetch(BASE + f, { cache: 'reload' })
        if (!res.ok) throw new Error(String(res.status))
        await res.arrayBuffer()
        n++
      }
      await new Promise((r) => setTimeout(r, 300))
    } catch {
      setErr('The download did not finish. Check the connection and try again.')
    } finally {
      setBusy(null)
      void check()
    }
  }

  if (!s) return null
  const row = (ok: boolean, text: string) => (
    <li className={ok ? 'ok' : 'no'}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span> {text}
    </li>
  )
  return (
    <div className="offline-status">
      <ul aria-label="Works offline">
        {row(
          s.app,
          s.app ? 'The app opens with no connection' : 'Offline mode starts after the next reload',
        )}
        {row(
          s.dict,
          s.dict
            ? 'Rhymes and syllable counts work offline'
            : 'Rhymes dictionary not saved for offline yet',
        )}
        {row(
          s.meanings,
          s.meanings
            ? 'Word meanings work offline'
            : 'Word meanings need a connection (not downloaded)',
        )}
      </ul>
      <div className="actions">
        {!s.dict && (
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void download(DICT)}>
            Save the rhymes dictionary
          </button>
        )}
        {!s.meanings && (
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void download(MEANINGS)}>
            Download word meanings for offline (about 9 MB)
          </button>
        )}
      </div>
      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {err && (
        <p className="ai-err" role="alert">
          {err}
        </p>
      )}
      <p className="hint">The AI helper and the online word helper always need a connection.</p>
    </div>
  )
}
