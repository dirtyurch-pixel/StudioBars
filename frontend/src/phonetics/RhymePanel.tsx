import { useCallback, useEffect, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'
import { useToast } from '../components/toastContext'
import type { CustomPron, PhoneticsStatus, RhymeResponse, RhymeResult, WordInfo } from '../types'
import { OnlineResults } from '../words/OnlineHelper'
import { PhraseRhymePane } from './PhraseRhymePane'

type Props = {
  suggested: { word: string; nonce: number } | null
  /** A phrase to look up in the experimental phrase mode (set from the phrase bank). */
  phraseRequest?: { phrase: string; nonce: number } | null
  /** Called once the phrase request has been taken, so it is not replayed when the tab is reopened. */
  onPhraseHandled?: () => void
  /** Tell the editor that a pronunciation changed so syllables and colours refresh. */
  onCustomChanged: () => void
}

const QUALITY_LABEL: Record<string, string> = {
  perfect: 'Perfect',
  near: 'Near',
  assonance: 'Same vowels',
  consonance: 'Same ending',
}
const dots = (stress: string) => stress.replace(/1/g, '●').replace(/2/g, '◐').replace(/0/g, '○')
const plural = (n: number) => `${n} syllable${n === 1 ? '' : 's'}`

function WordRhymes({ suggested, onCustomChanged }: Props) {
  const toast = useToast()
  const [status, setStatus] = useState<PhoneticsStatus | null>(null)
  const [typed, setTyped] = useState('')
  const [word, setWord] = useState('')
  const [quals, setQuals] = useState<Record<string, boolean>>({
    perfect: true,
    near: true,
    assonance: false,
    consonance: false,
  })
  const [identical, setIdentical] = useState(false)
  const [minSyl, setMinSyl] = useState('')
  const [maxSyl, setMaxSyl] = useState('')
  const [ending, setEnding] = useState('')
  const [fam, setFam] = useState<'any' | 'familiar' | 'common'>('familiar')
  const [pos, setPos] = useState('')
  const [limit, setLimit] = useState(60)
  const [data, setData] = useState<RhymeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiFail | null>(null)
  const [reload, setReload] = useState(0)
  const [customs, setCustoms] = useState<CustomPron[]>([])
  const [sounds, setSounds] = useState('')
  const [rawPhones, setRawPhones] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    api
      .getPhoneticsStatus()
      .then(setStatus)
      .catch(() => {})
  }, [])
  const loadCustoms = useCallback(() => {
    api
      .listCustomPron()
      .then(setCustoms)
      .catch(() => {})
  }, [])
  useEffect(loadCustoms, [loadCustoms])

  useEffect(() => {
    if (suggested?.word) {
      setTyped(suggested.word)
      setWord(suggested.word)
      setLimit(60)
    }
  }, [suggested])

  useEffect(() => {
    if (!word) {
      setData(null)
      return
    }
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    const qualities = Object.keys(quals).filter((q) => quals[q])
    api
      .searchRhymes(
        {
          word,
          qualities: qualities.length ? qualities : ['perfect'],
          includeIdentical: identical,
          minSyllables: minSyl ? Number(minSyl) : undefined,
          maxSyllables: maxSyl ? Number(maxSyl) : undefined,
          endings: ending ? [ending] : [],
          familiarity: fam,
          pos: pos || undefined,
          limit,
        },
        ctl.signal,
      )
      .then((r) => {
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setError(e instanceof ApiFail ? e : new ApiFail('Unexpected error.'))
        setLoading(false)
      })
    return () => ctl.abort()
  }, [word, quals, identical, minSyl, maxSyl, ending, fam, pos, limit, reload])

  function submit(e: FormEvent) {
    e.preventDefault()
    const w = typed.trim()
    if (w) {
      setWord(w)
      setLimit(60)
    }
  }

  async function saveCustom(
    w: string,
    body: { sounds_like?: string; phones?: string; note?: string },
  ) {
    setFormError('')
    try {
      await api.saveCustomPron(w, body)
      setSounds('')
      setRawPhones('')
      setReload((n) => n + 1)
      loadCustoms()
      onCustomChanged()
      toast(`Saved how you say “${w}”.`, 'success')
    } catch (e) {
      setFormError(e instanceof ApiFail ? e.message : 'Could not save that.')
    }
  }
  async function removeCustom(w: string) {
    try {
      await api.deleteCustomPron(w)
      setReload((n) => n + 1)
      loadCustoms()
      onCustomChanged()
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not remove that.', 'error')
    }
  }

  const info: WordInfo | null = data?.word ?? null
  const groups = new Map<number, RhymeResult[]>()
  data?.results.forEach((r) => groups.set(r.syllables, [...(groups.get(r.syllables) ?? []), r]))
  const unknown = info?.status === 'guess' && info.pronunciations.length === 0

  return (
    <div className="panel-body rhyme-panel">
      <form className="inline-form" onSubmit={submit}>
        <label htmlFor="rhyme-word" className="sr">
          Word to look up
        </label>
        <input
          id="rhyme-word"
          className="input input-sm"
          value={typed}
          placeholder="Type a word, or tap a line"
          maxLength={40}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!typed.trim()}>
          Look up
        </button>
      </form>
      <p className="hint">
        Tap a line, or select one word in a line, to look it up. Everything here works offline.
      </p>

      {error && (
        <div className="state state-error" role="alert">
          <p>
            {error.network
              ? 'Cannot reach the Studio Bars server. The rhyme tools run on it (no internet needed).'
              : error.message}
          </p>
          <button className="btn" onClick={() => setReload((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {info && (
        <div className="card" aria-label={`About ${info.word}`}>
          <b className="word-title">{info.word}</b>
          {info.pronunciations.map((p, i) => (
            <div key={i} className="pron-row">
              <span>
                <span className="ipa">/{p.ipa}/</span>{' '}
                <small title={p.phones}>
                  {plural(p.syllables)} · {dots(p.stress)}
                </small>
                <span className={`badge badge-${p.source}`}>
                  {p.source === 'dictionary' ? 'dictionary' : p.source}
                </span>
              </span>
              {info.ambiguous && p.source === 'dictionary' && (
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    void saveCustom(info.word, {
                      phones: p.phones,
                      note: 'Chosen from the dictionary versions.',
                    })
                  }
                  title="Always use this way of saying it"
                >
                  Use only this one
                </button>
              )}
            </div>
          ))}
          {info.ambiguous && (
            <small className="warn">
              This word can be said in {info.syllables_min} or {info.syllables_max} syllables, so
              syllable counts for lines using it show a range. Choose one to settle it.
            </small>
          )}
          {info.status === 'custom' && info.pronunciations.length > 0 && (
            <button className="btn btn-ghost" onClick={() => void removeCustom(info.word)}>
              Go back to the dictionary version
            </button>
          )}
        </div>
      )}

      {unknown && info && (
        <div className="card" role="group" aria-label="Add a pronunciation">
          <b>“{info.word}” is not in the dictionary</b>
          <small>
            I’m guessing {plural(info.syllables_min)} and can’t find rhymes yet. Tell me how you say
            it:
          </small>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (sounds.trim()) void saveCustom(info.word, { sounds_like: sounds.trim() })
            }}
          >
            <label htmlFor="sounds-like" className="sr">
              Sounds like this word
            </label>
            <input
              id="sounds-like"
              className="input input-sm"
              placeholder="Sounds like… (a word you know)"
              value={sounds}
              maxLength={40}
              onChange={(e) => setSounds(e.target.value)}
            />
            <button className="btn btn-primary" disabled={!sounds.trim()}>
              Use it
            </button>
          </form>
          <details>
            <summary>Or type the sounds (advanced)</summary>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (rawPhones.trim()) void saveCustom(info.word, { phones: rawPhones.trim() })
              }}
            >
              <label htmlFor="raw-phones" className="sr">
                Sounds
              </label>
              <input
                id="raw-phones"
                className="input input-sm"
                placeholder="Z AO1 R B L AE2 K S"
                value={rawPhones}
                onChange={(e) => setRawPhones(e.target.value)}
              />
              <button className="btn" disabled={!rawPhones.trim()}>
                Save sounds
              </button>
            </form>
            <small className="hint">
              Use sounds like B, R, OW1. Vowels need 1 (strong), 2 (medium) or 0 (weak).
            </small>
          </details>
          {formError && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
        </div>
      )}
      {!unknown && formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}

      {word && !unknown && (
        <>
          <fieldset className="filters">
            <legend>Find rhymes</legend>
            <div className="chips">
              {(['perfect', 'near', 'assonance', 'consonance'] as const).map((q) => (
                <label
                  key={q}
                  className={`chip chip-btn${quals[q] ? ' on' : ''}`}
                  title={status?.quality_help[q]}
                >
                  <input
                    type="checkbox"
                    className="sr"
                    checked={quals[q]}
                    onChange={(e) => {
                      setQuals({ ...quals, [q]: e.target.checked })
                      setLimit(60)
                    }}
                  />
                  {QUALITY_LABEL[q]}
                </label>
              ))}
            </div>
            <label className="check small">
              <input
                type="checkbox"
                checked={identical}
                onChange={(e) => setIdentical(e.target.checked)}
              />
              <span>
                Include words that sound the same or start the same (
                {status?.quality_help.homophone ? 'homophones, rich rhymes' : ''})
              </span>
            </label>
            <div className="row3">
              <label>
                Syllables from
                <select
                  className="input input-sm"
                  aria-label="Fewest syllables"
                  value={minSyl}
                  onChange={(e) => setMinSyl(e.target.value)}
                >
                  <option value="">any</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                to
                <select
                  className="input input-sm"
                  aria-label="Most syllables"
                  value={maxSyl}
                  onChange={(e) => setMaxSyl(e.target.value)}
                >
                  <option value="">any</option>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                Ending
                <select
                  className="input input-sm"
                  aria-label="Ending type"
                  value={ending}
                  onChange={(e) => setEnding(e.target.value)}
                >
                  <option value="">any</option>
                  <option value="masculine">on the beat (love)</option>
                  <option value="feminine">+1 soft syllable (lover)</option>
                  <option value="dactylic">+2 soft syllables</option>
                </select>
              </label>
            </div>
            <div className="row3">
              <label>
                Word familiarity
                <select
                  className="input input-sm"
                  aria-label="Word familiarity"
                  value={fam}
                  disabled={status !== null && !status.frequency_available}
                  onChange={(e) => setFam(e.target.value as typeof fam)}
                >
                  <option value="common">very common words</option>
                  <option value="familiar">common and familiar</option>
                  <option value="any">any word</option>
                </select>
              </label>
              <label>
                Usually a…
                <select
                  className="input input-sm"
                  aria-label="Part of speech"
                  value={pos}
                  disabled={status !== null && !status.pos_available}
                  onChange={(e) => {
                    setPos(e.target.value)
                    setLimit(60)
                  }}
                >
                  <option value="">any word</option>
                  <option value="noun">noun</option>
                  <option value="verb">verb</option>
                  <option value="adjective">adjective</option>
                  <option value="adverb">adverb</option>
                </select>
              </label>
            </div>
            {status && !status.frequency_available && (
              <small className="hint">
                Word-familiarity data is not installed, so results cannot be sorted or limited by
                how common a word is.
              </small>
            )}
            {status && !status.pos_available && (
              <small className="hint">
                Part-of-speech data is not available, so that filter is switched off.
              </small>
            )}
          </fieldset>

          {loading && (
            <p role="status" className="hint">
              Looking…
            </p>
          )}
          {!loading && data && data.results.length === 0 && !error && (
            <p className="hint">
              No rhymes found with these settings. Try “any word”, or add Near / Same vowels.
            </p>
          )}
          {data && data.total > 0 && (
            <p className="hint" aria-live="polite">
              {data.total} found
              {data.total > data.results.length ? `, showing ${data.results.length}` : ''}.
            </p>
          )}
          {[...groups.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([n, list]) => (
              <section key={n} aria-label={plural(n)}>
                <h3 className="rhead">{plural(n)}</h3>
                <div className="words">
                  {list.map((r) => (
                    <button
                      key={r.word}
                      className={`chip-word q-${r.quality}`}
                      title={`/${r.ipa}/ · ${dots(r.stress)} · ${status?.quality_help[r.quality] ?? r.quality}`}
                      onClick={() => {
                        setTyped(r.word)
                        setWord(r.word)
                        setLimit(60)
                      }}
                    >
                      {r.word}
                      {r.quality !== 'perfect' && (
                        <sup>{QUALITY_LABEL[r.quality] ?? r.quality}</sup>
                      )}
                      {r.custom && <sup>mine</sup>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          {data && data.total > data.results.length && (
            <button className="btn" onClick={() => setLimit((n) => n + 60)}>
              Show more
            </button>
          )}
          {data?.notes.map((n) => (
            <small key={n} className="hint">
              {n}
            </small>
          ))}
          <details className="customs">
            <summary>Online rhymes (optional)</summary>
            <OnlineResults word={word} kinds={['rhymes', 'near-rhymes']} />
          </details>
        </>
      )}

      <details className="customs">
        <summary>Your pronunciations ({customs.length})</summary>
        {customs.length === 0 && (
          <small className="hint">None yet. Words you teach the app appear here.</small>
        )}
        <ul className="notes">
          {customs.map((c) => (
            <li key={c.word}>
              <span>
                <b>{c.word}</b> <span className="ipa">/{c.ipa}/</span>{' '}
                <small>{plural(c.syllables)}</small>
                {c.note && (
                  <>
                    <br />
                    <small>{c.note}</small>
                  </>
                )}
              </span>
              <button
                className="btn btn-ghost"
                aria-label={`Remove my pronunciation of ${c.word}`}
                onClick={() => void removeCustom(c.word)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </details>
      <small className="hint">
        {status?.attribution ?? 'Pronunciations: CMU Pronouncing Dictionary.'}
      </small>
    </div>
  )
}

/** The Rhymes tab: one word at a time (works offline), or a whole phrase (experimental). */
export function RhymePanel(props: Props) {
  const [mode, setMode] = useState<'word' | 'phrase'>('word')
  const [phrase, setPhrase] = useState<{ phrase: string; nonce: number } | null>(null)
  const { phraseRequest, onPhraseHandled } = props
  useEffect(() => {
    if (phraseRequest?.phrase) {
      setMode('phrase')
      setPhrase(phraseRequest)
      onPhraseHandled?.()
    }
  }, [phraseRequest, onPhraseHandled])
  return (
    <div className="panel-body">
      <div className="seg" role="tablist" aria-label="Rhyme mode">
        <button
          role="tab"
          aria-selected={mode === 'word'}
          className={mode === 'word' ? 'on' : ''}
          onClick={() => setMode('word')}
        >
          One word
        </button>
        <button
          role="tab"
          aria-selected={mode === 'phrase'}
          className={mode === 'phrase' ? 'on' : ''}
          onClick={() => setMode('phrase')}
        >
          Phrase (experimental)
        </button>
      </div>
      {mode === 'word' ? <WordRhymes {...props} /> : <PhraseRhymePane request={phrase} />}
    </div>
  )
}
