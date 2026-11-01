import { useCallback, useState } from 'react'
import type { HighlightMode, SyllableDisplay } from './highlight'

const KEY = 'studiobars.padSettings'
type Saved = { syllableDisplay: SyllableDisplay; highlight: HighlightMode }
const DEFAULT: Saved = { syllableDisplay: 'syllables', highlight: 'end' }

function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      syllableDisplay: v.syllableDisplay === 'numbers' ? 'numbers' : 'syllables',
      highlight: ['off', 'end', 'all'].includes(v.highlight) ? v.highlight : DEFAULT.highlight,
    }
  } catch {
    return DEFAULT
  }
}

/** Display choices, remembered on this device only. */
export function usePadSettings() {
  const [s, setS] = useState<Saved>(read)
  const update = useCallback((patch: Partial<Saved>) => {
    setS((cur) => {
      const next = { ...cur, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* just not remembered */
      }
      return next
    })
  }, [])
  return { ...s, update }
}
