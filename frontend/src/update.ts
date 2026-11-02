/**
 * App updates without surprises: a new version downloads in the background, then the page shows
 * "A new version is ready" and only switches when the writer taps Reload (after saving).
 */
let waiting: ServiceWorker | null = null
const listeners = new Set<() => void>()

export const updateReady = () => waiting !== null
export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function found(w: ServiceWorker | null) {
  if (!w || !navigator.serviceWorker.controller) return // first install: nothing to replace
  waiting = w
  listeners.forEach((f) => f())
}

export function watchForUpdates(reg: ServiceWorkerRegistration) {
  if (reg.waiting) found(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const w = reg.installing
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') found(w)
    })
  })
  // look for a new version when the app comes back to the front, at most every 30 minutes
  let last = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last > 30 * 60_000) {
      last = Date.now()
      reg.update().catch(() => undefined)
    }
  })
}

/** Switch to the new version: the page reloads once the new version has taken over. */
export function applyUpdate() {
  if (!waiting) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  waiting.postMessage('SKIP_WAITING')
}
