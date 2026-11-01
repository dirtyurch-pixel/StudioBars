import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useToast } from '../components/toastContext'
import type { SongAudioLink } from '../types'
import { usePlayer } from './playerContext'

/**
 * Writing Session foundation: remembers which music goes with a song, plus the loop,
 * speed and position, and loads it (paused) when the song is opened.
 */
export function useSongLink(songId: string) {
  const p = usePlayer()
  const toast = useToast()
  const [link, setLink] = useState<SongAudioLink | null | undefined>(undefined)
  const autoLoaded = useRef(false)
  const live = useRef({ time: 0 })
  live.current.time = p.time

  useEffect(() => {
    let off = false
    api
      .getSongLink(songId)
      .then((l) => !off && setLink(l))
      .catch(() => !off && setLink(null))
    return () => {
      off = true
    }
  }, [songId])

  const loadLinked = useCallback(
    async (l: SongAudioLink, autoplay = false) => {
      const opts = {
        autoplay,
        startAt: l.position_seconds,
        loop: { a: l.loop_a, b: l.loop_b },
        speed: l.speed,
      }
      try {
        if (l.track_id) {
          const t = p.library.find((x) => x.id === l.track_id)
          if (!t) return toast('The linked track is no longer in your library.', 'error')
          p.playList([t], 0, opts)
        } else if (l.playlist_id) {
          const pl = await api.getPlaylist(l.playlist_id)
          const tracks = pl.entries.map((e) => e.track)
          if (!tracks.length) return toast('The linked playlist is empty.', 'error')
          p.playList(tracks, 0, { ...opts, playlistId: pl.id })
        }
      } catch {
        toast('The linked music could not be loaded.', 'error')
      }
    },
    [p, toast],
  )

  // open a song -> load its music, paused, unless something is already playing
  useEffect(() => {
    if (autoLoaded.current || !link || !p.libraryLoaded) return
    autoLoaded.current = true
    if (!p.playing) void loadLinked(link)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, p.libraryLoaded])

  const matches =
    !!link &&
    ((link.track_id !== null && p.track?.id === link.track_id) ||
      (link.playlist_id !== null && p.playlistId === link.playlist_id))

  // keep the saved loop / speed / position current while the linked music is loaded
  useEffect(() => {
    if (!matches || !link) return
    const body = {
      track_id: link.track_id,
      playlist_id: link.playlist_id,
      loop_a: p.loop.a,
      loop_b: p.loop.b,
      position_seconds: Math.max(0, live.current.time),
      speed: p.speed,
    }
    const id = setTimeout(() => {
      api
        .saveSongLink(songId, body)
        .then(setLink)
        .catch(() => {})
    }, 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, p.loop.a, p.loop.b, p.speed, p.playing])

  useEffect(() => {
    if (!matches || !p.playing || !link) return
    const id = setInterval(() => {
      api
        .saveSongLink(songId, {
          track_id: link.track_id,
          playlist_id: link.playlist_id,
          loop_a: p.loop.a,
          loop_b: p.loop.b,
          position_seconds: Math.max(0, live.current.time),
          speed: p.speed,
        })
        .catch(() => {})
    }, 15000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, p.playing, p.loop.a, p.loop.b, p.speed])

  const save = async (body: Partial<SongAudioLink>) => {
    try {
      setLink(await api.saveSongLink(songId, body))
      return true
    } catch (e) {
      toast(e instanceof api.ApiFail ? e.message : 'Could not save the link.', 'error')
      return false
    }
  }

  return {
    link,
    loadLinked,
    linkCurrentTrack: () =>
      p.track &&
      save({
        track_id: p.track.id,
        loop_a: p.loop.a,
        loop_b: p.loop.b,
        position_seconds: p.time,
        speed: p.speed,
      }),
    linkCurrentPlaylist: () =>
      p.playlistId &&
      save({
        playlist_id: p.playlistId,
        loop_a: p.loop.a,
        loop_b: p.loop.b,
        position_seconds: 0,
        speed: p.speed,
      }),
    unlink: () => save({}),
  }
}

export type SongLinkApi = ReturnType<typeof useSongLink>
