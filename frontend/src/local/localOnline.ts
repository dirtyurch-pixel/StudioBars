/**
 * Optional online word helper (Datamuse, https://www.datamuse.com/api/) for the phone version.
 * Same rules as backend/app/lexicon/online.py:
 * - OFF until you turn it on. Nothing is ever sent while it is off.
 * - Only ONE word that you typed or selected is sent. Never lyrics, never a song title. No cookies.
 * - Short timeout, a rate limit, and a saved copy of every answer (fresh for 7 days) on this device.
 * - If the service is unreachable or refuses, saved answers are shown instead of an error.
 */
import { ApiFail } from '../apiFail'
import type { OnlineKind, OnlineResult, OnlineStatus } from '../types'
import { db, nowIso } from './localApi'
import { cleanWord } from './localWords'

export const KINDS: Record<OnlineKind, string> = {
  related: 'ml',
  associated: 'rel_trg',
  'sounds-like': 'sl',
  rhymes: 'rel_rhy',
  'near-rhymes': 'rel_nry',
}
const FRESH_DAYS = 7
const MAX_CACHE = 5000
const TIMEOUT_MS = 4000
const OK_WORD = /^[A-Za-z][A-Za-z' -]{0,58}$/
const BASE = 'https://api.datamuse.com'
const fail = (status: number, code: string, message: string) =>
  new ApiFail(message, { status, code })

type Saved = { key: string; body: unknown[]; fetched_at: string }
type Setting = { value: string }

class Limiter {
  tokens: number
  last = Date.now()
  constructor(
    private capacity = 10,
    private perSecond = 2,
  ) {
    this.tokens = capacity
  }
  allow() {
    const t = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond)
    this.last = t
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }
}
const limiter = new Limiter()

async function isEnabled() {
  return (await db().get<Setting>('settings', 'online_helper_enabled'))?.value === '1'
}

export async function onlineStatus(): Promise<OnlineStatus> {
  return {
    enabled: await isEnabled(),
    service: 'Datamuse',
    host: 'api.datamuse.com',
    cached_answers: (await db().all('online')).length,
    sends:
      'The word you look up, and the first letters you type in the look-up box (for spelling suggestions). Never your lyrics or song titles.',
    key_notice: 'Datamuse has announced that an API key will be required from 1 February 2027.',
  }
}

export async function setOnlineEnabled(enabled: boolean): Promise<OnlineStatus> {
  await db().put<Setting>('settings', 'online_helper_enabled', { value: enabled ? '1' : '0' })
  return onlineStatus()
}

class OnlineError extends Error {}

/** The one place the phone version talks to the internet. */
async function httpGet(url: string): Promise<unknown> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      signal: ctl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new OnlineError('Cannot reach the online word service.')
  } finally {
    clearTimeout(t)
  }
  if ([401, 402, 403].includes(res.status))
    throw new OnlineError('The word service refused the request. It may now need an API key.')
  if (res.status === 429) throw new OnlineError('The word service is asking us to slow down.')
  if (!res.ok) throw new OnlineError(`The word service had a problem (HTTP ${res.status}).`)
  try {
    return await res.json()
  } catch {
    throw new OnlineError('The word service sent something unexpected.')
  }
}

function clean(raw: unknown, limit: number) {
  const out: { word: string; score: number | null }[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const w = item && typeof item === 'object' ? (item as { word?: unknown }).word : undefined
    if (typeof w === 'string' && OK_WORD.test(w)) {
      const sc = (item as { score?: unknown }).score
      out.push({ word: w, score: typeof sc === 'number' && Number.isInteger(sc) ? sc : null })
    }
    if (out.length >= limit) break
  }
  return out
}

const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000

export async function onlineWords(
  rawWord: string,
  kind: OnlineKind,
  limit = 30,
): Promise<OnlineResult> {
  const word = cleanWord(rawWord)
  if (!(kind in KINDS))
    throw fail(422, 'BAD_KIND', `Kind must be one of: ${Object.keys(KINDS).join(', ')}.`)
  if (!(await isEnabled()))
    throw fail(
      403,
      'ONLINE_OFF',
      'The online word helper is switched off. Turn it on first if you want it.',
    )
  const key = `${kind}:${word.toLowerCase()}:${limit}`
  const cached = await db().get<Saved>('online', key)

  const reply = (
    body: unknown[],
    fetchedAt: string,
    live: boolean,
    stale: boolean,
    notice: string | null,
  ): OnlineResult => ({
    source: 'Datamuse (online word service)',
    online: live,
    from_cache: !live,
    stale,
    fetched_at: fetchedAt,
    query: { word, kind },
    sent: live ? `Only the word “${word}” was sent.` : 'Nothing was sent: this is a saved answer.',
    results: clean(body, limit),
    notice,
  })
  if (cached && ageDays(cached.fetched_at) < FRESH_DAYS)
    return reply(cached.body, cached.fetched_at, false, false, null)
  const fallback = (why: string, status: number, code: string) => {
    if (cached)
      return reply(
        cached.body,
        cached.fetched_at,
        false,
        true,
        `${why} Showing saved results from ${cached.fetched_at.slice(0, 10)}.`,
      )
    throw fail(status, code, why + ' Nothing saved for this word yet.')
  }
  if (!limiter.allow()) return fallback('Too many lookups at once.', 429, 'RATE_LIMITED')
  const url = `${BASE}/words?${new URLSearchParams({ [KINDS[kind]]: word, max: String(limit) })}`
  let body: unknown
  try {
    body = await httpGet(url)
  } catch (e) {
    if (e instanceof OnlineError) return fallback(e.message, 503, 'ONLINE_UNAVAILABLE')
    throw e
  }
  const list = Array.isArray(body) ? body : []
  const fetchedAt = nowIso()
  await db().put<Saved>('online', key, { key, body: list, fetched_at: fetchedAt })
  const all = await db().all<Saved>('online')
  if (all.length > MAX_CACHE)
    for (const old of all
      .sort((a, b) => (a.fetched_at < b.fetched_at ? -1 : 1))
      .slice(0, all.length - MAX_CACHE))
      await db().del('online', old.key)
  return reply(list, fetchedAt, true, false, null)
}

const PREFIX_OK = /^[A-Za-z][A-Za-z' -]{1,30}$/

/**
 * Word suggestions while typing in a lookup box (Datamuse /sug). Only when the helper is on; the caller waits for
 * a pause in typing. Answers are saved so the same letters are never sent twice in a week. Never throws.
 */
export async function suggestWords(prefix: string, max = 8): Promise<string[]> {
  const s = prefix.trim().toLowerCase()
  if (!PREFIX_OK.test(s) || !(await isEnabled())) return []
  const key = `sug:${s}:${max}`
  const cached = await db().get<Saved>('online', key)
  if (cached && ageDays(cached.fetched_at) < FRESH_DAYS)
    return clean(cached.body, max).map((x) => x.word)
  if (!limiter.allow()) return cached ? clean(cached.body, max).map((x) => x.word) : []
  try {
    const body = await httpGet(`${BASE}/sug?${new URLSearchParams({ s, max: String(max) })}`)
    const list = Array.isArray(body) ? body : []
    await db().put<Saved>('online', key, { key, body: list, fetched_at: nowIso() })
    return clean(list, max).map((x) => x.word)
  } catch {
    return cached ? clean(cached.body, max).map((x) => x.word) : []
  }
}
