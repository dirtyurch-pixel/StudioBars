/* Keeps the app working with no connection. It stores the app's own files (and, in the phone version, its
   dictionaries). It NEVER stores /api answers (your lyrics live in the browser's database, not here). */
const CACHE = 'studio-bars-shell-v4'
const BASE = new URL(self.registration.scope).pathname // "/" or "/StudioBars/"

async function precache() {
  const c = await caches.open(CACHE)
  await c.addAll([BASE, BASE + 'manifest.webmanifest', BASE + 'icon.svg'])
  // the built page names its script and style files; keep those too, so the app opens offline next time
  const html = await (await c.match(BASE)).text()
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|svg))"/g)].map((m) => m[1]).filter((u) => u.startsWith(BASE))
  await Promise.all(assets.map((u) => c.add(u).catch(() => undefined)))
  // the phone version's pronunciation dictionary (only exists in the phone build; ignored elsewhere)
  await Promise.all(['data/cmudict.txt', 'data/frequency_en.txt'].map((f) => c.add(BASE + f).catch(() => undefined)))
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()))
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
      .catch(() =>
        caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((m) => m || (req.mode === 'navigate' ? caches.match(BASE, { ignoreVary: true }) : undefined)),
      ),
  )
})
