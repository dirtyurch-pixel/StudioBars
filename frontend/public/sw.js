/* Keeps the app's own pages available with no connection. It NEVER stores /api answers (your lyrics). */
const CACHE = 'studio-bars-shell-v2'
const BASE = new URL(self.registration.scope).pathname // "/" or "/StudioBars/"
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([BASE, BASE + 'manifest.webmanifest', BASE + 'icon.svg']))
      .then(() => self.skipWaiting()),
  )
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req).then((m) => m || caches.match(BASE))),
  )
})
