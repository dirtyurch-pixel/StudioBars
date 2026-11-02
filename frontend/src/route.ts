import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'settings' } | { name: 'song'; id: string }

export function parseHash(hash: string): Route {
  if (hash === '#/settings') return { name: 'settings' }
  const m = /^#\/song\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  return m ? { name: 'song', id: m[1] } : { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const goHome = () => {
  window.location.hash = '#/'
}
export const goSettings = () => {
  window.location.hash = '#/settings'
}
export const goSong = (id: string) => {
  window.location.hash = `#/song/${id}`
}
