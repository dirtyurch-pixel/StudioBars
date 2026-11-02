import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { ToastProvider } from '../components/Toasts'
import type { Song } from '../types'
import { PlayerProvider } from '../music/PlayerProvider'
import SongEditor from './SongEditor'

const api = vi.hoisted(() => ({
  getSong: vi.fn(),
  saveContent: vi.fn(),
  patchSong: vi.fn(),
  lockLine: vi.fn(),
  listRevisions: vi.fn(),
  listTracks: vi.fn(),
  getPlaybackState: vi.fn(),
  getSongLink: vi.fn(),
  listPlaylists: vi.fn(),
  savePlaybackState: vi.fn(),
  saveSongLink: vi.fn(),
  analyzeLines: vi.fn(),
  getPhoneticsStatus: vi.fn(),
  listCustomPron: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const mkSong = (over: Partial<Song> = {}): Song => ({
  id: 'song1234',
  title: 'Rain on Glass',
  concept: '',
  mood: '',
  point_of_view: '',
  bpm: null,
  time_signature: null,
  version: 1,
  created_at: '',
  updated_at: '',
  genres: ['r&b'],
  sections: [
    {
      id: 'sec00001',
      label: 'Verse 1',
      section_type: 'verse',
      lines: [
        { id: 'line0001', text: 'first', is_locked: false, comments: [] },
        { id: 'line0002', text: 'second', is_locked: true, comments: [] },
      ],
    },
  ],
  ...over,
})

const open = async () => {
  render(
    <ToastProvider>
      <PlayerProvider>
        <SongEditor id="song1234" />
      </PlayerProvider>
    </ToastProvider>,
  )
  return screen.findByLabelText('Line 1')
}
const flushTimers = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.resetAllMocks()
  api.getSong.mockResolvedValue(mkSong())
  api.listRevisions.mockResolvedValue([])
  api.listTracks.mockResolvedValue([])
  api.getPlaybackState.mockResolvedValue({
    track_id: null,
    playlist_id: null,
    position_seconds: 0,
    repeat_mode: 'off',
    shuffle_enabled: false,
    volume: 1,
    speed: 1,
  })
  api.getSongLink.mockResolvedValue(null)
  api.listPlaylists.mockResolvedValue([])
  api.savePlaybackState.mockResolvedValue({})
  api.analyzeLines.mockResolvedValue({ lines: [], families: [], unknown_words: [] })
  api.getPhoneticsStatus.mockResolvedValue({
    dictionary_words: 1,
    frequency_available: true,
    pos_available: false,
    custom_count: 0,
    quality_help: {},
    attribution: '',
  })
  api.listCustomPron.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('SongEditor autosave', () => {
  it('saves typed text after a short pause and shows Saved', async () => {
    const line1 = await open()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.saveContent.mockResolvedValue(mkSong({ version: 2 }))
    fireEvent.change(line1, { target: { value: 'first edited' } })
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
    await flushTimers(800)
    await waitFor(() => expect(api.saveContent).toHaveBeenCalledTimes(1))
    const [id, version, content] = api.saveContent.mock.calls[0]
    expect(id).toBe('song1234')
    expect(version).toBe(1)
    expect(content[0].lines[0].text).toBe('first edited')
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('keeps the text and shows Offline when the server cannot be reached, then recovers', async () => {
    const line1 = await open()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.saveContent
      .mockRejectedValueOnce(new ApiFail('x', { network: true }))
      .mockResolvedValue(mkSong({ version: 2 }))
    fireEvent.change(line1, { target: { value: 'kept' } })
    await flushTimers(800)
    expect(await screen.findAllByText(/Offline/)).not.toHaveLength(0)
    expect(screen.getByLabelText('Line 1')).toHaveValue('kept')
    await flushTimers(5000)
    await waitFor(() => expect(api.saveContent).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('pauses saving and offers a reload on a version conflict', async () => {
    const line1 = await open()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.saveContent.mockRejectedValue(
      new ApiFail('changed', { status: 409, code: 'VERSION_CONFLICT' }),
    )
    fireEvent.change(line1, { target: { value: 'mine' } })
    await flushTimers(800)
    expect(await screen.findByText(/changed in another window or tab/)).toBeInTheDocument()
    expect(api.saveContent).toHaveBeenCalledTimes(1)
  })

  it('when the server protects a locked line, the page reloads the saved copy', async () => {
    const line1 = await open()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.saveContent.mockRejectedValue(
      new ApiFail('locked', { status: 423, code: 'LOCKED_LINES', lineIds: ['line0002'] }),
    )
    fireEvent.change(line1, { target: { value: 'edited' } })
    await flushTimers(800)
    await waitFor(() => expect(api.getSong).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/locked line was protected/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Line 1')).toHaveValue('first')
  })
})

describe('SongEditor locks', () => {
  it('typing into a locked line does not change it and tells the user', async () => {
    await open()
    const locked = screen.getByLabelText('Line 2 (locked)')
    fireEvent.keyDown(locked, { key: 'x' })
    fireEvent.change(locked, { target: { value: 'hacked' } }) // even a forced change event
    expect(await screen.findByText(/That line is locked/)).toBeInTheDocument()
    expect(screen.getByLabelText('Line 2 (locked)')).toHaveValue('second')
    expect(api.saveContent).not.toHaveBeenCalled()
  })

  it('undo never changes a locked line', async () => {
    const line1 = await open()
    fireEvent.change(line1, { target: { value: 'edit one' } })
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(screen.getByLabelText('Line 1')).toHaveValue('first')
    expect(screen.getByLabelText('Line 2 (locked)')).toHaveValue('second')
  })

  it('locking saves pending text first, then locks', async () => {
    const line1 = await open()
    const order: string[] = []
    api.saveContent.mockImplementation(async () => {
      order.push('save')
      return mkSong({ version: 2 })
    })
    api.lockLine.mockImplementation(async () => {
      order.push('lock')
      const s = mkSong({ version: 2 })
      s.sections[0].lines[0] = {
        id: 'line0001',
        text: 'first typed',
        is_locked: true,
        comments: [],
      }
      return s
    })
    fireEvent.change(line1, { target: { value: 'first typed' } })
    fireEvent.focus(line1)
    fireEvent.click(screen.getByRole('button', { name: 'Lock line' }))
    await waitFor(() => expect(screen.getByLabelText('Line 1 (locked)')).toBeInTheDocument())
    expect(order).toEqual(['save', 'lock'])
    expect(screen.getByLabelText('Line 1 (locked)')).toHaveValue('first typed')
  })
})

describe('SongEditor states', () => {
  it('shows a not-found message', async () => {
    api.getSong.mockRejectedValue(new ApiFail('nope', { status: 404 }))
    render(
      <ToastProvider>
        <PlayerProvider>
          <SongEditor id="gone1234" />
        </PlayerProvider>
      </ToastProvider>,
    )
    expect(await screen.findByText('Song not found')).toBeInTheDocument()
  })

  it('shows a clear error when the server is down, with a retry', async () => {
    api.getSong
      .mockRejectedValueOnce(new ApiFail('x', { network: true }))
      .mockResolvedValue(mkSong())
    render(
      <ToastProvider>
        <PlayerProvider>
          <SongEditor id="song1234" />
        </PlayerProvider>
      </ToastProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cannot reach/)
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByLabelText('Line 1')).toBeInTheDocument()
  })

  it('Focus Mode hides the tool panels but keeps the lyrics', async () => {
    await open()
    fireEvent.keyDown(window, { key: 'f', altKey: true })
    expect(document.querySelector('.editor.focus')).not.toBeNull()
    expect(screen.getByLabelText('Line 1')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.editor.focus')).toBeNull()
  })
})
