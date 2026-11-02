import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { ToastProvider } from '../components/Toasts'
import Dashboard from './Dashboard'

const api = vi.hoisted(() => ({ listSongs: vi.fn(), deleteSong: vi.fn(), undeleteSong: vi.fn() }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const wrap = () =>
  render(
    <ToastProvider>
      <Dashboard />
    </ToastProvider>,
  )
const song = {
  id: 'abc12345',
  title: 'Rain on Glass',
  bpm: 82,
  time_signature: '4/4',
  updated_at: new Date().toISOString(),
  deleted_at: null,
  genres: ['r&b'],
  line_count: 12,
  locked_count: 2,
}

beforeEach(() => vi.resetAllMocks())

describe('Dashboard states', () => {
  it('shows a loading state, then the empty state', async () => {
    api.listSongs.mockResolvedValue([])
    wrap()
    expect(screen.getByText(/Loading your songs/)).toBeInTheDocument()
    expect(await screen.findByText('No songs yet')).toBeInTheDocument()
  })

  it('shows a helpful error when the server is unreachable, and retries', async () => {
    api.listSongs
      .mockRejectedValueOnce(new ApiFail('x', { network: true }))
      .mockResolvedValue([song])
    wrap()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Cannot reach the Studio Bars server/,
    )
    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByText('Rain on Glass')).toBeInTheDocument()
  })

  it('lists songs with genre, lines and locked count', async () => {
    api.listSongs.mockResolvedValue([song])
    wrap()
    expect(await screen.findByText('R&B')).toBeInTheDocument()
    expect(screen.getByText('82 BPM')).toBeInTheDocument()
    expect(screen.getByText(/12 lines · 🔒 2/)).toBeInTheDocument()
  })

  it('asks before deleting', async () => {
    api.listSongs.mockResolvedValue([song])
    api.deleteSong.mockResolvedValue(undefined)
    wrap()
    fireEvent.click(await screen.findByLabelText('Delete Rain on Glass'))
    expect(api.deleteSong).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Yes, delete'))
    await waitFor(() => expect(api.deleteSong).toHaveBeenCalledWith('abc12345'))
  })
})
