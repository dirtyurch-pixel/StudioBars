import { useCallback, useReducer, useRef } from 'react'
import type { Content } from '../types'
import { lockViolations, mergeServerMeta } from './content'

type State = { past: Content[]; present: Content; future: Content[] }
type Action =
  | { type: 'commit'; next: Content; coalesce: boolean }
  | { type: 'undo'; next: Content }
  | { type: 'redo'; next: Content }
  | { type: 'patch'; fn: (c: Content) => Content }
  | { type: 'reset'; next: Content }

const LIMIT = 200

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'commit':
      if (a.next === s.present) return s
      return a.coalesce && s.past.length
        ? { past: s.past, present: a.next, future: [] }
        : { past: [...s.past, s.present].slice(-LIMIT), present: a.next, future: [] }
    case 'undo':
      return { past: s.past.slice(0, -1), present: a.next, future: [s.present, ...s.future] }
    case 'redo':
      return { past: [...s.past, s.present], present: a.next, future: s.future.slice(1) }
    case 'patch':
      return { ...s, present: a.fn(s.present) }
    case 'reset':
      return { past: [], present: a.next, future: [] }
  }
}

export type UndoResult = 'ok' | 'empty' | { blocked: string[] }

/**
 * Song-level undo/redo. Lock state always comes from the present, and an undo
 * or redo that would change a locked line is refused.
 */
export function useHistory(initial: Content) {
  const [state, dispatch] = useReducer(reducer, { past: [], present: initial, future: [] })
  const lastKey = useRef<{ key: string; at: number } | null>(null)

  const commit = useCallback((next: Content, key?: string) => {
    const t = Date.now()
    const prev = lastKey.current
    const coalesce = !!key && !!prev && prev.key === key && t - prev.at < 1000
    lastKey.current = key ? { key, at: t } : null
    dispatch({ type: 'commit', next, coalesce })
  }, [])

  const step = (kind: 'undo' | 'redo'): UndoResult => {
    const stack = kind === 'undo' ? state.past : state.future
    if (!stack.length) return 'empty'
    const target = kind === 'undo' ? stack[stack.length - 1] : stack[0]
    const next = mergeServerMeta(target, state.present)
    const bad = lockViolations(state.present, next)
    if (bad.length) return { blocked: bad }
    lastKey.current = null
    dispatch({ type: kind, next })
    return 'ok'
  }

  return {
    content: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    undo: () => step('undo'),
    redo: () => step('redo'),
    patch: useCallback((fn: (c: Content) => Content) => dispatch({ type: 'patch', fn }), []),
    reset: useCallback((next: Content) => {
      lastKey.current = null
      dispatch({ type: 'reset', next })
    }, []),
  }
}
