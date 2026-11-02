import { describe, expect, it } from 'vitest'
import { makeArchive, readArchive, restoreArchive } from './archive'
import { MemoryStore } from './store'

const audio = (s: string, type = 'audio/webm') => new Blob([s.repeat(50)], { type })

async function filled() {
  const st = new MemoryStore()
  await st.put('songs', 's1', { id: 's1', title: 'Rain', version: 3, deleted_at: null })
  await st.put('songs', 's2', { id: 's2', title: 'Old', version: 1, deleted_at: '2026-01-01' })
  await st.put('revisions', 'r1', { id: 'r1', song_id: 's1', snapshot: { sections: [] } })
  await st.put('custom', 'flexin', { word: 'flexin', phones: 'F L EH1 K S IH0 N' })
  await st.put('phrases', 'p1', { id: 'p1', text: 'cold world' })
  await st.put('craft', 'c1', { id: 'c1', kind: 'take', song_id: 's1' })
  await st.put('vocals', 'v1', { id: 'v1', song_id: 's1', blob: audio('voice') })
  await st.put('tracks', 't1', { id: 't1', title: 'Beat', blob: audio('beat', 'audio/mpeg') })
  await st.put('playlists', 'pl1', {
    id: 'pl1',
    name: 'Writing',
    entries: [{ id: 'e1', track_id: 't1' }],
  })
  await st.put('settings', 'ai_key_anthropic', { value: 'sk-secret' })
  await st.put('settings', 'link:s1', { value: { track_id: 't1' } })
  await st.put('settings', 'beats:t1', { value: { bpm: 90, offset: 0 } })
  await st.put('settings', 'ai_cap', { value: '5' })
  await st.put('online', 'ml:cold', { words: [] })
  return st
}
const text = (b: Blob) => b.text()

describe('complete backup', () => {
  it('keeps everything with its ids, checks itself, and never includes the AI key', async () => {
    const st = await filled()
    const { blob, name, summary } = await makeArchive(st, {
      includeMusic: true,
      now: '2026-11-02T10:00:00Z',
    })
    expect(name).toBe('studio-bars-backup-2026-11-02.sbbackup')
    expect(summary).toMatchObject({
      songs: 1,
      revisions: 1,
      recordings: 1,
      tracks: 1,
      playlists: 1,
    })
    const raw = await text(blob)
    expect(raw).not.toContain('sk-secret')
    expect(raw).not.toContain('ml:cold')
    const a = await readArchive(blob)
    expect(a.manifest.records.custom?.[0][0]).toBe('flexin')
    expect(a.manifest.records.songs?.length).toBe(2) // the trash is kept too
  })

  it('restores exactly into an empty device, recordings and music included', async () => {
    const { blob } = await makeArchive(await filled(), { includeMusic: true })
    const fresh = new MemoryStore()
    const r = await restoreArchive(fresh, await readArchive(blob), 'replace')
    expect(r.kept_existing).toBe(0)
    expect((await fresh.get<{ title: string }>('songs', 's1'))?.title).toBe('Rain')
    expect((await fresh.get<{ song_id: string }>('revisions', 'r1'))?.song_id).toBe('s1')
    const v = await fresh.get<{ blob: Blob }>('vocals', 'v1')
    expect(await text(v!.blob)).toBe('voice'.repeat(50))
    expect(v!.blob.type).toBe('audio/webm')
    const t = await fresh.get<{ blob: Blob }>('tracks', 't1')
    expect(await text(t!.blob)).toBe('beat'.repeat(50))
    expect(
      (await fresh.get<{ entries: { track_id: string }[] }>('playlists', 'pl1'))?.entries[0]
        .track_id,
    ).toBe('t1')
    expect(await fresh.get('settings', 'beats:t1')).toBeTruthy()
    expect(await fresh.get('settings', 'ai_key_anthropic')).toBeUndefined()
  })

  it('without music leaves the music library out and says so', async () => {
    const { blob, summary } = await makeArchive(await filled(), { includeMusic: false })
    expect(summary.tracks).toBe(0)
    const a = await readArchive(blob)
    expect(a.manifest.excluded.join(' ')).toMatch(/music files/)
    expect(a.manifest.records.settings?.map(([id]) => id)).toEqual(['ai_cap'])
    expect(summary.recordings).toBe(1) // your own voice is always included
  })

  it('merge adds only what is missing and leaves this device’s versions alone', async () => {
    const { blob } = await makeArchive(await filled(), { includeMusic: true })
    const here = new MemoryStore()
    await here.put('songs', 's1', { id: 's1', title: 'Rain (edited on this phone)', version: 4 })
    await here.put('songs', 'mine', { id: 'mine', title: 'Only here' })
    const r = await restoreArchive(here, await readArchive(blob), 'merge')
    expect(r.songs_on_both).toBe(1)
    expect((await here.get<{ title: string }>('songs', 's1'))?.title).toBe(
      'Rain (edited on this phone)',
    )
    expect(await here.get('songs', 'mine')).toBeTruthy()
    expect(await here.get('revisions', 'r1')).toBeTruthy()
  })

  it('replace keeps the AI key on this device and removes things not in the backup', async () => {
    const { blob } = await makeArchive(await filled(), { includeMusic: true })
    const here = new MemoryStore()
    await here.put('settings', 'ai_key_anthropic', { value: 'sk-this-phone' })
    await here.put('songs', 'stray', { id: 'stray', title: 'Not in backup' })
    await restoreArchive(here, await readArchive(blob), 'replace')
    expect(await here.get('songs', 'stray')).toBeUndefined()
    expect((await here.get<{ value: string }>('settings', 'ai_key_anthropic'))?.value).toBe(
      'sk-this-phone',
    )
  })

  it('a failure part-way through changes nothing', async () => {
    const { blob } = await makeArchive(await filled(), { includeMusic: true })
    const here = new MemoryStore()
    await here.put('songs', 'mine', { id: 'mine', title: 'Only here' })
    here.failNextBatch = true
    await expect(restoreArchive(here, await readArchive(blob), 'replace')).rejects.toThrow()
    expect(await here.get('songs', 'mine')).toBeTruthy()
    expect(await here.get('songs', 's1')).toBeUndefined()
  })

  it('refuses damaged, cut-off and foreign files before touching anything', async () => {
    const { blob } = await makeArchive(await filled(), { includeMusic: true })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const flipped = bytes.slice()
    flipped[flipped.length - 3] ^= 0xff
    await expect(readArchive(new Blob([flipped]))).rejects.toThrow(/damaged/)
    await expect(readArchive(new Blob([bytes.slice(0, bytes.length - 10)]))).rejects.toThrow(
      /incomplete|cut off/,
    )
    await expect(readArchive(new Blob(['{"format":"studio-bars-backup"}']))).rejects.toThrow(
      /not a Studio Bars backup/,
    )
    await expect(readArchive(new Blob(['hello']))).rejects.toThrow(/not a Studio Bars backup/)
  })
})
