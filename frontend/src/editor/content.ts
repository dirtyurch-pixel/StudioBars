/**
 * Pure editing operations on a song's sections/lines.
 * Every operation that would touch a locked line returns null instead.
 */
import {
  MAX_LINE_CHARS,
  MAX_LINES,
  type Content,
  type Line,
  type Section,
  type SectionType,
} from '../types'

export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '')
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const blankLine = (text = ''): Line => ({
  id: newId(),
  text,
  is_locked: false,
  comments: [],
})

export function inferType(label: string): SectionType {
  const l = label.toLowerCase().trim()
  if (/^pre[- ]?chorus/.test(l)) return 'pre-chorus'
  for (const t of ['intro', 'verse', 'chorus', 'hook', 'bridge', 'outro'] as const) {
    if (l.startsWith(t)) return t
  }
  return 'custom'
}

export function countLines(content: Content): number {
  return content.reduce((n, s) => n + s.lines.length, 0)
}

export function findLine(content: Content, lineId: string) {
  for (let s = 0; s < content.length; s++) {
    const i = content[s].lines.findIndex((l) => l.id === lineId)
    if (i >= 0) return { s, i, line: content[s].lines[i] }
  }
  return null
}

export function lockedLines(content: Content): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of content) for (const l of s.lines) if (l.is_locked) m.set(l.id, l.text)
  return m
}

/** Ids of locked lines in `prev` that are missing or different in `next`. */
export function lockViolations(prev: Content, next: Content): string[] {
  const nextText = new Map<string, string>()
  for (const s of next) for (const l of s.lines) nextText.set(l.id, l.text)
  const bad: string[] = []
  for (const [id, text] of lockedLines(prev)) if (nextText.get(id) !== text) bad.push(id)
  return bad
}

function mapLines(content: Content, sIdx: number, lines: Line[]): Content {
  return content.map((s, i) => (i === sIdx ? { ...s, lines } : s))
}

export function setLineText(content: Content, lineId: string, text: string): Content | null {
  const f = findLine(content, lineId)
  if (!f || f.line.is_locked) return null
  const lines = f.line.text === text ? null : f.line
  if (!lines) return content
  const next = content[f.s].lines.slice()
  next[f.i] = { ...f.line, text: text.slice(0, MAX_LINE_CHARS) }
  return mapLines(content, f.s, next)
}

export type Edit = { content: Content; focusId: string; caret: number }

/** Enter key. On a locked line it only adds an empty line below. */
export function splitLine(
  content: Content,
  lineId: string,
  start: number,
  end: number,
): Edit | null {
  const f = findLine(content, lineId)
  if (!f || countLines(content) >= MAX_LINES) return null
  const lines = content[f.s].lines.slice()
  if (f.line.is_locked) {
    const fresh = blankLine()
    lines.splice(f.i + 1, 0, fresh)
    return { content: mapLines(content, f.s, lines), focusId: fresh.id, caret: 0 }
  }
  const before = f.line.text.slice(0, start)
  const after = f.line.text.slice(end)
  const fresh = blankLine(after)
  lines[f.i] = { ...f.line, text: before }
  lines.splice(f.i + 1, 0, fresh)
  return { content: mapLines(content, f.s, lines), focusId: fresh.id, caret: 0 }
}

/** Backspace on an empty line removes it (never the last line in a section). */
export function removeLine(content: Content, lineId: string): Edit | null {
  const f = findLine(content, lineId)
  if (!f || f.line.is_locked || content[f.s].lines.length <= 1) return null
  const lines = content[f.s].lines.slice()
  lines.splice(f.i, 1)
  const target = lines[Math.max(0, f.i - 1)]
  return { content: mapLines(content, f.s, lines), focusId: target.id, caret: target.text.length }
}

/** Backspace at the start of a non-empty line joins it onto the previous line. */
export function mergeUp(content: Content, lineId: string): Edit | null {
  const f = findLine(content, lineId)
  if (!f || f.i === 0 || f.line.is_locked) return null
  const prev = content[f.s].lines[f.i - 1]
  if (prev.is_locked) return null
  const joined = (prev.text + f.line.text).slice(0, MAX_LINE_CHARS)
  const lines = content[f.s].lines.slice()
  lines.splice(f.i - 1, 2, { ...prev, text: joined })
  // comments on the removed line move to the surviving line so they are not lost
  if (f.line.comments.length) {
    lines[f.i - 1] = { ...lines[f.i - 1], comments: [...prev.comments, ...f.line.comments] }
  }
  return { content: mapLines(content, f.s, lines), focusId: prev.id, caret: prev.text.length }
}

/** Multi-line paste: splits into separate lines. Returns null for a single-line paste. */
export function pasteLines(
  content: Content,
  lineId: string,
  start: number,
  end: number,
  pasted: string,
): Edit | null | 'blocked' {
  const pieces = pasted.replace(/\r\n?/g, '\n').split('\n')
  if (pieces.length < 2) return null
  const f = findLine(content, lineId)
  if (!f || f.line.is_locked) return 'blocked'
  if (countLines(content) + pieces.length - 1 > MAX_LINES) return 'blocked'
  const clamp = (t: string) => t.slice(0, MAX_LINE_CHARS)
  const before = f.line.text.slice(0, start)
  const after = f.line.text.slice(end)
  const last = pieces[pieces.length - 1]
  const first = clamp(before + pieces[0])
  const middle = pieces.slice(1, -1).map((t) => blankLine(clamp(t)))
  const tail = blankLine(clamp(last + after))
  const lines = content[f.s].lines.slice()
  lines.splice(f.i, 1, { ...f.line, text: first }, ...middle, tail)
  return { content: mapLines(content, f.s, lines), focusId: tail.id, caret: last.length }
}

export function addLineAfter(content: Content, lineId: string): Edit | null {
  const f = findLine(content, lineId)
  if (!f || countLines(content) >= MAX_LINES) return null
  const fresh = blankLine()
  const lines = content[f.s].lines.slice()
  lines.splice(f.i + 1, 0, fresh)
  return { content: mapLines(content, f.s, lines), focusId: fresh.id, caret: 0 }
}

/**
 * Put AI-suggested text on a NEW line below `afterLineId` (or at the end of the section).
 * If that line is an empty, unlocked line the text goes into it instead of leaving a gap.
 * Never touches a locked line.
 */
export function insertLineWithText(
  content: Content,
  sectionId: string,
  afterLineId: string | null,
  text: string,
): Edit | null {
  const sIdx = content.findIndex((s) => s.id === sectionId)
  if (sIdx < 0) return null
  const clean = text
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_LINE_CHARS)
  if (!clean) return null
  const lines = content[sIdx].lines.slice()
  let i = afterLineId ? lines.findIndex((l) => l.id === afterLineId) : -1
  if (i < 0) i = lines.length - 1
  const at = lines[i]
  if (at && at.text.trim() === '' && !at.is_locked) {
    lines[i] = { ...at, text: clean }
    return { content: mapLines(content, sIdx, lines), focusId: at.id, caret: clean.length }
  }
  if (countLines(content) >= MAX_LINES) return null
  const fresh = blankLine(clean)
  lines.splice(i + 1, 0, fresh)
  return { content: mapLines(content, sIdx, lines), focusId: fresh.id, caret: clean.length }
}

// ------------------------------------------------------------ sections

export function addSection(content: Content, label: string): { content: Content; id: string } {
  const clean = label.trim().slice(0, 60) || 'New section'
  const sec: Section = {
    id: newId(),
    label: clean,
    section_type: inferType(clean),
    lines: [blankLine(), blankLine(), blankLine(), blankLine()],
  }
  return { content: [...content, sec], id: sec.id }
}

export function renameSection(content: Content, id: string, label: string): Content {
  const clean = label.trim().slice(0, 60)
  if (!clean) return content
  return content.map((s) => (s.id === id ? { ...s, label: clean } : s))
}

export function setSectionType(content: Content, id: string, t: SectionType): Content {
  return content.map((s) => (s.id === id ? { ...s, section_type: t } : s))
}

export function sectionHasLocked(content: Content, id: string): boolean {
  return !!content.find((s) => s.id === id)?.lines.some((l) => l.is_locked)
}

/** Null when the section holds a locked line or is the only section. */
export function deleteSection(content: Content, id: string): Content | null {
  if (content.length <= 1 || sectionHasLocked(content, id)) return null
  return content.filter((s) => s.id !== id)
}

export function moveSection(content: Content, id: string, dir: -1 | 1): Content {
  const i = content.findIndex((s) => s.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= content.length) return content
  const next = content.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// ------------------------------------------------------------ server sync

/**
 * Copy lock state and comments from the server's copy onto the local copy,
 * leaving the local text exactly as typed.
 */
export function mergeServerMeta(local: Content, server: Content): Content {
  const meta = new Map<string, Line>()
  for (const s of server) for (const l of s.lines) meta.set(l.id, l)
  return local.map((s) => ({
    ...s,
    lines: s.lines.map((l) => {
      const m = meta.get(l.id)
      return m ? { ...l, is_locked: m.is_locked, comments: m.comments } : l
    }),
  }))
}

export function toPayload(content: Content) {
  return content.map((s) => ({
    id: s.id,
    label: s.label,
    section_type: s.section_type,
    lines: s.lines.map((l) => ({ id: l.id, text: l.text })),
  }))
}
