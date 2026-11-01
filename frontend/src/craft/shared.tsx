import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFail } from '../api'

export type ActiveLine = { id: string; text: string; locked: boolean; number: number } | null

export type CraftProps = {
  songId: string
  sectionLines: { id: string; text: string; is_locked: boolean }[]
  activeLine: ActiveLine
  bpm: number | null
  /** Put text on a NEW line below `afterId` through the editor's guarded path. */
  onInsert: (text: string, afterId: string | null) => boolean
  /** Replace a line's text through the editor's guarded path (refused for locked lines). */
  onReplace: (id: string, text: string) => boolean
}

export const msg = (e: unknown, fallback = 'Something went wrong.') =>
  e instanceof ApiFail ? e.message : fallback

/** Load something from the server and keep it. `reload` fetches again. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current())
      setError('')
    } catch (e) {
      setError(msg(e, 'Could not load.'))
    }
  }, [])
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, reload, setData }
}

export function recordingSupported(): { ok: boolean; why: string } {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, why: 'This browser cannot record audio.' }
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      why: 'Browsers only allow the microphone on a secure connection (https:// or localhost). Over plain http:// on your Wi-Fi it is blocked. Record on the computer running Studio Bars, or put the app behind https (for example with a private tunnel such as Tailscale).',
    }
  }
  return { ok: true, why: '' }
}
