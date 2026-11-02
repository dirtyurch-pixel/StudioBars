/**
 * Where the phone version keeps everything: the browser's own database (IndexedDB) on this device.
 * Nothing is sent anywhere. A small in-memory version of the same interface is used by the tests.
 */
export type Kind =
  | 'songs'
  | 'revisions'
  | 'custom'
  | 'phrases'
  | 'settings'
  | 'online'
  | 'ai_usage'
  | 'ai_suggestions'
  | 'craft'
  | 'vocals'
  | 'tracks'
  | 'playlists'
export const KINDS: Kind[] = [
  'songs',
  'revisions',
  'custom',
  'phrases',
  'settings',
  'online',
  'ai_usage',
  'ai_suggestions',
  'craft',
  'vocals',
  'tracks',
  'playlists',
]

/** One change inside a batch. `clear` empties a whole kind (used by "replace everything"). */
export type Op =
  | { kind: Kind; id: string; value: unknown }
  | { kind: Kind; id: string; del: true }
  | { kind: Kind; clear: true }

export interface Store {
  get<T>(kind: Kind, id: string): Promise<T | undefined>
  put<T>(kind: Kind, id: string, value: T): Promise<void>
  del(kind: Kind, id: string): Promise<void>
  all<T>(kind: Kind): Promise<T[]>
  /** All ids in a kind. */
  keys(kind: Kind): Promise<string[]>
  /** Apply every change together, or none of them. Resolves only once the device has stored them. */
  batch(ops: Op[]): Promise<void>
}

/** Copy a stored value. Plain data is deep-copied; Blob fields (audio) are kept as they are. */
function freeze(v: unknown): { json: string; blobs: Record<string, Blob> } {
  const blobs: Record<string, Blob> = {}
  let plain = v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof Blob !== 'undefined' && x instanceof Blob) blobs[k] = x
      else o[k] = x
    }
    plain = o
  }
  return { json: JSON.stringify(plain), blobs }
}
function thaw<T>(f: { json: string; blobs: Record<string, Blob> }): T {
  const v = JSON.parse(f.json)
  return (Object.keys(f.blobs).length ? { ...v, ...f.blobs } : v) as T
}

export class MemoryStore implements Store {
  private data = Object.fromEntries(KINDS.map((k) => [k, new Map()])) as Record<
    Kind,
    Map<string, ReturnType<typeof freeze>>
  >
  /** Tests can make the next batch fail part-way, to prove nothing is half-written. */
  failNextBatch = false
  async get<T>(kind: Kind, id: string) {
    const v = this.data[kind].get(id)
    return v === undefined ? undefined : thaw<T>(v)
  }
  async put<T>(kind: Kind, id: string, value: T) {
    this.data[kind].set(id, freeze(value))
  }
  async del(kind: Kind, id: string) {
    this.data[kind].delete(id)
  }
  async all<T>(kind: Kind) {
    return [...this.data[kind].values()].map((v) => thaw<T>(v))
  }
  async keys(kind: Kind) {
    return [...this.data[kind].keys()]
  }
  async batch(ops: Op[]) {
    const copy = Object.fromEntries(
      KINDS.map((k) => [k, new Map(this.data[k])]),
    ) as typeof this.data
    ops.forEach((op, n) => {
      if (this.failNextBatch && n === Math.floor(ops.length / 2)) {
        this.failNextBatch = false
        throw new Error('simulated storage failure')
      }
      if ('clear' in op) copy[op.kind].clear()
      else if ('del' in op) copy[op.kind].delete(op.id)
      else copy[op.kind].set(op.id, freeze(op.value))
    })
    this.data = copy
  }
}

const DB_NAME = 'studio-bars'
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

export class IdbStore implements Store {
  private db: Promise<IDBDatabase>
  constructor(name = DB_NAME) {
    this.db = new Promise((res, rej) => {
      const open = indexedDB.open(name, 5) // v2 pronunciations, phrases; v3 settings, online answers; v4 AI, craft, vocals; v5 music
      open.onupgradeneeded = () => {
        for (const k of KINDS)
          if (!open.result.objectStoreNames.contains(k)) open.result.createObjectStore(k)
      }
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
      open.onblocked = () =>
        rej(new Error('The song database is open in an older tab. Close other Studio Bars tabs.'))
    })
  }
  private async os(kind: Kind, mode: IDBTransactionMode) {
    return (await this.db).transaction(kind, mode).objectStore(kind)
  }
  /** Run writes in one transaction and wait until the browser says they are stored (not just queued). */
  private async write(kinds: Kind[], fn: (t: IDBTransaction) => void) {
    const t = (await this.db).transaction([...new Set(kinds)], 'readwrite')
    const done = new Promise<void>((res, rej) => {
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error ?? new Error('The device could not save that.'))
      t.onabort = () => rej(t.error ?? new Error('The device could not save that.'))
    })
    try {
      fn(t)
    } catch (e) {
      t.abort()
      await done.catch(() => undefined)
      throw e
    }
    await done
  }
  async get<T>(kind: Kind, id: string) {
    return (await req((await this.os(kind, 'readonly')).get(id))) as T | undefined
  }
  async put<T>(kind: Kind, id: string, value: T) {
    await this.write([kind], (t) => t.objectStore(kind).put(value, id))
  }
  async del(kind: Kind, id: string) {
    await this.write([kind], (t) => t.objectStore(kind).delete(id))
  }
  async all<T>(kind: Kind) {
    return (await req((await this.os(kind, 'readonly')).getAll())) as T[]
  }
  async keys(kind: Kind) {
    return ((await req((await this.os(kind, 'readonly')).getAllKeys())) as IDBValidKey[]).map(
      String,
    )
  }
  async batch(ops: Op[]) {
    if (!ops.length) return
    await this.write(
      ops.map((o) => o.kind),
      (t) => {
        for (const op of ops) {
          const os = t.objectStore(op.kind)
          if ('clear' in op) os.clear()
          else if ('del' in op) os.delete(op.id)
          else os.put(op.value, op.id)
        }
      },
    )
  }
}

/** Run changes one at a time, even across several open tabs (Web Locks), so two saves never mix. */
let chain: Promise<unknown> = Promise.resolve()
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (locks?.request) return locks.request('studio-bars-write', fn) as Promise<T>
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}
