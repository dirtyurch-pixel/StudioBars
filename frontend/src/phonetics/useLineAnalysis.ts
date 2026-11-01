import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeLines } from '../api'
import type { Analysis, AnalyzedWord, Line, LineSyllables, RhymeFamily } from '../types'

export type LineResult = { text: string; syllables: LineSyllables; words: AnalyzedWord[] }
export type AnalysisState = {
  byId: Map<string, LineResult>
  families: RhymeFamily[]
  unknown: string[]
  failed: boolean
}

const EMPTY: AnalysisState = { byId: new Map(), families: [], unknown: [], failed: false }

/**
 * Counts syllables and finds rhyme families for the lines on screen.
 * Waits for a short pause in typing, cancels outdated requests, and keeps the last good
 * answer if the server cannot be reached.
 */
export function useLineAnalysis(lines: Line[], refresh: number, delay = 350): AnalysisState {
  const [state, setState] = useState<AnalysisState>(EMPTY)
  const first = useRef(true)
  const key = useMemo(() => lines.map((l) => `${l.id}\u0000${l.text}`).join('\u0001'), [lines])

  useEffect(() => {
    const ctl = new AbortController()
    const snapshot = lines.slice(0, 300)
    const texts = snapshot.map((l) => l.text)
    const run = async () => {
      try {
        const res: Analysis = await analyzeLines(texts, ctl.signal)
        if (ctl.signal.aborted) return
        const byId = new Map<string, LineResult>()
        snapshot.forEach((l, i) => {
          const r = res.lines[i]
          if (r) byId.set(l.id, { text: texts[i], syllables: r.syllables, words: r.words })
        })
        setState({ byId, families: res.families, unknown: res.unknown_words, failed: false })
      } catch (e) {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setState((s) => ({ ...s, failed: true }))
      }
    }
    const wait = first.current ? 0 : delay
    first.current = false
    const t = setTimeout(run, wait)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
    // `lines` is represented by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh, delay])

  return state
}
