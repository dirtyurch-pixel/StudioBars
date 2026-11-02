import { useEffect, useState } from 'react'
import { listSongs } from '../api'
import { goHome } from '../route'
import { dayLabel } from '../time'
import type { SongSummary } from '../types'

/** Wide screens: your other songs, one tap away (Design A three-column workspace). */
export function SongsSidebar({
  currentId,
  onOpen,
  onHide,
}: {
  currentId: string
  onOpen: (id: string) => void
  onHide: () => void
}) {
  const [songs, setSongs] = useState<SongSummary[] | null>(null)
  useEffect(() => {
    let live = true
    listSongs(false).then(
      (s) => live && setSongs(s),
      () => live && setSongs([]),
    )
    return () => {
      live = false
    }
  }, [currentId])
  return (
    <aside className="ed-songs hide-focus" aria-label="Songs">
      <div className="ed-songs-head">
        <button className="btn btn-ghost btn-sm" onClick={goHome}>
          All songs
        </button>
        <button className="icon-btn" onClick={onHide} aria-label="Hide song list" title="Hide">
          ‹
        </button>
      </div>
      <ul>
        {songs?.map((s) => (
          <li key={s.id}>
            <button
              className={s.id === currentId ? 'on' : ''}
              aria-current={s.id === currentId ? 'page' : undefined}
              onClick={() => s.id !== currentId && onOpen(s.id)}
            >
              <span className="t">{s.title}</span>
              <small>{dayLabel(s.updated_at)}</small>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
