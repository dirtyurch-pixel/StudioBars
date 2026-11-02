/**
 * Where the phone version keeps everything: the browser's own database (IndexedDB) on this device.
 * Nothing is sent anywhere. A small in-memory version of the same interface is used by the tests.
 */
export type Kind = 'songs' | 'revisions'

export interface Store {
  get<T>(kind: Kind, id: string): Promise<T | undefined>
  put<T>(kind: Kind, id: string, value: T): Promise<void>
  del(kind: Kind, id: string): Promise<void>
  all<T>(kind: Kind): Promise<T[]>
}

export class MemoryStore implements Store {
  private data: Record<Kind, Map<string, string>> = { songs: new Map(), revisions: new Map() }
  async get<T>(kind: Kind, id: string) {
    const v = this.data[kind].get(id)
    return v === undefined ? undefined : (JSON.parse(v) as T)
  }
  async put<T>(kind: Kind, id: string, value: T) {
    this.data[kind].set(id, JSON.stringify(value))
  }
  async del(kind: Kind, id: string) {
    this.data[kind].delete(id)
  }
  async all<T>(kind: Kind) {
    return [...this.data[kind].values()].map((v) => JSON.parse(v) as T)
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
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => {
        for (const k of ['songs', 'revisions'])
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
  async get<T>(kind: Kind, id: string) {
    return (await req((await this.os(kind, 'readonly')).get(id))) as T | undefined
  }
  async put<T>(kind: Kind, id: string, value: T) {
    await req((await this.os(kind, 'readwrite')).put(value, id))
  }
  async del(kind: Kind, id: string) {
    await req((await this.os(kind, 'readwrite')).delete(id))
  }
  async all<T>(kind: Kind) {
    return (await req((await this.os(kind, 'readonly')).getAll())) as T[]
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
