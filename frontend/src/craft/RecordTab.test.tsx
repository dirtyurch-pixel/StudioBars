import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerContext, type PlayerValue } from '../music/playerContext'
import { RecordTab } from './RecordTab'
import type { CraftProps } from './shared'
import { recordingSupported } from './shared'

const api = vi.hoisted(() => ({
  listVocals: vi.fn(),
  uploadVocal: vi.fn(),
  patchVocal: vi.fn(),
  deleteVocal: vi.fn(),
  vocalUrl: (id: string) => `/a/${id}`,
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

const props: CraftProps = {
  songId: 's1',
  sectionLines: [],
  activeLine: null,
  bpm: null,
  onInsert: vi.fn(),
  onReplace: vi.fn(),
}
const player = {
  track: null,
  playing: false,
  time: 0,
  toggle: vi.fn(),
  pause: vi.fn(),
} as unknown as PlayerValue
const show = () =>
  render(
    <PlayerContext.Provider value={player}>
      <RecordTab {...props} />
    </PlayerContext.Provider>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  api.listVocals.mockReset()
})

describe('recording support', () => {
  it('explains plainly when the microphone is blocked on plain http', () => {
    vi.stubGlobal('MediaRecorder', class {})
    vi.stubGlobal('isSecureContext', false)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    })
    const s = recordingSupported()
    expect(s.ok).toBe(false)
    expect(s.why).toMatch(/https:\/\/ or localhost/)
  })

  it('says so when the browser cannot record at all', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(recordingSupported()).toEqual({ ok: false, why: 'This browser cannot record audio.' })
  })

  it('shows the explanation instead of a Record button, and still lists saved takes', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    api.listVocals.mockResolvedValue([
      {
        id: 't1',
        song_id: 's1',
        duration_ms: 65000,
        offset_ms: 250,
        note: 'first',
        size_bytes: 10,
        media_type: 'audio/webm',
        created_at: '',
        available: true,
      },
    ])
    show()
    expect(screen.getByRole('status')).toHaveTextContent('cannot record')
    expect(screen.queryByRole('button', { name: /Record/ })).not.toBeInTheDocument()
    expect(await screen.findByText(/Take 1 · 1:05/)).toBeInTheDocument()
    expect(screen.getByLabelText('Playback of take 1')).toHaveAttribute('src', '/a/t1')
  })
})
