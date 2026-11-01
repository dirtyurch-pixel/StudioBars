import { describe, expect, it } from 'vitest'
import type { Content } from '../types'
import {
  deleteSection,
  findLine,
  lockViolations,
  mergeServerMeta,
  mergeUp,
  moveSection,
  pasteLines,
  removeLine,
  setLineText,
  splitLine,
  toPayload,
} from './content'

const mk = (): Content => [
  {
    id: 's1',
    label: 'Verse 1',
    section_type: 'verse',
    lines: [
      { id: 'a', text: 'alpha', is_locked: false, comments: [] },
      { id: 'b', text: 'beta', is_locked: true, comments: [] },
      { id: 'c', text: 'gamma', is_locked: false, comments: [] },
    ],
  },
  {
    id: 's2',
    label: 'Chorus',
    section_type: 'chorus',
    lines: [{ id: 'd', text: 'delta', is_locked: false, comments: [] }],
  },
]
const texts = (c: Content, s = 0) => c[s].lines.map((l) => l.text)

describe('locked lines are inviolate', () => {
  it('setLineText refuses a locked line and edits an unlocked one', () => {
    expect(setLineText(mk(), 'b', 'x')).toBeNull()
    expect(texts(setLineText(mk(), 'a', 'x')!)).toEqual(['x', 'beta', 'gamma'])
  })
  it('Enter on a locked line adds an empty line and leaves the text alone', () => {
    const r = splitLine(mk(), 'b', 2, 2)!
    expect(texts(r.content)).toEqual(['alpha', 'beta', '', 'gamma'])
    expect(r.content[0].lines[1].is_locked).toBe(true)
  })
  it('remove, merge and paste refuse locked lines', () => {
    expect(removeLine(mk(), 'b')).toBeNull()
    expect(mergeUp(mk(), 'b')).toBeNull()
    expect(mergeUp(mk(), 'c')).toBeNull() // previous line is locked
    expect(pasteLines(mk(), 'b', 0, 0, 'x\ny')).toBe('blocked')
  })
  it('cannot delete a section that holds a locked line', () => {
    expect(deleteSection(mk(), 's1')).toBeNull()
    expect(deleteSection(mk(), 's2')!.length).toBe(1)
  })
  it('lockViolations spots edits and removals', () => {
    const base = mk()
    const edited = structuredClone(base)
    edited[0].lines[1].text = 'nope'
    expect(lockViolations(base, edited)).toEqual(['b'])
    const removed = structuredClone(base)
    removed[0].lines.splice(1, 1)
    expect(lockViolations(base, removed)).toEqual(['b'])
    expect(lockViolations(base, base)).toEqual([])
  })
})

describe('line editing', () => {
  it('Enter splits at the caret and moves focus to the new line', () => {
    const r = splitLine(mk(), 'a', 2, 2)!
    expect(texts(r.content)).toEqual(['al', 'pha', 'beta', 'gamma'])
    expect(findLine(r.content, r.focusId)!.line.text).toBe('pha')
  })
  it('Backspace on an empty line removes it but never the last line', () => {
    const c = setLineText(mk(), 'a', '')!
    expect(texts(removeLine(c, 'a')!.content)).toEqual(['beta', 'gamma'])
    expect(removeLine(mk(), 'd')).toBeNull()
  })
  it('merging keeps the removed line’s comments', () => {
    const c = mk()
    c[0].lines[1].is_locked = false
    c[0].lines[2].comments = [{ id: 'k', body: 'n', created_at: '', updated_at: '' }]
    const r = mergeUp(c, 'c')!
    expect(texts(r.content)).toEqual(['alpha', 'betagamma'])
    expect(r.content[0].lines[1].comments.map((x) => x.id)).toEqual(['k'])
    expect(r.caret).toBe(4)
  })
  it('multi-line paste becomes separate lines; single-line is left to the browser', () => {
    expect(pasteLines(mk(), 'a', 0, 0, 'just one')).toBeNull()
    const r = pasteLines(mk(), 'a', 5, 5, '!\none\ntwo\r\nthree')
    expect(r).not.toBeNull()
    const e = r as Exclude<typeof r, null | 'blocked'>
    expect(texts(e.content)).toEqual(['alpha!', 'one', 'two', 'three', 'beta', 'gamma'])
    expect(e.caret).toBe(5)
  })
  it('pasting over a selection keeps the text around it', () => {
    const e = pasteLines(mk(), 'c', 1, 4, 'X\nY') as { content: Content }
    expect(texts(e.content)).toEqual(['alpha', 'beta', 'gX', 'Ya'])
  })
})

describe('sections and sync', () => {
  it('moveSection swaps neighbours and ignores edges', () => {
    expect(moveSection(mk(), 's1', 1).map((s) => s.id)).toEqual(['s2', 's1'])
    expect(moveSection(mk(), 's1', -1).map((s) => s.id)).toEqual(['s1', 's2'])
  })
  it('mergeServerMeta takes locks/comments from the server but keeps typed text', () => {
    const local = mk()
    local[0].lines[0].text = 'typed while saving'
    const server = mk()
    server[0].lines[0].is_locked = true
    const merged = mergeServerMeta(local, server)
    expect(merged[0].lines[0]).toMatchObject({ text: 'typed while saving', is_locked: true })
  })
  it('toPayload sends only ids and text, never lock flags', () => {
    const p = toPayload(mk())
    expect(p[0].lines[1]).toEqual({ id: 'b', text: 'beta' })
  })
})
