import { useEffect, useState } from 'react'

const SMALL = '(max-width: 899px)'
const BLUR_DELAY_MS = 350

/**
 * Phone writing mode: true while a lyric line has the keyboard on a small screen.
 * Sets `data-writing` on <html> so the header, tools and music bar can step aside, and keeps `--kb`
 * (how much of the bottom the keyboard covers, for browsers that overlay it) up to date.
 */
export function useWritingMode(): boolean {
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    const small = window.matchMedia?.(SMALL)
    let timer: ReturnType<typeof setTimeout> | undefined
    const isLine = (t: EventTarget | null) =>
      !!(t as HTMLElement | null)?.matches?.('[data-line-input]')
    const on = (e: FocusEvent) => {
      if (isLine(e.target) && small?.matches) {
        clearTimeout(timer)
        setWriting(true)
      }
    }
    const off = () => {
      clearTimeout(timer)
      // wait a moment: moving from one line to the next briefly leaves no line focused
      timer = setTimeout(() => {
        if (!isLine(document.activeElement)) setWriting(false)
      }, BLUR_DELAY_MS)
    }
    document.addEventListener('focusin', on)
    document.addEventListener('focusout', off)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', on)
      document.removeEventListener('focusout', off)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (writing) root.dataset.writing = '1'
    else delete root.dataset.writing
    return () => {
      delete root.dataset.writing
    }
  }, [writing])

  // where the keyboard is (only needed where the browser lays the keyboard OVER the page)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const set = () => {
      const cover = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--kb', `${Math.round(cover)}px`)
    }
    set()
    vv.addEventListener('resize', set)
    vv.addEventListener('scroll', set)
    return () => {
      vv.removeEventListener('resize', set)
      vv.removeEventListener('scroll', set)
      document.documentElement.style.removeProperty('--kb')
    }
  }, [])

  return writing
}
