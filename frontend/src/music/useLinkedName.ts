import { useEffect, useState } from 'react'
import { listPlaylists } from '../api'
import type { PlaylistSummary } from '../types'
import { usePlayer } from './playerContext'
import type { SongLinkApi } from './useSongLink'

/** Short description of a song's linked music, used by the panel and the session strip. */
export function useLinkedName(api: SongLinkApi): string | null {
  const p = usePlayer()
  const [lists, setLists] = useState<PlaylistSummary[]>([])
  useEffect(() => {
    if (api.link?.playlist_id)
      listPlaylists()
        .then(setLists)
        .catch(() => {})
  }, [api.link?.playlist_id])
  const l = api.link
  if (!l) return null
  if (l.track_id) return p.library.find((t) => t.id === l.track_id)?.title ?? 'a track'
  if (l.playlist_id) return lists.find((x) => x.id === l.playlist_id)?.name ?? 'a playlist'
  return null
}
