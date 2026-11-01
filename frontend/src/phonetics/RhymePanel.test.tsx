import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { ToastProvider } from '../components/Toasts'
import type { PhoneticsStatus, RhymeResponse, WordInfo } from '../types'
import { RhymePanel } from './RhymePanel'

const api = vi.hoisted(() => ({
  getPhoneticsStatus: vi.fn(),
  searchRhymes: vi.fn(),
  listCustomPron: vi.fn(),
  saveCustomPron: vi.fn(),
  deleteCustomPron: vi.fn(),
  getOnlineStatus: vi.fn(),
  phraseRhymes: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const status = (over: Partial<PhoneticsStatus> = {}): PhoneticsStatus => ({
  dictionary_words: 126052,
  frequency_available: true,
  pos_available: true,
  custom_count: 0,
  quality_help: {
    homophone: 'Sounds exactly the same.',
    rich: 'Rich.',
    perfect: 'Perfect help.',
    near: 'Near help.',
    assonance: 'A.',
    consonance: 'C.',
  },
  attribution: 'Pronunciations: CMU Pronouncing Dictionary (Carnegie Mellon University).',
  ...over,
}) // fmt: skip
const info = (over: Partial<WordInfo> = {}): WordInfo => ({
  word: 'fade',
  status: 'known',
  pronunciations: [
    { phones: 'F EY1 D', ipa: 'fˈeɪd', syllables: 1, stress: '1', source: 'dictionary' },
  ],
  syllables_min: 1,
  syllables_max: 1,
  ambiguous: false,
  note: '',
  ...over,
}) // fmt: skip
const res = (word: string, syllables: number, quality = 'perfect') => ({
  word,
  ipa: word,
  syllables,
  stress: '1',
  ending: 'masculine' as const,
  quality: quality as 'perfect',
  zipf: 5,
  custom: false,
}) // fmt: skip
const response = (over: Partial<RhymeResponse> = {}): RhymeResponse => ({
  word: info(),
  total: 3,
  notes: [
    'Part-of-speech filtering is not available yet: it needs the word-meaning data planned for Phase 3.',
  ],
  results: [res('made', 1), res('shade', 1), res('decade', 2)],
  ...over,
}) // fmt: skip

function show(
  suggested: { word: string; nonce: number } | null = { word: 'fade', nonce: 1 },
  onCustomChanged = vi.fn(),
) {
  render(
    <ToastProvider>
      <RhymePanel suggested={suggested} onCustomChanged={onCustomChanged} />
    </ToastProvider>,
  )
  return onCustomChanged
}

beforeEach(() => {
  vi.resetAllMocks()
  api.getPhoneticsStatus.mockResolvedValue(status())
  api.searchRhymes.mockResolvedValue(response())
  api.listCustomPron.mockResolvedValue([])
  api.getOnlineStatus.mockResolvedValue({
    enabled: false,
    service: 'Datamuse',
    host: 'api.datamuse.com',
    cached_answers: 0,
    sends: 'x',
    key_notice: 'y',
  })
  api.phraseRhymes.mockResolvedValue({
    phrase: 'p',
    syllables: 2,
    tail_ipa: 'x',
    experimental: true,
    notes: [],
    total: 0,
    results: [],
  })
})

describe('RhymePanel', () => {
  it('looks up the suggested word and groups rhymes by syllable count', async () => {
    show()
    expect(await screen.findByText('shade')).toBeInTheDocument()
    expect(api.searchRhymes).toHaveBeenCalledWith(
      expect.objectContaining({
        word: 'fade',
        qualities: ['perfect', 'near'],
        familiarity: 'familiar',
      }),
      expect.anything(),
    )
    const one = screen.getByRole('region', { name: '1 syllable' })
    expect(within(one).getByText('made')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: '2 syllables' })).getByText('decade'),
    ).toBeInTheDocument()
    expect(screen.getByText(/3 found/)).toBeInTheDocument()
  })

  it('shows how the word sounds', async () => {
    show()
    const card = await screen.findByLabelText('About fade')
    expect(within(card).getByText('/fˈeɪd/')).toBeInTheDocument()
    expect(within(card).getByText(/1 syllable/)).toBeInTheDocument()
  })

  it('labels near rhymes so they are not mistaken for perfect ones', async () => {
    api.searchRhymes.mockResolvedValue(
      response({ results: [res('made', 1), res('late', 1, 'near')] }),
    )
    show()
    expect(await screen.findByText('late')).toBeInTheDocument()
    expect(screen.getByText('late').closest('button')).toHaveClass('q-near')
    expect(
      within(screen.getByText('late').closest('button') as HTMLElement).getByText('Near'),
    ).toBeInTheDocument()
  })

  it('clicking a rhyme looks that word up', async () => {
    show()
    fireEvent.click(await screen.findByText('shade'))
    await waitFor(() =>
      expect(api.searchRhymes).toHaveBeenLastCalledWith(
        expect.objectContaining({ word: 'shade' }),
        expect.anything(),
      ),
    )
    expect(screen.getByLabelText('Word to look up')).toHaveValue('shade')
  })

  it('changing a filter searches again with it', async () => {
    show()
    await screen.findByText('shade')
    fireEvent.click(screen.getByLabelText(/Same vowels/))
    fireEvent.change(screen.getByLabelText('Fewest syllables'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Ending type'), { target: { value: 'feminine' } })
    fireEvent.change(screen.getByLabelText('Word familiarity'), { target: { value: 'any' } })
    await waitFor(() =>
      expect(api.searchRhymes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          qualities: ['perfect', 'near', 'assonance'],
          minSyllables: 2,
          endings: ['feminine'],
          familiarity: 'any',
        }),
        expect.anything(),
      ),
    )
  })

  it('explains the filters whose data is missing instead of hiding them', async () => {
    api.getPhoneticsStatus.mockResolvedValue(
      status({ frequency_available: false, pos_available: false }),
    )
    show()
    await screen.findByText('shade')
    expect(screen.getByLabelText('Part of speech')).toBeDisabled()
    expect(screen.getByLabelText('Word familiarity')).toBeDisabled()
    expect(screen.getByText(/familiarity data is not installed/i)).toBeInTheDocument()
    expect(screen.getByText(/Part-of-speech data is not available/)).toBeInTheDocument()
  })

  it('filters rhymes by part of speech using WordNet', async () => {
    show()
    await screen.findByText('shade')
    expect(screen.getByLabelText('Part of speech')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Part of speech'), { target: { value: 'noun' } })
    await waitFor(() =>
      expect(api.searchRhymes).toHaveBeenLastCalledWith(
        expect.objectContaining({ pos: 'noun' }),
        expect.anything(),
      ),
    )
    fireEvent.change(screen.getByLabelText('Part of speech'), { target: { value: '' } })
    await waitFor(() =>
      expect(api.searchRhymes).toHaveBeenLastCalledWith(
        expect.objectContaining({ pos: undefined }),
        expect.anything(),
      ),
    )
  })

  it('keeps online rhymes optional and off the main path', async () => {
    show()
    await screen.findByText('shade')
    fireEvent.click(screen.getByText(/Online rhymes \(optional\)/))
    const box = await screen.findByRole('checkbox', { name: /Use the online word helper/ })
    expect(box).not.toBeChecked()
  })

  it('switches to the experimental phrase mode, and a phrase from the bank opens it', async () => {
    const { rerender } = render(
      <ToastProvider>
        <RhymePanel suggested={null} onCustomChanged={vi.fn()} />
      </ToastProvider>,
    )
    expect(screen.getByRole('tab', { name: 'One word' })).toHaveAttribute('aria-selected', 'true')
    rerender(
      <ToastProvider>
        <RhymePanel
          suggested={null}
          phraseRequest={{ phrase: 'pay attention', nonce: 1 }}
          onCustomChanged={vi.fn()}
        />
      </ToastProvider>,
    )
    expect(await screen.findByRole('note')).toHaveTextContent(/Experimental/)
    expect(screen.getByRole('tab', { name: /Phrase/ })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() =>
      expect(api.phraseRhymes).toHaveBeenCalledWith(
        'pay attention',
        2,
        ['perfect', 'near'],
        expect.anything(),
      ),
    )
  })

  it('lets the user settle an ambiguous word with one tap', async () => {
    const amb = info({
      word: 'family',
      ambiguous: true,
      syllables_min: 2,
      syllables_max: 3,
      pronunciations: [
        {
          phones: 'F AE1 M AH0 L IY0',
          ipa: 'fˈæməliː',
          syllables: 3,
          stress: '100',
          source: 'dictionary',
        },
        {
          phones: 'F AE1 M L IY0',
          ipa: 'fˈæmliː',
          syllables: 2,
          stress: '10',
          source: 'dictionary',
        },
      ],
    }) // fmt: skip
    api.searchRhymes.mockResolvedValue(response({ word: amb, results: [] }))
    api.saveCustomPron.mockResolvedValue({})
    const changed = show({ word: 'family', nonce: 1 })
    expect(await screen.findByText(/2 or 3 syllables/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Use only this one')[1])
    await waitFor(() =>
      expect(api.saveCustomPron).toHaveBeenCalledWith(
        'family',
        expect.objectContaining({ phones: 'F AE1 M L IY0' }),
      ),
    )
    await waitFor(() => expect(changed).toHaveBeenCalled()) // so the editor recounts its syllables
  })

  it('offers to teach an unknown word and refreshes the editor afterwards', async () => {
    const unknown = info({
      word: 'zorblax',
      status: 'guess',
      pronunciations: [],
      syllables_min: 2,
      syllables_max: 2,
    })
    api.searchRhymes
      .mockResolvedValueOnce(
        response({
          word: unknown,
          results: [],
          total: 0,
          notes: ['I don’t know how “zorblax” sounds.'],
        }),
      )
      .mockResolvedValue(response())
    api.saveCustomPron.mockResolvedValue({})
    const changed = show({ word: 'zorblax', nonce: 1 })
    const form = await screen.findByRole('group', { name: 'Add a pronunciation' })
    expect(within(form).getByText(/not in the dictionary/)).toBeInTheDocument()
    expect(screen.queryByText('Find rhymes')).not.toBeInTheDocument() // no pretend results for a word we cannot say
    fireEvent.change(within(form).getByLabelText('Sounds like this word'), {
      target: { value: 'lax' },
    })
    fireEvent.click(within(form).getByText('Use it'))
    await waitFor(() =>
      expect(api.saveCustomPron).toHaveBeenCalledWith('zorblax', { sounds_like: 'lax' }),
    )
    await waitFor(() => expect(changed).toHaveBeenCalled())
  })

  it('shows the reason when the sounds are rejected', async () => {
    const unknown = info({
      word: 'zorblax',
      status: 'guess',
      pronunciations: [],
      syllables_min: 2,
      syllables_max: 2,
    })
    api.searchRhymes.mockResolvedValue(response({ word: unknown, results: [], total: 0 }))
    api.saveCustomPron.mockRejectedValue(
      new ApiFail('I don’t know how “qqq” sounds either. Try a different word.', { status: 422 }),
    )
    show({ word: 'zorblax', nonce: 1 })
    fireEvent.change(await screen.findByLabelText('Sounds like this word'), {
      target: { value: 'qqq' },
    })
    fireEvent.click(screen.getByText('Use it'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/either/)
  })

  it('says clearly that the server is needed (not the internet) when it is down', async () => {
    api.searchRhymes.mockRejectedValue(new ApiFail('x', { network: true }))
    show()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Cannot reach the Studio Bars server/)
    expect(alert).toHaveTextContent(/no internet needed/)
    api.searchRhymes.mockResolvedValue(response())
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByText('shade')).toBeInTheDocument()
  })

  it('lists your own pronunciations and lets you remove one', async () => {
    api.listCustomPron.mockResolvedValue([
      {
        word: 'zorblax',
        phones: 'L AE1 K S',
        ipa: 'lˈæks',
        syllables: 1,
        note: 'Sounds like “lax”.',
      },
    ])
    api.deleteCustomPron.mockResolvedValue(undefined)
    const changed = show()
    fireEvent.click(await screen.findByText(/Your pronunciations \(1\)/))
    fireEvent.click(screen.getByLabelText('Remove my pronunciation of zorblax'))
    await waitFor(() => expect(api.deleteCustomPron).toHaveBeenCalledWith('zorblax'))
    await waitFor(() => expect(changed).toHaveBeenCalled())
  })

  it('credits the dictionary', async () => {
    show()
    expect(await screen.findByText(/CMU Pronouncing Dictionary/)).toBeInTheDocument()
  })

  it('has nothing to show until there is a word', async () => {
    show(null)
    expect(api.searchRhymes).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Word to look up')).toBeInTheDocument()
    await waitFor(() => expect(api.listCustomPron).toHaveBeenCalled())
    await screen.findByText(/CMU Pronouncing Dictionary/)
  })

  it('uses a phrase request once, then lets the user go back to single words', async () => {
    const handled = vi.fn()
    render(
      <ToastProvider>
        <RhymePanel
          suggested={{ word: 'fade', nonce: 1 }}
          phraseRequest={{ phrase: 'pay attention', nonce: 1 }}
          onPhraseHandled={handled}
          onCustomChanged={vi.fn()}
        />
      </ToastProvider>,
    )
    await waitFor(() => expect(handled).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('tab', { name: 'One word' }))
    expect(await screen.findByLabelText('Word to look up')).toBeInTheDocument()
    expect(handled).toHaveBeenCalledTimes(1) // not replayed
  })
})
