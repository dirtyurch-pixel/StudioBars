import { useEffect, useState } from 'react'
import * as api from '../api'
import type { RhymeResult } from '../types'

const DEBOUNCE_MS = 250
const cache = new Map<string, RhymeResult[]>()

/**
 * Rhymes for the line you are rhyming with, right above the line toolbar. It follows you as you move from
 * line to line, so you never have to open the Rhymes tool while writing. Tapping a word adds it at the cursor.
 */
export function RhymeStrip({
  word,
  disabled,
  onPick,
}: {
  word: string
  disabled: boolean
  onPick: (w: string) => void
}) {
  const key = word.toLowerCase()
  const [res, setRes] = useState<{ key: string; words: RhymeResult[] | null }>({
    key: '',
    words: null,
  })

  useEffect(() => {
    if (!key) return
    const hit = cache.get(key)
    if (hit) {
      setRes({ key, words: hit })
      return
    }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      api
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
        .then(
          (r) => {
            cache.set(key, r.results)
            if (cache.size > 60) cache.delete(cache.keys().next().value as string)
            setRes({ key, words: r.results })
          },
          () => !ctl.signal.aborted && setRes({ key, words: [] }),
        )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [key])

  if (!key) return null
  const words = res.key === key ? res.words : null
  return (
    <div className="rhyme-strip" role="group" aria-label={`Rhymes for ${word}`}>
      <span className="rs-label">
        Rhymes for <b>{word}</b>
      </span>
      {words === null ? (
        <span className="rs-note">Finding…</span>
      ) : words.length === 0 ? (
        <span className="rs-note">No rhymes found</span>
      ) : (
        words.map((r) => (
          <button
            key={r.word}
            type="button"
            className={`rs-word${r.quality === 'perfect' ? ' perfect' : ''}`}
            disabled={disabled}
            title={`${r.quality} rhyme, ${r.syllables} syllable${r.syllables === 1 ? '' : 's'}`}
            onClick={() => onPick(r.word)}
          >
            {r.word}
          </button>
        ))
      )}
    </div>
  )
}
