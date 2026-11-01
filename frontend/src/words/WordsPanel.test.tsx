import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { ToastProvider } from '../components/Toasts'
import type { Meanings, Sense, WordInfo } from '../types'
import { WordsPanel } from './WordsPanel'

const api = vi.hoisted(() => ({
  getMeanings: vi.fn(),
  lookupWord: vi.fn(),
  getOnlineStatus: vi.fn(),
  setOnlineEnabled: vi.fn(),
  getOnlineWords: vi.fn(),
  listPhrases: vi.fn(),
  listPhraseTags: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const sense = (over: Partial<Sense> = {}): Sense => ({
  id: 'n001',
  pos: 'n',
  pos_label: 'noun',
  sense_no: 1,
  of: 3,
  lemma: 'rain',
  definition: 'water falling in drops from vapor condensed in the atmosphere',
  examples: ['the rain fell all night'],
  synonyms: [
    { word: 'rainfall' },
    { word: 'downpour', shift: { rank: 2, of: 2, usually_means: 'a heavy rain' } },
  ],
  similar: [],
  antonyms: [{ word: 'drought' }],
  broader: [{ word: 'precipitation' }],
  narrower: [{ word: 'drizzle' }],
  related: [],
  imagery: [{ word: 'raindrop' }],
  said_as: null,
  fit: null,
  ...over,
}) // fmt: skip
const meanings = (over: Partial<Meanings> = {}): Meanings => ({
  word: 'rain',
  found: true,
  forms: ['rain'],
  senses: [
    sense(),
    sense({ id: 'n002', sense_no: 2, definition: 'a crowd of things falling', synonyms: [] }),
  ],
  pos_counts: { noun: 2, verb: 1 },
  total_senses: 3,
  context_used: false,
  reordered: false,
  notes: [],
  source: 'WordNet 3.0',
  ...over,
}) // fmt: skip
const sound: WordInfo = {
  word: 'rain',
  status: 'known',
  pronunciations: [
    { phones: 'R EY1 N', ipa: 'rˈeɪn', syllables: 1, stress: '1', source: 'dictionary' },
  ],
  syllables_min: 1,
  syllables_max: 1,
  ambiguous: false,
  note: '',
} // fmt: skip

function show(over: Partial<React.ComponentProps<typeof WordsPanel>> = {}) {
  const props = {
    suggested: { word: 'rain', nonce: 1 },
    context: '',
    onLookup: vi.fn(),
    onOpenRhymes: vi.fn(),
    onPhraseRhymes: vi.fn(),
    ...over,
  }
  render(
    <ToastProvider>
      <WordsPanel {...props} />
    </ToastProvider>,
  )
  return props
}

beforeEach(() => {
  vi.resetAllMocks()
  api.getMeanings.mockResolvedValue(meanings())
  api.lookupWord.mockResolvedValue(sound)
  api.getOnlineStatus.mockResolvedValue({
    enabled: false,
    service: 'Datamuse',
    host: 'api.datamuse.com',
    cached_answers: 0,
    sends: 'Only the single word you look up. Never your lyrics or song titles.',
    key_notice: 'Datamuse has announced that an API key will be required from 1 February 2027.',
  })
  api.listPhrases.mockResolvedValue({ total: 0, items: [] })
  api.listPhraseTags.mockResolvedValue([])
})

describe('Meanings', () => {
  it('shows each meaning separately with its own synonyms, opposites and imagery', async () => {
    show()
    const first = await screen.findByRole('article', { name: 'noun meaning 1' })
    expect(within(first).getByText(/water falling in drops/)).toBeInTheDocument()
    expect(within(first).getByText('“the rain fell all night”')).toBeInTheDocument()
    expect(within(first).getByText('Same meaning')).toBeInTheDocument()
    expect(within(first).getByText('drought')).toBeInTheDocument()
    expect(within(first).getByText('raindrop')).toBeInTheDocument()
    const second = screen.getByRole('article', { name: 'noun meaning 2' })
    expect(within(second).queryByText('rainfall')).not.toBeInTheDocument() // not one blended list
  })

  it('marks a synonym whose meaning may shift, and says what it usually means', async () => {
    show()
    const warn = await screen.findByText('downpour')
    expect(warn.closest('button')).toHaveAttribute(
      'title',
      expect.stringContaining('usually means “a heavy rain”'),
    )
    expect(
      within(warn.closest('button') as HTMLElement).getByLabelText('meaning may change'),
    ).toBeInTheDocument()
    expect(screen.getByText(/marks a word that usually means something else/)).toBeInTheDocument()
    expect(screen.getByText('rainfall').closest('button')?.querySelector('sup')).toBeNull()
  })

  it('tells the user these are dictionary facts, not AI', async () => {
    show()
    await screen.findByText('rain')
    expect(screen.getByText(/not AI suggestions/)).toBeInTheDocument()
    expect(screen.getAllByText(/WordNet/).length).toBeGreaterThan(1)
  })

  it('shows how the word sounds, and how many syllables', async () => {
    show()
    expect(await screen.findByText('/rˈeɪn/')).toBeInTheDocument()
    expect(screen.getByText('1 syllables')).toBeInTheDocument()
  })

  it('sends the current line as context and says which meaning fits', async () => {
    api.getMeanings.mockResolvedValue(
      meanings({
        context_used: true,
        reordered: true,
        senses: [
          sense({ fit: { score: 2, matched: ['cold', 'window'], best: true } }),
          sense({ id: 'n9', sense_no: 3, fit: { score: 1, matched: ['cold'], best: false } }),
        ],
      }),
    )
    show({ context: 'cold rain on the window' })
    expect(await screen.findByText('Fits your line')).toBeInTheDocument()
    expect(screen.getByText('May fit')).toBeInTheDocument()
    expect(screen.getAllByText(/word overlap only, not understanding/).length).toBeGreaterThan(0)
    expect(api.getMeanings).toHaveBeenCalledWith(
      'rain',
      'cold rain on the window',
      '',
      expect.anything(),
    )
    expect(screen.getByText(/ordered by what fits your line/)).toBeInTheDocument()
  })

  it('sends the neighbouring lines separately so the current line counts more', async () => {
    show({ context: 'put the money in the bank', around: 'I watch the lights' })
    await screen.findByRole('article', { name: 'noun meaning 1' })
    expect(api.getMeanings).toHaveBeenCalledWith(
      'rain',
      'put the money in the bank',
      'I watch the lights',
      expect.anything(),
    )
  })

  it('looks a new word up with the NEW line as context, never the previous line', async () => {
    const props = {
      suggested: { word: 'rain', nonce: 1 },
      context: 'old line about the watch',
      around: '',
      contextKey: 'line-1',
      onLookup: vi.fn(),
      onOpenRhymes: vi.fn(),
      onPhraseRhymes: vi.fn(),
    }
    const { rerender } = render(
      <ToastProvider>
        <WordsPanel {...props} />
      </ToastProvider>,
    )
    await screen.findByRole('article', { name: 'noun meaning 1' })
    api.getMeanings.mockClear()
    rerender(
      <ToastProvider>
        <WordsPanel
          {...props}
          suggested={{ word: 'bank', nonce: 2 }}
          context="put the money in the bank"
          contextKey="line-2"
        />
      </ToastProvider>,
    )
    await waitFor(() => expect(api.getMeanings).toHaveBeenCalled())
    for (const call of api.getMeanings.mock.calls) expect(call[1]).toBe('put the money in the bank') // never the old line
  })

  it('shows how each meaning of a same-spelling word is said', async () => {
    api.getMeanings.mockResolvedValue(
      meanings({
        word: 'lead',
        senses: [sense({ said_as: { phones: 'L EH1 D', ipa: 'lˈɛd', in_dictionary: true } })],
        notes: ['This word is said differently depending on its meaning.'],
      }),
    )
    show({ suggested: { word: 'lead', nonce: 2 } })
    expect(await screen.findByRole('note')).toHaveTextContent('/lˈɛd/')
    expect(screen.getByText(/said differently depending on its meaning/)).toBeInTheDocument()
  })

  it('clicking a word looks it up, and the rhymes shortcut opens the Rhymes tab', async () => {
    const p = show()
    fireEvent.click((await screen.findAllByText('drizzle'))[0])
    expect(p.onLookup).toHaveBeenCalledWith('drizzle')
    await waitFor(() =>
      expect(api.getMeanings).toHaveBeenLastCalledWith('drizzle', '', '', expect.anything()),
    )
    fireEvent.click(screen.getByText(/Find rhymes/))
    expect(p.onOpenRhymes).toHaveBeenCalled()
  })

  it('filters by part of speech and folds long lists', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      sense({ id: `n${i}`, sense_no: i + 1, definition: `meaning ${i + 1}` }),
    )
    api.getMeanings.mockResolvedValue(
      meanings({
        senses: [
          ...many,
          sense({ id: 'v1', pos: 'v', pos_label: 'verb', definition: 'to fall as rain' }),
        ],
        total_senses: 7,
        pos_counts: { noun: 6, verb: 1 },
      }),
    )
    show()
    await screen.findByText('meaning 1')
    expect(screen.queryByText('meaning 6')).not.toBeInTheDocument() // only the first four at first
    fireEvent.click(screen.getByText('Show all 7 meanings'))
    expect(screen.getByText('meaning 6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^verb \(1\)/ }))
    expect(screen.getByText('to fall as rain')).toBeInTheDocument()
    expect(screen.queryByText('meaning 1')).not.toBeInTheDocument()
  })

  it('says plainly when WordNet does not know the word', async () => {
    api.getMeanings.mockResolvedValue(
      meanings({
        word: 'zorblax',
        found: false,
        senses: [],
        total_senses: 0,
        pos_counts: {},
        notes: [
          'WordNet does not have “zorblax”. It may be slang, a name, or spelled differently.',
        ],
      }),
    )
    show({ suggested: { word: 'zorblax', nonce: 3 } })
    expect(await screen.findByText(/WordNet does not have “zorblax”/)).toBeInTheDocument()
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument()
  })

  it('explains when the server is not running, and retries', async () => {
    api.getMeanings
      .mockRejectedValueOnce(new ApiFail('x', { network: true }))
      .mockResolvedValue(meanings())
    show()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Cannot reach the Studio Bars server/)
    expect(alert).toHaveTextContent(/no internet needed/)
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByRole('article', { name: 'noun meaning 1' })).toBeInTheDocument()
  })

  it('waits for a word before asking for anything', () => {
    show({ suggested: null })
    expect(api.getMeanings).not.toHaveBeenCalled()
    expect(screen.getByText(/Tap a line, or select a word/)).toBeInTheDocument()
  })
})

describe('Online ideas tab', () => {
  it('is off by default, says what it sends, and asks for nothing', async () => {
    show()
    fireEvent.click(screen.getByRole('tab', { name: 'Online ideas' }))
    const box = await screen.findByRole('checkbox', { name: /Use the online word helper/ })
    expect(box).not.toBeChecked()
    expect(screen.getByText(/api\.datamuse\.com/)).toBeInTheDocument()
    expect(screen.getByText(/Only the single word you look up/)).toBeInTheDocument()
    expect(screen.getByText(/API key will be required from 1 February 2027/)).toBeInTheDocument()
    expect(api.getOnlineWords).not.toHaveBeenCalled()
  })

  it('only after switching it on does it ask, and the answer is labelled as live from the internet', async () => {
    api.setOnlineEnabled.mockResolvedValue({
      enabled: true,
      service: 'Datamuse',
      host: 'api.datamuse.com',
      cached_answers: 0,
      sends: 'x',
      key_notice: 'y',
    })
    api.getOnlineWords.mockResolvedValue({
      source: 'Datamuse',
      online: true,
      from_cache: false,
      stale: false,
      fetched_at: '',
      query: { word: 'rain', kind: 'related' },
      sent: 'Only the word “rain” was sent.',
      results: [{ word: 'storm', score: 9 }],
      notice: null,
    })
    show()
    fireEvent.click(screen.getByRole('tab', { name: 'Online ideas' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Use the online word helper/ }))
    const res = await screen.findByLabelText('Online results')
    expect(within(res).getByText('storm')).toBeInTheDocument()
    expect(within(res).getByText(/Online · live from Datamuse/)).toBeInTheDocument()
    expect(within(res).getByText(/Only the word “rain” was sent\./)).toBeInTheDocument()
    expect(api.getOnlineWords).toHaveBeenCalledWith('rain', 'related', expect.anything())
  })

  it('shows a saved copy honestly when offline', async () => {
    api.getOnlineStatus.mockResolvedValue({
      enabled: true,
      service: 'Datamuse',
      host: 'api.datamuse.com',
      cached_answers: 1,
      sends: 'x',
      key_notice: 'y',
    })
    api.getOnlineWords.mockResolvedValue({
      source: 'Datamuse',
      online: false,
      from_cache: true,
      stale: true,
      fetched_at: '2026-10-01',
      query: { word: 'rain', kind: 'related' },
      sent: 'Nothing was sent: this is a saved answer.',
      results: [{ word: 'storm', score: null }],
      notice: 'Cannot reach the online word service. Showing saved results from 2026-10-01.',
    })
    show()
    fireEvent.click(screen.getByRole('tab', { name: 'Online ideas' }))
    const res = await screen.findByLabelText('Online results')
    expect(within(res).getByText(/Saved copy \(offline\)/)).toBeInTheDocument()
    expect(within(res).getByText(/Nothing was sent/)).toBeInTheDocument()
    expect(within(res).getByRole('status')).toHaveTextContent(/Showing saved results/)
  })

  it('shows a clear message when there is nothing saved and the service is unreachable', async () => {
    api.getOnlineStatus.mockResolvedValue({
      enabled: true,
      service: 'Datamuse',
      host: 'api.datamuse.com',
      cached_answers: 0,
      sends: 'x',
      key_notice: 'y',
    })
    api.getOnlineWords.mockRejectedValue(
      new ApiFail('Cannot reach the online word service. Nothing saved for this word yet.', {
        status: 503,
        code: 'ONLINE_UNAVAILABLE',
      }),
    )
    show()
    fireEvent.click(screen.getByRole('tab', { name: 'Online ideas' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing saved for this word yet/)
    expect(screen.getByLabelText('Word to look up')).toBeInTheDocument() // the rest of the panel still works
  })
})
