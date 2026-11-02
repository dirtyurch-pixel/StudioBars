/* Keeps the app working with no connection. It stores the app's own files (and, in the phone version, its
   dictionaries). It NEVER stores /api answers (your lyrics live in the browser's database, not here). */
const CACHE = 'studio-bars-shell-v6'
const MINE = /^studio-bars-/ // only ever remove OUR old caches (other apps can share this web address)
const BASE = new URL(self.registration.scope).pathname // "/" or "/StudioBars/"

async function precache() {
  const c = await caches.open(CACHE)
  await c.addAll([BASE, BASE + 'manifest.webmanifest', BASE + 'icon.svg'])
  // the built page names its script and style files; keep those too, so the app opens offline next time
  const html = await (await c.match(BASE)).text()
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|svg))"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith(BASE))
  await Promise.all(assets.map((u) => c.add(u).catch(() => undefined)))
  // fonts are named inside the style files; keep them too so the app looks the same offline
  for (const css of assets.filter((u) => u.endsWith('.css'))) {
    const res = await c.match(css)
    if (!res) continue
    const fonts = [...(await res.text()).matchAll(/url\(([^)]+\.woff2)\)/g)].map(
      (m) => new URL(m[1].replace(/["']/g, ''), self.location.origin + css).pathname,
    )
    await Promise.all(fonts.map((u) => c.add(u).catch(() => undefined)))
  }
  // the phone version's pronunciation dictionary (only exists in the phone build; ignored elsewhere)
  await Promise.all(
    ['data/cmudict.txt', 'data/frequency_en.txt'].map((f) =>
      c.add(BASE + f).catch(() => undefined),
    ),
  )
}

self.addEventListener('install', (e) => {
  // First install: start at once. An UPDATE waits until the writer taps "Reload" (never swaps mid-session).
  // One exception: versions before v5 had no "Reload to update" button, so moving off them happens at once.
  e.waitUntil(
    precache()
      .then(() => caches.has('studio-bars-shell-v4'))
      .then((oldVersion) =>
        !self.registration.active || oldVersion ? self.skipWaiting() : undefined,
      ),
  )
})
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(ks.filter((k) => MINE.test(k) && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/'))
    return
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
        caches
          .match(req, { ignoreSearch: true, ignoreVary: true })
          .then(
            (m) =>
              m || (req.mode === 'navigate' ? caches.match(BASE, { ignoreVary: true }) : undefined),
          ),
      ),
  )
})
