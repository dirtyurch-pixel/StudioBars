import { useEffect, useState, type FormEvent } from 'react'
import * as api from '../api'
import { LOCAL } from '../api'
import { ApiFail } from '../api'
import type { Chip, Meanings, Sense, Synonym, WordInfo } from '../types'
import { OnlineResults } from './OnlineHelper'
import { PhraseBank } from './PhraseBank'

type Props = {
  suggested: { word: string; nonce: number } | null
  /** The line being written, and the lines beside it: used only to order meanings by what fits. */
  context: string
  around?: string
  /** Changes when the user moves to another line (so context is applied immediately). */
  contextKey?: string
  onLookup: (word: string) => void
  onOpenRhymes: (word: string) => void
  onPhraseRhymes: (phrase: string) => void
}

const SHOWN = 4

function ChipRow({
  label,
  items,
  onPick,
  title,
}: {
  label: string
  items: (Chip | Synonym)[]
  onPick: (w: string) => void
  title?: string
}) {
  if (!items.length) return null
  return (
    <div className="chip-row">
      <span className="chip-label" title={title}>
        {label}
      </span>
      <div className="words">
        {items.map((c) => {
          const shift = 'shift' in c ? c.shift : undefined
          return (
            <button
              key={c.word}
              className={`chip-word${shift ? ' shifty' : ''}`}
              onClick={() => onPick(c.word)}
              title={
                shift
                  ? `Careful: “${c.word}” usually means “${shift.usually_means}”. This meaning is its #${shift.rank} of ${shift.of}.`
                  : 'Look this word up'
              }
            >
              {c.word}
              {shift && <sup aria-label="meaning may change"> ⚠</sup>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SenseCard({ s, onPick }: { s: Sense; onPick: (w: string) => void }) {
  return (
    <article
      className={`sense${s.fit?.best ? ' best' : ''}`}
      aria-label={`${s.pos_label} meaning ${s.sense_no}`}
    >
      <header>
        <span className="pos">{s.pos_label}</span>
        <span className="hint">
          meaning {s.sense_no} of {s.of}
        </span>
        {s.fit?.best && (
          <span className="badge badge-custom" title="Words in your line overlap with this meaning">
            Fits your line
          </span>
        )}
        {s.fit && !s.fit.best && s.fit.score > 0 && (
          <span className="badge" title="Words in your line overlap with this meaning">
            May fit
          </span>
        )}
      </header>
      <p className="def">{s.definition}</p>
      {s.fit && s.fit.matched.length > 0 && (
        <small className="hint">
          Matches your line on: {s.fit.matched.join(', ')} (word overlap only, not understanding)
        </small>
      )}
      {s.examples.map((ex) => (
        <p key={ex} className="example">
          “{ex}”
        </p>
      ))}
      {s.said_as && (
        <p className="said" role="note">
          In this meaning it is said <span className="ipa">/{s.said_as.ipa}/</span>
        </p>
      )}
      <ChipRow
        label="Same meaning"
        items={s.synonyms}
        onPick={onPick}
        title="Other words WordNet lists for exactly this meaning"
      />
      <ChipRow
        label="Close in meaning"
        items={s.similar}
        onPick={onPick}
        title="Similar, not identical"
      />
      <ChipRow label="Opposite" items={s.antonyms} onPick={onPick} />
      <ChipRow label="A kind of" items={s.broader} onPick={onPick} />
      <ChipRow label="Kinds of it" items={s.narrower} onPick={onPick} />
      <ChipRow label="Related" items={s.related} onPick={onPick} />
      <ChipRow label="Imagery: parts and make-up" items={s.imagery} onPick={onPick} />
    </article>
  )
}

/**
 * Text that changes with every keystroke is only acted on after a short pause. But when the
 * `key` changes (the user moved to a different line) the new text applies at once, so a new word is
 * never looked up with the previous line's text.
 */
function useSettled(value: string, key: string, ms = 500): string {
  const [settled, setSettled] = useState({ key, value })
  useEffect(() => {
    if (settled.key !== key) {
      setSettled({ key, value })
      return
    }
    const t = setTimeout(() => setSettled({ key, value }), ms)
    return () => clearTimeout(t)
  }, [key, value, settled.key, ms])
  return settled.key === key ? settled.value : value
}

export function WordsPanel({
  suggested,
  context: liveContext,
  around: liveAround = '',
  contextKey = '',
  onLookup,
  onOpenRhymes,
  onPhraseRhymes,
}: Props) {
  const context = useSettled(liveContext, contextKey)
  const around = useSettled(liveAround, contextKey)
  const [view, setView] = useState<'meanings' | 'phrases' | 'online'>('meanings')
  const [typed, setTyped] = useState('')
  const [word, setWord] = useState('')
  const [data, setData] = useState<Meanings | null>(null)
  const [sound, setSound] = useState<WordInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiFail | null>(null)
  const [pos, setPos] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (suggested?.word) {
      setTyped(suggested.word)
      setWord(suggested.word)
      setShowAll(false)
      setPos('')
    }
  }, [suggested])

  useEffect(() => {
    if (!word || view === 'phrases') return
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([
      api.getMeanings(word, context, around, ctl.signal),
      api.lookupWord(word, ctl.signal).catch(() => null),
    ])
      .then(([m, w]) => {
        setData(m)
        setSound(w)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setError(e instanceof ApiFail ? e : new ApiFail('Unexpected error.'))
        setLoading(false)
      })
    return () => ctl.abort()
  }, [word, context, around, view, retry])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (typed.trim()) {
      setWord(typed.trim())
      setShowAll(false)
      setPos('')
    }
  }
  const pick = (w: string) => {
    setTyped(w)
    setWord(w)
    setShowAll(false)
    setPos('')
    onLookup(w)
  }

  const senses = (data?.senses ?? []).filter((s) => !pos || s.pos_label === pos)
  const visible = showAll ? senses : senses.slice(0, SHOWN)

  return (
    <div className="panel-body words-panel">
      <div className="seg" role="tablist" aria-label="Word tools">
        {(
          [
            ['meanings', 'Meanings'],
            ['phrases', 'My phrases'],
            ['online', 'Online ideas'],
          ] as const
        )
          .filter(([k]) => !(LOCAL && k === 'online')) // the phone version works offline only
          .map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              className={view === k ? 'on' : ''}
              onClick={() => setView(k)}
            >
              {label}
            </button>
          ))}
      </div>

      {view !== 'phrases' && (
        <form className="inline-form" onSubmit={submit}>
          <label htmlFor="words-word" className="sr">
            Word to look up
          </label>
          <input
            id="words-word"
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
      )}

      {view === 'meanings' && (
        <>
          <p className="hint source-note">
            Dictionary facts from <b>WordNet</b> (Princeton University). These are not AI
            suggestions, and everything works offline.
          </p>
          {error && (
            <div className="state state-error" role="alert">
              <p>
                {error.network
                  ? 'Cannot reach the Studio Bars server. The word tools run on it (no internet needed).'
                  : error.message}
              </p>
              <button className="btn" onClick={() => setRetry((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {loading && (
            <p role="status" className="hint">
              Looking…
            </p>
          )}
          {!word && !loading && (
            <p className="hint">Tap a line, or select a word, to see what it can mean.</p>
          )}
          {data && (
            <div aria-busy={loading} className={loading ? 'updating' : undefined}>
              <div className="card" aria-label={`About ${data.word}`}>
                <div className="pron-row">
                  <b className="word-title">{data.word}</b>
                  <button className="btn btn-ghost" onClick={() => onOpenRhymes(data.word)}>
                    Find rhymes ↗
                  </button>
                </div>
                {sound && sound.pronunciations.length > 0 && (
                  <span>
                    {sound.pronunciations.slice(0, 3).map((p, i) => (
                      <span key={i} className="ipa">
                        /{p.ipa}/{' '}
                      </span>
                    ))}
                    <small className="hint">
                      {sound.ambiguous
                        ? `${sound.syllables_min}–${sound.syllables_max}`
                        : sound.syllables_min}{' '}
                      syllables
                    </small>
                  </span>
                )}
                {data.forms.length > 0 && data.forms[0] !== data.word && (
                  <small className="hint">Base form: {data.forms.join(', ')}</small>
                )}
              </div>
              {data.notes.map((n) => (
                <p key={n} className="hint" role="status">
                  {n}
                </p>
              ))}
              {data.context_used && data.reordered && (
                <p className="hint">
                  Meanings are ordered by what fits your line, then by how common they are.
                </p>
              )}
              {data.found && (
                <>
                  <div className="chips" role="group" aria-label="Part of speech">
                    <button
                      className={`chip chip-btn${pos === '' ? ' on' : ''}`}
                      aria-pressed={pos === ''}
                      onClick={() => setPos('')}
                    >
                      All ({data.total_senses})
                    </button>
                    {Object.entries(data.pos_counts).map(([label, n]) => (
                      <button
                        key={label}
                        className={`chip chip-btn${pos === label ? ' on' : ''}`}
                        aria-pressed={pos === label}
                        onClick={() => {
                          setPos(label)
                          setShowAll(false)
                        }}
                      >
                        {label} ({n})
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    ⚠ marks a word that usually means something else, so check it fits before using
                    it.
                  </p>
                  {visible.map((s) => (
                    <SenseCard key={s.id + s.sense_no} s={s} onPick={pick} />
                  ))}
                  {senses.length > SHOWN && (
                    <button className="btn" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Show fewer meanings' : `Show all ${senses.length} meanings`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <small className="hint">Meanings and relations: WordNet 3.0, Princeton University.</small>
        </>
      )}

      {view === 'phrases' && <PhraseBank onLookup={pick} onPhraseRhymes={onPhraseRhymes} />}

      {view === 'online' && <OnlineResults word={word} kinds={['related', 'associated']} />}
    </div>
  )
}
