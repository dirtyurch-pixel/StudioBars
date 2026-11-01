import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { ToastProvider } from '../components/Toasts'
import type { AiPrepared, AiResult, AiStatus } from '../types'
import { AiPanel } from './AiPanel'
import { syllableText } from './format'

const api = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  putAiSettings: vi.fn(),
  putAiKey: vi.fn(),
  deleteAiKey: vi.fn(),
  aiPrepare: vi.fn(),
  aiSuggest: vi.fn(),
  aiAccept: vi.fn(),
  aiTest: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const usage = { month: '2026-11', spent_usd: 0.1, requests: 2, cap_usd: 5, remaining_usd: 4.9 }
const task = (id: string, label: string, over = {}) => ({
  id,
  label,
  kind: 'lines',
  needs_line: false,
  needs_rhyme: false,
  whole_song: false,
  ...over,
})
const status = (over: Partial<AiStatus> = {}): AiStatus =>
  ({
    enabled: true,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    base_url: '',
    cap_usd: 5,
    price_in: 0,
    price_out: 0,
    key: { configured: true, source: 'file', hint: '…cdef' },
    usage,
    models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', typical_request_usd: 0.016 }],
    providers: [{ id: 'anthropic', label: 'Claude (Anthropic)' }],
    personas: [
      { id: 'co_writer', label: 'Co-writer', text: 'collaborative' },
      { id: 'critic', label: 'Critical reviewer', text: 'strict' },
    ],
    tasks: [
      task('next_line', 'Next line'),
      task('rewrite', 'Rewrite this line', { needs_line: true }),
    ],
    ready: true,
    disclosure: 'When you press Send, the text goes online.',
    ...over,
  }) as AiStatus

const prepared: AiPrepared = {
  hash: 'h'.repeat(64),
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  system: 's',
  user: 'THE EXACT TEXT',
  sent: { sections: ['Verse 1'], lines: 3 },
  est_input_tokens: 400,
  max_output_tokens: 700,
  est_cost_usd: 0.012,
  worst_cost_usd: 0.02,
  over_budget: false,
  usage,
}
const result: AiResult = {
  kind: 'lines',
  model: 'claude-opus-5-5',
  suggestions: [
    {
      id: 'sg1',
      text: 'Streetlights hum a lullaby',
      reason: 'image',
      syllables: { min: 7, max: 7, exact: true, guessed: false },
      rhymes_with_target: 'perfect',
    },
  ],
  notes: [],
  target_line_id: 'line1',
  usage: { input_tokens: 400, output_tokens: 100, cost_usd: 0.01 },
  month: usage,
}

const base = (over = {}) => ({
  songId: 'song1',
  sectionId: 'sec1',
  sectionLabel: 'Verse 1',
  activeLine: { id: 'line1', text: 'Counting every shadow', locked: false, number: 2 },
  lastLineId: 'line1',
  saveNow: vi.fn().mockResolvedValue(true),
  onInsert: vi.fn().mockReturnValue(true),
  onReplace: vi.fn().mockReturnValue(true),
  lineText: (id: string) => (id === 'line1' ? 'Counting every shadow' : null),
  ...over,
})
const show = (props = base()) => {
  render(
    <ToastProvider>
      <AiPanel {...props} />
    </ToastProvider>,
  )
  return props
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  api.getAiStatus.mockResolvedValue(status())
  api.aiPrepare.mockResolvedValue(prepared)
  api.aiSuggest.mockResolvedValue(result)
  api.aiAccept.mockResolvedValue({ ok: true })
})

describe('AiPanel', () => {
  it('shows setup, not the writer, when AI is not ready', async () => {
    api.getAiStatus.mockResolvedValue(
      status({
        enabled: false,
        ready: false,
        key: { configured: false, source: null, hint: null },
      }),
    )
    show()
    expect(await screen.findByText('AI co-writer setup')).toBeInTheDocument()
    expect(screen.queryByText('Show what will be sent')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn AI on' })).toBeDisabled() // needs the tick first
  })

  it('sends nothing until the writer has seen the preview and pressed Send', async () => {
    const p = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    await screen.findByRole('region', { name: 'What will be sent' })
    expect(p.saveNow).toHaveBeenCalled() // saved first so the server sees the latest lyrics
    expect(api.aiPrepare).toHaveBeenCalledTimes(1)
    expect(api.aiSuggest).not.toHaveBeenCalled()
    expect(screen.getByText('THE EXACT TEXT')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send to AI' }))
    expect(await screen.findByText('Streetlights hum a lullaby')).toBeInTheDocument()
    expect(api.aiSuggest).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'next_line' }),
      prepared.hash,
      expect.anything(),
    )
  })

  it('sends the chosen helper style and shows what it means', async () => {
    show()
    fireEvent.change(await screen.findByLabelText('Helper style'), { target: { value: 'critic' } })
    expect(screen.getByText('strict')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show what will be sent' }))
    await screen.findByRole('region', { name: 'What will be sent' })
    expect(api.aiPrepare).toHaveBeenCalledWith(expect.objectContaining({ persona: 'critic' }))
  })

  it('does not send if the song could not be saved first', async () => {
    const p = show(base({ saveNow: vi.fn().mockResolvedValue(false) }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(p.saveNow).toHaveBeenCalled()
    expect(api.aiPrepare).not.toHaveBeenCalled()
  })

  it('blocks Send when the monthly limit would be passed', async () => {
    api.aiPrepare.mockResolvedValue({ ...prepared, over_budget: true })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    await screen.findByRole('region', { name: 'What will be sent' })
    expect(screen.getByRole('button', { name: 'Send to AI' })).toBeDisabled()
  })

  it('needs a clicked, unlocked line for line tasks', async () => {
    show(base({ activeLine: { id: 'line1', text: 'Locked one', locked: true, number: 1 } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rewrite this line' }))
    expect(screen.getByText(/locked/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show what will be sent' })).toBeDisabled()
  })

  it('Insert and Replace go through the editor callbacks; Replace asks first', async () => {
    const p = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send to AI' }))
    await screen.findByText('Streetlights hum a lullaby')
    expect(screen.getByText('AI suggestion')).toBeInTheDocument()
    expect(screen.getByText('perfect rhyme')).toBeInTheDocument()
    expect(screen.getByText('≈ 7 syllables')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Replace line…' }))
    expect(p.onReplace).not.toHaveBeenCalled() // confirmation first
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(p.onReplace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Insert below' }))
    expect(p.onInsert).toHaveBeenCalledWith('Streetlights hum a lullaby', 'line1')
    fireEvent.click(screen.getByRole('button', { name: 'Replace line…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace it' }))
    expect(p.onReplace).toHaveBeenCalledWith('line1', 'Streetlights hum a lullaby')
    await waitFor(() => expect(api.aiAccept).toHaveBeenCalledWith('sg1'))
  })

  it('Preview shows the old and new line side by side without changing anything', async () => {
    const p = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send to AI' }))
    await screen.findByText('Streetlights hum a lullaby')
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByText('Now:')).toBeInTheDocument()
    expect(p.onInsert).not.toHaveBeenCalled()
    expect(p.onReplace).not.toHaveBeenCalled()
  })

  it('shows plain errors and keeps the writer’s work', async () => {
    api.aiSuggest.mockRejectedValue(
      new ApiFail('The AI took too long to answer. Nothing was changed.', {
        status: 504,
        code: 'AI_TIMEOUT',
      }),
    )
    const p = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send to AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed')
    expect(p.onInsert).not.toHaveBeenCalled()
  })

  it('critique shows advice with no insert buttons', async () => {
    api.getAiStatus.mockResolvedValue(
      status({
        tasks: [
          task('critique', 'Critique', { kind: 'notes', whole_song: true }),
        ] as AiStatus['tasks'],
      }),
    )
    api.aiSuggest.mockResolvedValue({
      ...result,
      kind: 'notes',
      suggestions: [],
      notes: ['The second line is strongest.'],
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send to AI' }))
    expect(await screen.findByText('The second line is strongest.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Insert below' })).not.toBeInTheDocument()
  })
})

describe('AiSetup', () => {
  it('saves the key and then clears it from the page', async () => {
    api.getAiStatus.mockResolvedValue(
      status({
        enabled: false,
        ready: false,
        key: { configured: false, source: null, hint: null },
      }),
    )
    api.putAiKey.mockResolvedValue(status({ enabled: false, ready: false }))
    show()
    const input = (await screen.findByLabelText('Your Claude API key')) as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'sk-ant-secret-1234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() =>
      expect(api.putAiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-secret-1234567'),
    )
    await waitFor(() =>
      expect((screen.getByLabelText(/Your Claude API key/) as HTMLInputElement).value).toBe(''),
    )
    expect(document.body.textContent).not.toContain('sk-ant-secret')
    expect(window.localStorage.length).toBe(0)
  })
})

describe('syllableText', () => {
  it('uses singular and ranges properly', () => {
    expect(syllableText({ min: 1, max: 1, exact: true, guessed: false })).toBe('≈ 1 syllable')
    expect(syllableText({ min: 6, max: 8, exact: false, guessed: false })).toBe('≈ 6–8 syllables')
  })
})
