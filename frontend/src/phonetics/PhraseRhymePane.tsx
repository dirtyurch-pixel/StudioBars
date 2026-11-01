import { useEffect, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'
import type { PhraseRhymes } from '../types'

const QUALITY = { perfect: 'Perfect', near: 'Near', assonance: 'Same vowels' } as const

/** EXPERIMENTAL: words and your own phrases that sound like the END of a phrase. */
export function PhraseRhymePane({
  request,
}: {
  request: { phrase: string; nonce: number } | null
}) {
  const [typed, setTyped] = useState('')
  const [phrase, setPhrase] = useState('')
  const [syl, setSyl] = useState(2)
  const [quals, setQuals] = useState<Record<string, boolean>>({
    perfect: true,
    near: true,
    assonance: false,
  })
  const [data, setData] = useState<PhraseRhymes | null>(null)
  const [error, setError] = useState<ApiFail | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (request?.phrase) {
      setTyped(request.phrase)
      setPhrase(request.phrase)
    }
  }, [request])

  useEffect(() => {
    if (!phrase) return
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    const chosen = Object.keys(quals).filter((q) => quals[q])
    api
      .phraseRhymes(phrase, syl, chosen.length ? chosen : ['perfect'], ctl.signal)
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
  }, [phrase, syl, quals, retry])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (typed.trim()) setPhrase(typed.trim())
  }

  return (
    <div className="phrase-rhymes">
      <p className="experimental" role="note">
        <b>Experimental.</b> This compares the last sounds of your phrase with single words and your
        own phrases. It can miss good rhymes and include loose ones. Check them by ear.
      </p>
      <form className="inline-form" onSubmit={submit}>
        <label htmlFor="phrase-rhyme" className="sr">
          Phrase
        </label>
        <input
          id="phrase-rhyme"
          className="input input-sm"
          value={typed}
          maxLength={120}
          placeholder="A phrase, like: pay attention"
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!typed.trim()}>
          Find rhymes
        </button>
      </form>
      <fieldset className="filters">
        <legend>Match the last…</legend>
        <div className="row3">
          <label>
            Syllables
            <select
              className="input input-sm"
              aria-label="Syllables to match"
              value={syl}
              onChange={(e) => setSyl(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="chips">
          {(Object.keys(QUALITY) as (keyof typeof QUALITY)[]).map((q) => (
            <label key={q} className={`chip chip-btn${quals[q] ? ' on' : ''}`}>
              <input
                type="checkbox"
                className="sr"
                checked={quals[q]}
                onChange={(e) => setQuals({ ...quals, [q]: e.target.checked })}
              />
              {QUALITY[q]}
            </label>
          ))}
        </div>
      </fieldset>
      {loading && (
        <p role="status" className="hint">
          Looking…
        </p>
      )}
      {error && (
        <div className="state state-error" role="alert">
          <p>
            {error.network
              ? 'Cannot reach the Studio Bars server. This tool runs on it (no internet needed).'
              : error.message}
          </p>
          {error.network && (
            <button className="btn" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          )}
        </div>
      )}
      {data && !loading && (
        <section aria-label="Phrase rhymes">
          <p className="hint">
            Matching the last {data.syllables} syllable{data.syllables === 1 ? '' : 's'}:{' '}
            <span className="ipa">/{data.tail_ipa}/</span> · {data.total} found
          </p>
          {data.results.length === 0 && (
            <p className="hint">
              Nothing matched. Try fewer syllables, or add “Near” or “Same vowels”.
            </p>
          )}
          <div className="words">
            {data.results.map((r) => (
              <span
                key={r.text}
                className={`chip-word q-${r.quality}`}
                title={`/${r.ipa}/ · ${r.syllables} syllables`}
              >
                {r.text}
                {r.quality !== 'perfect' && <sup>{QUALITY[r.quality]}</sup>}
                {r.kind === 'mine' && <sup>mine</sup>}
              </span>
            ))}
          </div>
          {data.notes.map((n) => (
            <small key={n} className="hint">
              {n}
            </small>
          ))}
        </section>
      )}
    </div>
  )
}
