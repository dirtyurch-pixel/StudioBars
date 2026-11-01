import { formatTime, loopActive } from './logic'
import { usePlayer } from './playerContext'
import { useLinkedName } from './useLinkedName'
import type { SongLinkApi } from './useSongLink'

export function SessionStrip({ songLink }: { songLink: SongLinkApi }) {
  const p = usePlayer()
  const name = useLinkedName(songLink)
  const l = songLink.link
  if (!l || !name) return null
  const loaded = p.track && (p.track.id === l.track_id || p.playlistId === l.playlist_id)
  return (
    <div className="session hide-focus" role="status" aria-label="Writing session">
      <span>
        ♪ <b>Session:</b> {name}
        {loopActive({ a: l.loop_a, b: l.loop_b }) && (
          <>
            {' '}
            · loop {formatTime(l.loop_a)}–{formatTime(l.loop_b)}
          </>
        )}
        {l.speed !== 1 && <> · {l.speed}×</>}
      </span>
      {!loaded && (
        <button className="btn" onClick={() => void songLink.loadLinked(l)}>
          Load it
        </button>
      )}
    </div>
  )
}

export function SongMusicPanel({ songLink }: { songLink: SongLinkApi }) {
  const p = usePlayer()
  const name = useLinkedName(songLink)
  const l = songLink.link
  return (
    <div className="panel-body">
      <p className="hint">
        Link music to this song. When you open the song again, its music is loaded (paused) with the
        same loop, speed and position. Your audio stays on this computer; the link is not part of
        exports.
      </p>
      {l === undefined && <p className="hint">Loading…</p>}
      {l && name ? (
        <div className="card">
          <b>♪ {name}</b>
          <small>
            {l.speed}× · position {formatTime(l.position_seconds)}
            {loopActive({ a: l.loop_a, b: l.loop_b })
              ? ` · loop ${formatTime(l.loop_a)}–${formatTime(l.loop_b)}`
              : ' · no loop saved'}
          </small>
          <div className="actions">
            <button className="btn" onClick={() => void songLink.loadLinked(l)}>
              Load it
            </button>
            <button className="btn btn-ghost" onClick={() => void songLink.unlink()}>
              Unlink
            </button>
          </div>
        </div>
      ) : (
        l === null && <p className="hint">No music linked yet.</p>
      )}
      <div className="actions">
        <button
          className="btn"
          disabled={!p.track}
          onClick={() => void songLink.linkCurrentTrack()}
        >
          Link current track{p.track ? `: ${p.track.title}` : ''}
        </button>
        <button
          className="btn"
          disabled={!p.playlistId}
          onClick={() => void songLink.linkCurrentPlaylist()}
        >
          Link current playlist
        </button>
      </div>
      <p className="hint">
        The loop (A–B), speed and position are saved with the link automatically while its music is
        loaded.
        {!p.track && ' Load a track from the Library first.'}
      </p>
      <button className="btn btn-ghost" onClick={() => p.setDrawerOpen(true)}>
        Open music library
      </button>
    </div>
  )
}
