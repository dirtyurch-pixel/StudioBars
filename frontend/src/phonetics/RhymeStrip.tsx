import { useEffect, useState } from 'react'
import * as api from '../api'
import { lastWord } from './highlight'

const DEBOUNCE_MS = 250
type Hit = { word: string; perfect: boolean; title: string }
const cache = new Map<string, Hit[]>()

/**
 * Rhymes right above the line toolbar. By default for the line above (the one you are rhyming with); tap the
 * label to switch to this line. It follows you from line to line, so you never have to open the Rhymes tool while writing. Tapping a word adds it at the cursor.
 */
export function RhymeStrip({
  aboveText,
  thisText,
  disabled,
  onPick,
}: {
  aboveText: string
  thisText: string
  disabled: boolean
  onPick: (w: string) => void
}) {
  const [useThis, setUseThis] = useState(false)
  const hasAbove = !!lastWord(aboveText)
  const fromThis = useThis || !hasAbove
  const text = fromThis ? thisText : aboveText
  const word = lastWord(text)
  const key = word.toLowerCase()
  const [res, setRes] = useState<{ key: string; hits: Hit[] | null }>({ key: '', hits: null })

  useEffect(() => {
    if (!key) return
    const hit = cache.get(key)
    if (hit) {
      setRes({ key, hits: hit })
      return
    }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      const got: Promise<Hit[]> = api
        .searchRhymes(
          {
            word: key,
            qualities: ['perfect', 'near'],
            includeIdentical: false,
            endings: [],
            familiarity: 'familiar',
            limit: 30,
          },
          ctl.signal,
        )
        .then((r) =>
          r.results.map((x) => ({
            word: x.word,
            perfect: x.quality === 'perfect',
            title: `${x.quality} rhyme, ${x.syllables} syllable${x.syllables === 1 ? '' : 's'}`,
          })),
        )
      got.then(
        (hits) => {
          cache.set(key, hits)
          if (cache.size > 80) cache.delete(cache.keys().next().value as string)
          setRes({ key, hits })
        },
        () => !ctl.signal.aborted && setRes({ key, hits: [] }),
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [key])

  if (!word) return null
  const hits = res.key === key ? res.hits : null
  return (
    <div className="rhyme-strip" role="group" aria-label={`Rhymes for ${word}`}>
      <button
        type="button"
        className="rs-label"
        disabled={!hasAbove}
        onClick={() => setUseThis((v) => !v)}
        aria-label={
          fromThis
            ? 'Rhyming with this line. Tap to rhyme with the line above.'
            : 'Rhyming with the line above. Tap to rhyme with this line.'
        }
      >
        <small>{fromThis ? 'This line' : 'Line above'}</small>
        <b>{word}</b>
      </button>
      {hits === null ? (
        <span className="rs-note">Finding…</span>
      ) : hits.length === 0 ? (
        <span className="rs-note">No rhymes found</span>
      ) : (
        hits.map((h) => (
          <button
            key={h.word}
            type="button"
            className={`rs-word${h.perfect ? ' perfect' : ''}`}
            disabled={disabled}
            title={h.title}
            onClick={() => onPick(h.word)}
          >
            {h.word}
          </button>
        ))
      )}
    </div>
  )
}
