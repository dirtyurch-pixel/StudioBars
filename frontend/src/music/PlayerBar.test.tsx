import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toasts'
import type { Track } from '../types'
import { MusicDrawer } from './MusicDrawer'
import { PlayerBar } from './PlayerBar'
import { PlayerProvider } from './PlayerProvider'
import { probeAudio } from './logic'

const api = vi.hoisted(() => ({
  listTracks: vi.fn(),
  getPlaybackState: vi.fn(),
  savePlaybackState: vi.fn(),
  listPlaylists: vi.fn(),
  uploadTrack: vi.fn(),
}))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))
vi.mock('./logic', async (orig) => ({
  ...(await orig<typeof import('./logic')>()),
  probeAudio: vi.fn(),
}))

const mkTrack = (id: string, title: string, over: Partial<Track> = {}): Track => ({
  id,
  title,
  artist: '',
  album: '',
  duration: 60,
  media_type: 'audio/wav',
  ext: 'wav',
  size_bytes: 1000,
  added_at: '',
  available: true,
  file_version: 'abc',
  ...over,
}) // fmt: skip
const tracks = [
  mkTrack('t1', 'Slow Tide'),
  mkTrack('t2', 'Night Drive'),
  mkTrack('t3', 'Lost One', { available: false }),
]

let audio: HTMLAudioElement & { currentTime: number }
const RealAudio = window.Audio

function setup() {
  render(
    <ToastProvider>
      <PlayerProvider>
        <input data-line-input aria-label="a lyric line" />
        <MusicDrawer />
        <PlayerBar />
      </PlayerProvider>
    </ToastProvider>,
  )
}
async function openLibraryAndPlay(title: string) {
  fireEvent.click(await screen.findByLabelText('Music library and playlists'))
  fireEvent.click(await screen.findByLabelText(`Play ${title}`))
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.stubGlobal('Audio', function MockAudio() {
    audio = new RealAudio() as typeof audio
    let t = 0
    Object.defineProperty(audio, 'currentTime', {
      get: () => t,
      set: (v: number) => (t = v),
      configurable: true,
    })
    return audio
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'preservesPitch', {
    value: false,
    writable: true,
    configurable: true,
  })
  api.listTracks.mockResolvedValue(tracks)
  api.getPlaybackState.mockResolvedValue({
    track_id: null,
    playlist_id: null,
    position_seconds: 0,
    repeat_mode: 'off',
    shuffle_enabled: false,
    volume: 1,
    speed: 1,
  })
  api.savePlaybackState.mockResolvedValue({})
  api.listPlaylists.mockResolvedValue([])
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).preservesPitch
})

describe('player bar', () => {
  it('starts with an honest empty state and a way to open the library', async () => {
    setup()
    expect(await screen.findByText('No music loaded')).toBeInTheDocument()
    expect(screen.getByLabelText('Play')).toBeDisabled()
  })

  it('plays a track from the library and shows what is playing', async () => {
    setup()
    await openLibraryAndPlay('Slow Tide')
    expect(
      await screen.findByLabelText('Pause').catch(() => screen.getByLabelText('Play')),
    ).toBeInTheDocument()
    expect(within(screen.getByLabelText('Music player')).getByText('Slow Tide')).toBeInTheDocument()
    expect(audio.src).toContain('/api/music/tracks/t1/audio')
  })

  it('a track whose file is missing cannot be played and offers to relink', async () => {
    setup()
    fireEvent.click(await screen.findByLabelText('Music library and playlists'))
    expect(await screen.findByLabelText('Play Lost One')).toBeDisabled()
    expect(screen.getByText(/File missing/)).toBeInTheDocument()
    expect(screen.getByText('Relink file')).toBeInTheDocument()
  })

  it('A–B loop: rejects an end before the start, accepts a valid loop', async () => {
    setup()
    await openLibraryAndPlay('Slow Tide')
    audio.currentTime = 10
    fireEvent.click(await screen.findByLabelText('Set loop start (A) here'))
    audio.currentTime = 5
    fireEvent.click(screen.getByLabelText('Set loop end (B) here'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/after the start/)
    audio.currentTime = 20
    fireEvent.click(screen.getByLabelText('Set loop end (B) here'))
    expect(await screen.findByText(/Looping 0:10–0:20/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Clear loop'))
    expect(screen.queryByText(/Looping/)).not.toBeInTheDocument()
  })

  it('speed changes keep the pitch steady', async () => {
    setup()
    await openLibraryAndPlay('Slow Tide')
    fireEvent.change(await screen.findByLabelText('Playback speed'), { target: { value: '0.85' } })
    expect(audio.playbackRate).toBe(0.85)
    expect(audio.preservesPitch).toBe(true)
  })

  it('says so and disables speed when the browser cannot keep pitch', async () => {
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).preservesPitch
    setup()
    await openLibraryAndPlay('Slow Tide')
    expect(await screen.findByLabelText('Playback speed')).toBeDisabled()
    expect(screen.getByText(/cannot keep the pitch steady/)).toBeInTheDocument()
  })

  it('Space plays and pauses, but never while typing a lyric', async () => {
    setup()
    await openLibraryAndPlay('Slow Tide')
    const play = vi.spyOn(audio, 'play')
    const before = play.mock.calls.length
    fireEvent.keyDown(screen.getByLabelText('a lyric line'), { key: ' ' })
    expect(play.mock.calls.length).toBe(before)
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(play.mock.calls.length).toBe(before + 1)
  })

  it('does not steal focus from the lyric when a transport button is pressed', async () => {
    setup()
    await openLibraryAndPlay('Slow Tide')
    const line = screen.getByLabelText('a lyric line')
    line.focus()
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    screen.getByLabelText('Next track').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(line)
  })

  it('shrinks to the essentials while typing on a phone', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }))
    setup()
    await openLibraryAndPlay('Slow Tide')
    const bar = screen.getByLabelText('Music player')
    expect(bar).not.toHaveClass('compact')
    screen.getByLabelText('a lyric line').focus()
    await waitFor(() => expect(bar).toHaveClass('compact'))
    expect(screen.getByLabelText(/^(Play|Pause)$/)).toBeInTheDocument() // play/pause stays reachable
    screen.getByLabelText('a lyric line').blur()
    await waitFor(() => expect(bar).not.toHaveClass('compact'))
  })

  it('does not grow back the instant focus leaves a field, so a tap on a button is not lost', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }))
    setup()
    await openLibraryAndPlay('Slow Tide')
    const bar = screen.getByLabelText('Music player')
    screen.getByLabelText('a lyric line').focus()
    await waitFor(() => expect(bar).toHaveClass('compact'))
    screen.getByLabelText('a lyric line').blur()
    await new Promise((r) => setTimeout(r, 150)) // the moment a finger lands and lifts
    expect(bar).toHaveClass('compact')
    await waitFor(() => expect(bar).not.toHaveClass('compact'), { timeout: 2000 })
  })

  it('does not grow over a button the user is tapping while the keyboard is open', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }))
    render(
      <ToastProvider>
        <PlayerProvider>
          <input data-line-input aria-label="a lyric line" />
          <button>Look up</button>
          <PlayerBar />
        </PlayerProvider>
      </ToastProvider>,
    )
    const bar = screen.getByLabelText('Music player')
    screen.getByLabelText('a lyric line').focus()
    await waitFor(() => expect(bar).toHaveClass('compact'))
    screen.getByText('Look up').focus() // what a tap does: focus leaves the field and lands on the button
    await new Promise((r) => setTimeout(r, 150))
    expect(bar).toHaveClass('compact') // still small at the moment the finger lifts
    await waitFor(() => expect(bar).not.toHaveClass('compact'), { timeout: 2000 })
  })

  it('stays small when focus simply moves from one text field to another', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }))
    render(
      <ToastProvider>
        <PlayerProvider>
          <input data-line-input aria-label="first line" />
          <input data-line-input aria-label="second line" />
          <PlayerBar />
        </PlayerProvider>
      </ToastProvider>,
    )
    const bar = screen.getByLabelText('Music player')
    screen.getByLabelText('first line').focus()
    await waitFor(() => expect(bar).toHaveClass('compact'))
    screen.getByLabelText('second line').focus()
    await new Promise((r) => setTimeout(r, 600))
    expect(bar).toHaveClass('compact')
  })

  it('shows a clear message when the music server is unreachable', async () => {
    api.listTracks.mockRejectedValue(new Error('down'))
    setup()
    expect(await screen.findByText(/Music library unavailable/)).toBeInTheDocument()
  })
})

describe('import', () => {
  const file = (name: string) => new File([new Uint8Array(10)], name)

  it('needs explicit consent before any file can be chosen', async () => {
    setup()
    fireEvent.click(await screen.findByLabelText('Music library and playlists'))
    const input = await screen.findByLabelText(/Choose music/)
    expect(input).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(input).toBeEnabled()
  })

  it('reports each file: added, unsupported type, and damaged', async () => {
    vi.mocked(probeAudio).mockImplementation(async (f: File) => {
      if (f.name === 'damaged.wav')
        throw new Error(
          "This browser can't play that file (it may be damaged or use an unsupported codec).",
        )
      return 30
    })
    api.uploadTrack.mockResolvedValue(mkTrack('n1', 'good'))
    setup()
    fireEvent.click(await screen.findByLabelText('Music library and playlists'))
    await userEvent.click(await screen.findByRole('checkbox'))
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByLabelText(/Choose music/), [
      file('notes.txt'),
      file('good.wav'),
      file('damaged.wav'),
    ])
    const list = await screen.findByLabelText('Import results')
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3))
    expect(list).toHaveTextContent(/notes\.txt.*not a supported audio type/)
    expect(list).toHaveTextContent(/good\.wav.*Added/)
    expect(list).toHaveTextContent(/damaged\.wav.*can't play/)
    expect(api.uploadTrack).toHaveBeenCalledTimes(1) // only the good file was copied
  })
})
