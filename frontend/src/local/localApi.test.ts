import { beforeEach, describe, expect, it } from 'vitest'
import { ApiFail } from '../apiFail'
import * as L from './localApi'
import { MemoryStore } from './store'
import type { Content, Song } from '../types'

let t = Date.parse('2026-11-02T10:00:00Z')
const tick = (sec: number) => (t += sec * 1000)

beforeEach(() => {
  L.useStore(new MemoryStore())
  t = Date.parse('2026-11-02T10:00:00Z')
  L.setClock(() => new Date(t))
})

const content = (s: Song): Content =>
  s.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => ({ ...l })) }))
async function failsWith(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiFail)
    expect((e as ApiFail).code).toBe(code)
    return e as ApiFail
  }
  throw new Error(`expected ${code}`)
}
async function newSong(template: 'blank' | 'verse-chorus' = 'blank') {
  return L.createSong({
    title: '  Rain on Glass ',
    genres: ['r&b', 'r&b'],
    bpm: 82,
    time_signature: '4/4',
    template,
  })
}
async function write(song: Song, texts: string[]) {
  const c = content(song)
  texts.forEach((x, i) => (c[0].lines[i].text = x))
  return L.saveContent(song.id, song.version, c)
}

describe('songs on the device', () => {
  it('creates, lists, edits, trashes and restores a song', async () => {
    const s = await newSong('verse-chorus')
    expect(s.title).toBe('Rain on Glass')
    expect(s.genres).toEqual(['r&b'])
    expect(s.sections.map((x) => x.label)).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Bridge'])
    expect(s.sections[0].lines).toHaveLength(4)
    expect((await L.listSongs())[0]).toMatchObject({ id: s.id, line_count: 0, locked_count: 0 })
    expect((await L.patchSong(s.id, { title: 'New', bpm: 90 })).bpm).toBe(90)
    await L.deleteSong(s.id)
    expect(await L.listSongs()).toEqual([])
    expect((await L.listSongs(true))[0].id).toBe(s.id)
    await failsWith(L.getSong(s.id), 'NOT_FOUND')
    await L.undeleteSong(s.id)
    expect((await L.getSong(s.id)).title).toBe('New')
  })

  it('refuses bad input in plain words', async () => {
    await failsWith(L.createSong({ title: '  ', genres: [], template: 'blank' }), 'INVALID')
    await failsWith(
      L.createSong({ title: 'x', genres: [], bpm: 999, template: 'blank' }),
      'INVALID',
    )
    await failsWith(
      L.createSong({ title: 'x', genres: [], time_signature: 'four', template: 'blank' }),
      'INVALID',
    )
    const s = await newSong()
    await failsWith(L.patchSong(s.id, { title: '' }), 'INVALID')
  })
})

describe('saving', () => {
  it('saves text and bumps the version; a stale copy is refused instead of overwriting', async () => {
    const s = await newSong()
    const a = await write(s, ['one', 'two'])
    expect(a.version).toBe(2)
    expect(a.sections[0].lines.map((l) => l.text).slice(0, 2)).toEqual(['one', 'two'])
    const e = await failsWith(write(s, ['stale']), 'VERSION_CONFLICT')
    expect(e.currentVersion).toBe(2)
    expect((await L.getSong(s.id)).sections[0].lines[0].text).toBe('one')
  })

  it('rejects duplicate ids, newlines, over-long lines and ids from another song', async () => {
    const s = await newSong()
    const c = content(s)
    c[0].lines[1].id = c[0].lines[0].id
    await failsWith(L.saveContent(s.id, 1, c), 'DUPLICATE_ID')
    const c2 = content(s)
    c2[0].lines[0].text = 'a\nb'
    await failsWith(L.saveContent(s.id, 1, c2), 'INVALID')
    const c3 = content(s)
    c3[0].lines[0].text = 'x'.repeat(501)
    await failsWith(L.saveContent(s.id, 1, c3), 'INVALID')
    const other = await newSong()
    const c4 = content(s)
    c4[0].lines.push({ ...other.sections[0].lines[0] })
    await failsWith(L.saveContent(s.id, 1, c4), 'FOREIGN_ID')
  })
})

describe('locked lines can never change', () => {
  it('blocks changing or removing a locked line, keeps it through reorders', async () => {
    const s = await write(await newSong(), ['keep me', 'free'])
    const lid = s.sections[0].lines[0].id
    const locked = await L.lockLine(lid, true)
    expect(locked.sections[0].lines[0].is_locked).toBe(true)
    const c = content(locked)
    c[0].lines[0].text = 'changed'
    expect(
      (await failsWith(L.saveContent(s.id, locked.version, c), 'LOCKED_LINES')).lineIds,
    ).toEqual([lid])
    const c2 = content(locked)
    c2[0].lines.splice(0, 1)
    await failsWith(L.saveContent(s.id, locked.version, c2), 'LOCKED_LINES')
    const c3 = content(locked)
    c3[0].lines.reverse() // moving it is fine
    const moved = await L.saveContent(s.id, locked.version, c3)
    const kept = moved.sections[0].lines.find((l) => l.id === lid)!
    expect(kept).toMatchObject({ text: 'keep me', is_locked: true })
    const un = await L.lockLine(lid, false)
    expect(un.sections[0].lines.find((l) => l.id === lid)!.is_locked).toBe(false)
  })

  it('a locked line in the trash cannot be found to change', async () => {
    const s = await newSong()
    await L.deleteSong(s.id)
    await failsWith(L.lockLine(s.sections[0].lines[0].id, true), 'NOT_FOUND')
  })
})

describe('notes on lines', () => {
  it('adds, edits and deletes notes, and notes survive saves', async () => {
    const s = await newSong()
    const lid = s.sections[0].lines[0].id
    const a = await L.addComment(lid, '  breathe here ')
    const c = a.sections[0].lines[0].comments[0]
    expect(c.body).toBe('breathe here')
    const saved = await write(a, ['text after note'])
    expect(saved.sections[0].lines[0].comments).toHaveLength(1)
    expect((await L.editComment(c.id, 'louder')).sections[0].lines[0].comments[0].body).toBe(
      'louder',
    )
    expect((await L.deleteComment(c.id)).sections[0].lines[0].comments).toEqual([])
    await failsWith(L.addComment(lid, '   '), 'INVALID')
    await failsWith(L.editComment('nope', 'x'), 'NOT_FOUND')
  })
})

describe('history', () => {
  it('takes an automatic snapshot at most every 5 minutes, plus manual ones', async () => {
    let s = await newSong()
    s = await write(s, ['v1'])
    tick(60)
    s = await write(s, ['v2'])
    expect((await L.listRevisions(s.id)).map((r) => r.kind)).toEqual(['auto'])
    tick(400)
    s = await write(s, ['v3'])
    expect((await L.listRevisions(s.id)).map((r) => r.kind)).toEqual(['auto', 'auto'])
    tick(1)
    const list = await L.createRevision(s.id, '  before chorus rewrite ')
    expect(list[0]).toMatchObject({
      kind: 'manual',
      description: 'before chorus rewrite',
      line_count: 1,
    })
  })

  it('restores an old version, saving the current one first', async () => {
    let s = await newSong()
    s = await write(s, ['old words'])
    const first = (await L.listRevisions(s.id))[0]
    tick(10)
    s = await write(s, ['new words'])
    const r = await L.restoreRevision(first.id)
    expect(r.sections[0].lines[0].text).toBe('old words')
    expect(r.version).toBe(s.version + 1)
    expect((await L.listRevisions(s.id))[0].kind).toBe('pre-restore')
  })

  it('will not restore over a locked line', async () => {
    let s = await newSong()
    s = await write(s, ['first'])
    const rev = (await L.listRevisions(s.id))[0]
    tick(10)
    s = await write(s, ['locked now'])
    await L.lockLine(s.sections[0].lines[0].id, true)
    await failsWith(L.restoreRevision(rev.id), 'LOCKED_LINES')
    expect((await L.getSong(s.id)).sections[0].lines[0].text).toBe('locked now')
  })
})

describe('import, export and backup', () => {
  it('imports text as a NEW song with sections and a preview first', async () => {
    const txt = '[Verse 1]\nline one\nline two\n\n[Chorus]\nhook line\n'
    const p = await L.previewImport('txt', txt, 'Mine')
    expect(p).toMatchObject({ title: 'Mine', line_count: 3 })
    expect(p.sections.map((x) => x.section_type)).toEqual(['verse', 'chorus'])
    expect(await L.listSongs()).toEqual([])
    const s = await L.commitImport('txt', txt, 'Mine')
    expect(s.sections[1].lines[0].text).toBe('hook line')
    await failsWith(L.previewImport('txt', '\n\n'), 'IMPORT_FAILED')
  })

  it('a song exported as JSON comes back identical, locks and notes included', async () => {
    let s = await write(await newSong('verse-chorus'), ['alpha', 'beta'])
    s = await L.lockLine(s.sections[0].lines[0].id, true)
    s = await L.addComment(s.sections[0].lines[1].id, 'slow down')
    const { blob, name } = await L.exportSong(s.id, 'json')
    expect(name).toBe('Rain_on_Glass.json')
    const back = await L.commitImport('json', await blob.text())
    expect(back.id).not.toBe(s.id)
    expect(back.sections[0].lines[0]).toMatchObject({ text: 'alpha', is_locked: true })
    expect(back.sections[0].lines[1].comments[0].body).toBe('slow down')
    expect(back).toMatchObject({
      title: 'Rain on Glass',
      bpm: 82,
      time_signature: '4/4',
      genres: ['r&b'],
    })
  })

  it('exports text and markdown the same way as the PC version', async () => {
    const s = await write(await newSong(), ['one', 'two'])
    expect(await (await L.exportSong(s.id, 'txt')).blob.text()).toBe('[Verse 1]\none\ntwo\n\n\n')
    const md = await (await L.exportSong(s.id, 'md')).blob.text()
    expect(md.startsWith('# Rain on Glass\n\nGenres: r&b  \nBPM: 82\n\n## Verse 1\none\ntwo')).toBe(
      true,
    )
  })

  it('backs up every song and restores them as new songs without touching existing ones', async () => {
    const a = await write(await newSong(), ['first song'])
    await L.lockLine(a.sections[0].lines[0].id, true)
    await write(await L.createSong({ title: 'Second', genres: [], template: 'blank' }), [
      'second song',
    ])
    const b = await L.backupAll()
    expect(b.count).toBe(2)
    const text = await b.blob.text()
    expect(await L.restoreBackup(text)).toBe(2)
    const all = await L.listSongs()
    expect(all).toHaveLength(4)
    expect(all.filter((x) => x.title === 'Rain on Glass').every((x) => x.locked_count === 1)).toBe(
      true,
    )
    await failsWith(L.restoreBackup('{"format":"other"}'), 'IMPORT_FAILED')
    await failsWith(L.restoreBackup('not json'), 'IMPORT_FAILED')
    await failsWith(L.previewImport('json', text), 'IMPORT_FAILED') // a backup is not a single song
  })
})

describe('saving is all-or-nothing', () => {
  it('a storage failure during a save changes nothing, and the same save then works', async () => {
    const store = new MemoryStore()
    L.useStore(store)
    const s = await newSong()
    const before = (await L.listRevisions(s.id)).length
    store.failNextBatch = true
    await expect(write(s, ['first bar'])).rejects.toThrow()
    const after = await L.getSong(s.id)
    expect(after.version).toBe(s.version) // the version did not move on
    expect(after.sections[0].lines[0].text).toBe('')
    expect((await L.listRevisions(s.id)).length).toBe(before) // no half-made snapshot
    // retrying with the same starting version succeeds (no false "changed elsewhere")
    const ok = await write(s, ['first bar'])
    expect(ok.version).toBe(s.version + 1)
    expect((await L.listRevisions(s.id)).length).toBe(before + 1)
  })

  it('a failed restore of an earlier version leaves the song and history unchanged', async () => {
    const store = new MemoryStore()
    L.useStore(store)
    const s = await newSong()
    const v1 = await write(s, ['one'])
    await L.createRevision(s.id, 'keep')
    tick(10)
    const v2 = await write(v1, ['two'])
    const revs = await L.listRevisions(s.id)
    const keep = revs.find((r) => r.description === 'keep')!
    store.failNextBatch = true
    await expect(L.restoreRevision(keep.id)).rejects.toThrow()
    expect((await L.getSong(s.id)).version).toBe(v2.version)
    expect((await L.listRevisions(s.id)).length).toBe(revs.length)
  })
})
