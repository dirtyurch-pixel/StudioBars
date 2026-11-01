import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, Line } from '../types'
import { useLineAnalysis } from './useLineAnalysis'

const api = vi.hoisted(() => ({ analyzeLines: vi.fn() }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const line = (id: string, text: string): Line => ({ id, text, is_locked: false, comments: [] })
const result = (n: number): Analysis => ({
  lines: Array.from({ length: n }, (_, i) => ({
    syllables: { min: i + 1, max: i + 1, exact: true, guessed: false },
    words: [],
  })),
  families: [],
  unknown_words: [],
})
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
})
afterEach(() => vi.useRealTimers())

describe('useLineAnalysis', () => {
  it('analyses straight away on first load and maps results to line ids', async () => {
    api.analyzeLines.mockResolvedValue(result(2))
    const { result: r } = renderHook(() => useLineAnalysis([line('a', 'one'), line('b', 'two')], 0))
    await tick(10)
    expect(api.analyzeLines).toHaveBeenCalledWith(['one', 'two'], expect.anything())
    expect(r.current.byId.get('b')).toMatchObject({ text: 'two', syllables: { min: 2 } })
  })

  it('waits for a pause in typing before asking again', async () => {
    api.analyzeLines.mockResolvedValue(result(1))
    const { rerender } = renderHook(({ t }) => useLineAnalysis([line('a', t)], 0), {
      initialProps: { t: 'a' },
    })
    await tick(10)
    api.analyzeLines.mockClear()
    for (const t of ['ab', 'abc', 'abcd']) {
      rerender({ t })
      await tick(100)
    }
    expect(api.analyzeLines).not.toHaveBeenCalled()
    await tick(400)
    expect(api.analyzeLines).toHaveBeenCalledTimes(1)
    expect(api.analyzeLines).toHaveBeenCalledWith(['abcd'], expect.anything())
  })

  it('throws away an answer that arrives after the text has moved on', async () => {
    let resolveFirst: (a: Analysis) => void = () => {}
    api.analyzeLines.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = res
        }),
    )
    api.analyzeLines.mockResolvedValue(result(1))
    const { result: r, rerender } = renderHook(({ t }) => useLineAnalysis([line('a', t)], 0), {
      initialProps: { t: 'old' },
    })
    await tick(10)
    rerender({ t: 'new' })
    await tick(400)
    await act(async () => resolveFirst({ ...result(1), unknown_words: ['stale'] }))
    expect(r.current.byId.get('a')?.text).toBe('new')
    expect(r.current.unknown).toEqual([])
  })

  it('keeps the last good answer and reports failure when the server is unreachable', async () => {
    api.analyzeLines.mockResolvedValueOnce(result(1)).mockRejectedValue(new Error('down'))
    const { result: r, rerender } = renderHook(({ t }) => useLineAnalysis([line('a', t)], 0), {
      initialProps: { t: 'x' },
    })
    await tick(10)
    rerender({ t: 'xy' })
    await tick(400)
    expect(r.current.failed).toBe(true)
    expect(r.current.byId.get('a')?.text).toBe('x') // still there, and the pad knows it is stale
  })

  it('re-analyses when asked to refresh without any text change', async () => {
    api.analyzeLines.mockResolvedValue(result(1))
    const { rerender } = renderHook(({ n }) => useLineAnalysis([line('a', 'same')], n), {
      initialProps: { n: 0 },
    })
    await tick(10)
    rerender({ n: 1 })
    await tick(400)
    expect(api.analyzeLines).toHaveBeenCalledTimes(2)
  })
})
