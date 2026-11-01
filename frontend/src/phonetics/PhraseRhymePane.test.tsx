import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import type { PhraseRhymes } from '../types'
import { PhraseRhymePane } from './PhraseRhymePane'

const api = vi.hoisted(() => ({ phraseRhymes: vi.fn() }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const result = (over: Partial<PhraseRhymes> = {}): PhraseRhymes => ({
  phrase: 'pay attention',
  syllables: 2,
  tail_ipa: 'ɛnʃʌn',
  experimental: true,
  total: 3,
  notes: ['Experimental: this compares the last sounds.'],
  results: [
    { text: 'no attention', kind: 'mine', quality: 'perfect', ipa: 'x', syllables: 4 },
    { text: 'tension', kind: 'word', quality: 'perfect', ipa: 'x', syllables: 2 },
    { text: 'expense', kind: 'word', quality: 'assonance', ipa: 'x', syllables: 2 },
  ],
  ...over,
}) // fmt: skip

beforeEach(() => {
  vi.resetAllMocks()
  api.phraseRhymes.mockResolvedValue(result())
})

describe('PhraseRhymePane (experimental)', () => {
  it('is labelled experimental before it does anything', () => {
    render(<PhraseRhymePane request={null} />)
    expect(screen.getByRole('note')).toHaveTextContent(/Experimental/)
    expect(api.phraseRhymes).not.toHaveBeenCalled()
  })

  it('searches the phrase from the phrase bank and marks your own entries', async () => {
    render(<PhraseRhymePane request={{ phrase: 'pay attention', nonce: 1 }} />)
    expect(await screen.findByText('tension')).toBeInTheDocument()
    expect(api.phraseRhymes).toHaveBeenCalledWith(
      'pay attention',
      2,
      ['perfect', 'near'],
      expect.anything(),
    )
    expect(screen.getByText('no attention').closest('span')).toHaveTextContent('mine')
    expect(screen.getByText('expense').closest('span')).toHaveTextContent('Same vowels')
    expect(screen.getByText(/Matching the last 2 syllables/)).toBeInTheDocument()
  })

  it('changing the depth or the types asks again', async () => {
    render(<PhraseRhymePane request={{ phrase: 'pay attention', nonce: 1 }} />)
    await screen.findByText('tension')
    fireEvent.change(screen.getByLabelText('Syllables to match'), { target: { value: '3' } })
    await waitFor(() =>
      expect(api.phraseRhymes).toHaveBeenLastCalledWith(
        'pay attention',
        3,
        ['perfect', 'near'],
        expect.anything(),
      ),
    )
    fireEvent.click(screen.getByLabelText('Same vowels'))
    await waitFor(() =>
      expect(api.phraseRhymes).toHaveBeenLastCalledWith(
        'pay attention',
        3,
        ['perfect', 'near', 'assonance'],
        expect.anything(),
      ),
    )
  })

  it('explains which words need teaching when a phrase has unknown words', async () => {
    api.phraseRhymes.mockRejectedValue(
      new ApiFail(
        'I don’t know how these sound yet: zorblax. Teach them in the Rhymes tab first.',
        { status: 422, code: 'UNKNOWN_WORDS' },
      ),
    )
    render(<PhraseRhymePane request={{ phrase: 'zorblax fade', nonce: 1 }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/zorblax/)
  })

  it('says when nothing matched and what to try', async () => {
    api.phraseRhymes.mockResolvedValue(result({ results: [], total: 0 }))
    render(<PhraseRhymePane request={{ phrase: 'odd phrase', nonce: 1 }} />)
    expect(await screen.findByText(/Nothing matched/)).toBeInTheDocument()
  })
})
