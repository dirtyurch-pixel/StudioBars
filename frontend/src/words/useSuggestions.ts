import { useEffect, useState } from 'react'
import { suggestWords } from '../api'

/** Suggestions for a lookup box, asked for only after a 300 ms pause in typing. */
export function useSuggestions(text: string, delay = 300): string[] {
  const [items, setItems] = useState<string[]>([])
  useEffect(() => {
    let live = true
    if (text.trim().length < 2) {
      setItems([])
      return
    }
    const t = setTimeout(() => {
      void suggestWords(text).then(
        (r) => live && setItems(r.filter((w) => w.toLowerCase() !== text.trim().toLowerCase())),
      )
    }, delay)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [text, delay])
  return items
}
