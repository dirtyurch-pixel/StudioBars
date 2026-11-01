import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CraftPanel } from './CraftPanel'
import type { CraftProps } from './shared'

const api = vi.hoisted(() => ({
  getGrids: vi.fn(),
  getSyllables: vi.fn(),
  putGrid: vi.fn(),
  listTakes: vi.fn(),
  addTake: vi.fn(),
  setTakeFavourite: vi.fn(),
  deleteTake: vi.fn(),
  listCraft: vi.fn(),
  addCraft: vi.fn(),
  deleteCraft: vi.fn(),
  getPlan: vi.fn(),
  putPlan: vi.fn(),
  scanSong: vi.fn(),
  getChains: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const sy = (word: string, stress: 0 | 1 | null) => ({
  word,
  word_index: 0,
  stress,
  first: true,
  guess: stress === null,
})
const props = (over: Partial<CraftProps> = {}): CraftProps => ({
  songId: 'song1',
  sectionLines: [{ id: 'l1', text: 'rain on glass', is_locked: false }],
  activeLine: { id: 'l1', text: 'rain on glass', locked: false, number: 1 },
  bpm: 90,
  onInsert: vi.fn().mockReturnValue(true),
  onReplace: vi.fn().mockReturnValue(true),
  ...over,
})
const open = (p = props(), tab?: string) => {
  render(<CraftPanel {...p} />)
  if (tab) fireEvent.click(screen.getByRole('button', { name: tab }))
  return p
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.getGrids.mockResolvedValue({})
  api.getSyllables.mockResolvedValue({ syllables: [sy('rain', 1), sy('on', 0), sy('glass', 1)] })
  api.putGrid.mockImplementation(async (_s, _l, g) => g)
  api.listTakes.mockResolvedValue([])
  api.listCraft.mockResolvedValue([])
})

describe('Flow', () => {
  it('lets the writer place a syllable by hand and saves it without touching the lyric', async () => {
    const p = open()
    const s1 = await screen.findByRole('button', { name: /Syllable 1 rain stressed/ })
    fireEvent.click(s1)
    fireEvent.click(screen.getByRole('button', { name: /Bar 1 slot 3 empty/ }))
    expect(
      await screen.findByRole('button', { name: /Bar 1 slot 3 syllable 1/ }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save flow' }))
    await waitFor(() => expect(api.putGrid).toHaveBeenCalled())
    const saved = api.putGrid.mock.calls[0][2]
    expect(saved.assign[0]).toBe(2)
    expect(p.onReplace).not.toHaveBeenCalled()
    expect(p.onInsert).not.toHaveBeenCalled()
    expect(await screen.findByText(/lyric text was not touched/)).toBeInTheDocument()
  })

  it('switches subdivision and shows the estimate wording', async () => {
    open()
    await screen.findByRole('button', { name: /Syllable 1/ })
    fireEvent.change(screen.getByLabelText('Subdivision'), { target: { value: 'triplet' } })
    expect(await screen.findAllByRole('button', { name: /Bar 1 slot/ })).toHaveLength(12)
    expect(screen.getByText(/All of this is an estimate/)).toBeInTheDocument()
  })

  it('asks for a line first', () => {
    open(props({ activeLine: null }))
    expect(screen.getByText(/Click a line that has words/)).toBeInTheDocument()
  })
})

describe('Takes', () => {
  it('Use this take asks first, then replaces through the guarded path', async () => {
    api.listTakes.mockResolvedValue([
      {
        id: 't1',
        line_id: 'l1',
        text: 'drizzle on the pane',
        favourite: false,
        note: '',
        created_at: '',
      },
    ])
    const p = open(props(), 'Takes')
    fireEvent.click(await screen.findByRole('button', { name: 'Use this take…' }))
    expect(p.onReplace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(p.onReplace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use this take…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use this take' }))
    expect(p.onReplace).toHaveBeenCalledWith('l1', 'drizzle on the pane')
  })

  it('a locked line offers no way to use a take', async () => {
    api.listTakes.mockResolvedValue([
      { id: 't1', line_id: 'l1', text: 'x take', favourite: false, note: '', created_at: '' },
    ])
    open(
      props({ activeLine: { id: 'l1', text: 'locked words', locked: true, number: 1 } }),
      'Takes',
    )
    expect(await screen.findByText(/Unlock the line to use a take/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this take…' })).not.toBeInTheDocument()
  })

  it('keeps the current line as a take', async () => {
    api.addTake.mockResolvedValue({})
    open(props(), 'Takes')
    fireEvent.click(await screen.findByRole('button', { name: 'Keep the current line as a take' }))
    await waitFor(() => expect(api.addTake).toHaveBeenCalledWith('song1', 'l1', 'rain on glass'))
  })
})

describe('Vault', () => {
  it('inserts a copy below the active line and keeps the original', async () => {
    api.listCraft.mockResolvedValue([
      {
        id: 'v1',
        song_id: null,
        kind: 'punchline',
        text: 'I am the receipt',
        tags: ['wit'],
        created_at: '',
      },
    ])
    const p = open(props(), 'Vault')
    fireEvent.click(await screen.findByRole('button', { name: 'Insert copy below' }))
    expect(p.onInsert).toHaveBeenCalledWith('I am the receipt', 'l1')
    expect(api.deleteCraft).not.toHaveBeenCalled()
  })

  it('saves the current line to the vault', async () => {
    api.addCraft.mockResolvedValue({})
    open(props(), 'Vault')
    fireEvent.click(await screen.findByRole('button', { name: 'Save current line' }))
    await waitFor(() =>
      expect(api.addCraft).toHaveBeenCalledWith(
        expect.objectContaining({ song_id: null, text: 'rain on glass' }),
      ),
    )
  })
})

describe('Scan', () => {
  it('shows possible clichés and labels results as estimates', async () => {
    api.scanSong.mockResolvedValue({
      cliches: [
        { line_id: 'l1', section: 'Verse', phrase: 'heart of gold', text: 'my heart of gold' },
      ],
      repeated_lines: [
        { text: 'we rise', count: 2, line_ids: [], sections: [], intentional: true },
      ],
      reused_phrases: [],
      filler: [],
      structure: {
        sections: [
          {
            label: 'Verse',
            type: 'verse',
            lines: 4,
            avg_syllables: 7,
            spread: 1,
            rhyme_families: 1,
            end_rhyme_share: 0.5,
          },
        ],
        notes: ['There is no chorus or hook section yet.'],
        disclaimer: 'Estimates, not verdicts.',
      },
    })
    open(props(), 'Scan')
    fireEvent.click(screen.getByRole('button', { name: 'Scan the whole song' }))
    expect((await screen.findAllByText(/heart of gold/)).length).toBeGreaterThan(0)
    expect(screen.getByText('looks intentional')).toBeInTheDocument()
    expect(screen.getByText(/no chorus or hook/)).toBeInTheDocument()
    expect(screen.getByText(/Estimates, not verdicts/)).toBeInTheDocument()
  })

  it('finds rhyme chains at the chosen strictness', async () => {
    api.getChains.mockResolvedValue({
      chains: [
        {
          members: [
            { line: 0, word: 'night', start: 0, end: 5, alternate_pronunciations: false },
            { line: 0, word: 'light', start: 6, end: 11, alternate_pronunciations: true },
          ],
          internal: true,
          weakest_link: 'perfect',
        },
      ],
      strictness: 'strict',
      note: 'First pronunciation.',
    })
    open(props(), 'Scan')
    fireEvent.change(screen.getByLabelText('Strictness'), { target: { value: 'strict' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find chains' }))
    expect(await screen.findByText(/night \(line 1\)/)).toBeInTheDocument()
    expect(api.getChains).toHaveBeenCalledWith(['rain on glass'], 'strict')
    expect(screen.getByText('internal')).toBeInTheDocument()
  })
})

describe('Plan', () => {
  it('saves the story plan and adds an idea', async () => {
    api.getPlan.mockResolvedValue({
      scene: '',
      conflict: '',
      turning_point: '',
      emotional_arc: '',
      notes: '',
    })
    api.putPlan.mockResolvedValue({})
    api.addCraft.mockResolvedValue({})
    open(props(), 'Plan')
    fireEvent.change(await screen.findByLabelText(/Scene/), { target: { value: 'late train' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() =>
      expect(api.putPlan).toHaveBeenCalledWith(
        'song1',
        expect.objectContaining({ scene: 'late train' }),
      ),
    )
    fireEvent.change(screen.getByLabelText('New idea'), {
      target: { value: 'a stranger on the platform' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(api.addCraft).toHaveBeenCalledWith({
        song_id: 'song1',
        kind: 'theme',
        text: 'a stranger on the platform',
        tags: [],
      }),
    )
  })
})
