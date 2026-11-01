import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { ToastProvider } from '../components/Toasts'
import type { PhraseItem } from '../types'
import { PhraseBank } from './PhraseBank'

const api = vi.hoisted(() => ({
  listPhrases: vi.fn(),
  listPhraseTags: vi.fn(),
  createPhrase: vi.fn(),
  updatePhrase: vi.fn(),
  deletePhrase: vi.fn(),
  exportPhrases: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const item = (over: Partial<PhraseItem> = {}): PhraseItem => ({
  id: 'p1',
  phrase: 'finna',
  meaning: 'about to',
  sounds_like: 'finer',
  tags: ['slang'],
  pronunciation: {
    known: true,
    syllables_min: 2,
    syllables_max: 2,
    ipa: 'fˈaɪnɝ',
    unknown_words: [],
  },
  ...over,
}) // fmt: skip

function show() {
  const p = { onLookup: vi.fn(), onPhraseRhymes: vi.fn() }
  render(
    <ToastProvider>
      <PhraseBank {...p} />
    </ToastProvider>,
  )
  return p
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listPhrases.mockResolvedValue({ total: 1, items: [item()] })
  api.listPhraseTags.mockResolvedValue([{ tag: 'slang', count: 1 }])
})

describe('PhraseBank', () => {
  it('lists phrases with meaning, how many syllables, how they sound and tags', async () => {
    show()
    expect(await screen.findByText('finna')).toBeInTheDocument()
    expect(screen.getByText('about to')).toBeInTheDocument()
    expect(screen.getByText(/2 syllables/)).toBeInTheDocument()
    expect(screen.getByText('/fˈaɪnɝ/')).toBeInTheDocument()
    expect(screen.getByText(/sounds like “finer”/)).toBeInTheDocument()
    expect(screen.getByText('#slang')).toBeInTheDocument()
    expect(screen.getByText('1 phrase')).toBeInTheDocument()
  })

  it('has a friendly empty state', async () => {
    api.listPhrases.mockResolvedValue({ total: 0, items: [] })
    api.listPhraseTags.mockResolvedValue([])
    show()
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument()
  })

  it('adds a phrase, tidying the tags', async () => {
    api.createPhrase.mockResolvedValue(item())
    show()
    await screen.findByText('finna')
    fireEvent.click(screen.getByText('+ Add phrase'))
    fireEvent.change(screen.getByLabelText('Phrase or slang word'), {
      target: { value: 'on the come up' },
    })
    fireEvent.change(screen.getByLabelText('What it means'), { target: { value: 'rising fast' } })
    fireEvent.change(screen.getByLabelText(/Tags/), { target: { value: ' Hustle, hook ,, ' } })
    fireEvent.click(screen.getByText('Add to my phrases'))
    await waitFor(() =>
      expect(api.createPhrase).toHaveBeenCalledWith({
        phrase: 'on the come up',
        meaning: 'rising fast',
        sounds_like: '',
        tags: ['hustle', 'hook'],
      }),
    )
  })

  it('shows the reason when a phrase is a duplicate and keeps what was typed', async () => {
    api.createPhrase.mockRejectedValue(
      new ApiFail('“finna” is already in your phrase bank.', { status: 409, code: 'DUPLICATE' }),
    )
    show()
    await screen.findByText('finna')
    fireEvent.click(screen.getByText('+ Add phrase'))
    fireEvent.change(screen.getByLabelText('Phrase or slang word'), { target: { value: 'finna' } })
    fireEvent.click(screen.getByText('Add to my phrases'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already in your phrase bank/)
    expect(screen.getByLabelText('Phrase or slang word')).toHaveValue('finna')
  })

  it('searches and filters by tag (asking the server, not guessing)', async () => {
    show()
    await screen.findByText('finna')
    fireEvent.change(screen.getByLabelText('Search your phrases'), { target: { value: 'about' } })
    await waitFor(() => expect(api.listPhrases).toHaveBeenLastCalledWith('about', ''), {
      timeout: 2000,
    })
    fireEvent.click(screen.getByRole('button', { name: 'slang (1)' }))
    await waitFor(() => expect(api.listPhrases).toHaveBeenLastCalledWith('about', 'slang'), {
      timeout: 2000,
    })
  })

  it('edits an existing phrase', async () => {
    api.updatePhrase.mockResolvedValue(item({ meaning: 'going to' }))
    show()
    await screen.findByText('finna')
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByLabelText('Phrase or slang word')).toHaveValue('finna')
    fireEvent.change(screen.getByLabelText('What it means'), { target: { value: 'going to' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() =>
      expect(api.updatePhrase).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ meaning: 'going to', tags: ['slang'] }),
      ),
    )
  })

  it('asks before deleting', async () => {
    api.deletePhrase.mockResolvedValue(undefined)
    show()
    fireEvent.click(await screen.findByLabelText('Delete finna'))
    expect(api.deletePhrase).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Yes'))
    await waitFor(() => expect(api.deletePhrase).toHaveBeenCalledWith('p1'))
  })

  it('warns about words it cannot pronounce and says how to fix it', async () => {
    api.listPhrases.mockResolvedValue({
      total: 1,
      items: [
        item({
          phrase: 'blorf nation',
          sounds_like: '',
          pronunciation: {
            known: false,
            syllables_min: 3,
            syllables_max: 3,
            ipa: 'nˈeɪʃʌn',
            unknown_words: ['blorf'],
            guessed: true,
          },
        }),
      ],
    })
    show()
    expect(await screen.findByText(/Not sure how to say: blorf/)).toBeInTheDocument()
    expect(screen.getByText(/Add a “sounds like…”/)).toBeInTheDocument()
  })

  it('links to meanings (single words) and to phrase rhymes', async () => {
    const p = show()
    fireEvent.click(await screen.findByText('Meaning'))
    expect(p.onLookup).toHaveBeenCalledWith('finna')
    fireEvent.click(screen.getByText('Rhymes'))
    expect(p.onPhraseRhymes).toHaveBeenCalledWith('finer') // uses how it sounds
  })

  it('exports the bank as a file', async () => {
    api.exportPhrases.mockResolvedValue(new Blob(['{}']))
    const create = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: vi.fn() })
    show()
    fireEvent.click(await screen.findByText('Export as a file'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })

  it('says clearly when the server is not running', async () => {
    api.listPhrases.mockRejectedValue(new ApiFail('x', { network: true }))
    show()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/Cannot reach the Studio Bars server/)).toBeInTheDocument()
  })
})
