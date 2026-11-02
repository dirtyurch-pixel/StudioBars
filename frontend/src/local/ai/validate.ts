/** Checks what the AI sent back. A port of backend/app/ai/validate.py. Anything odd is dropped. */
import { MAX_LINE_CHARS } from '../../types'

export const MAX_CANDIDATES = 6
const MAX_NOTES = 8
const MAX_NOTE_CHARS = 600
const BULLET = /^\s*(?:[-*•–—]+|\d{1,2}[.):]|\(\d{1,2}\))\s+/
const QUOTES = '"\'“”‘’`«»'
const META =
  /^\s*(?:\[.*\]|\(.*\)$|(?:verse|chorus|hook|bridge|intro|outro|pre-?chorus|line|option|candidate|suggestion)\s*\d*\s*[:-])/i
const MARKDOWN = /(\*\*|__|^#+\s|```|\|)/
const MARKDOWN_ALL = /(\*\*|__|^#+\s|```|\|)/g

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')
  try {
    return JSON.parse(t)
  } catch {
    /* try the part between the outer braces */
  }
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a !== -1 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1))
    } catch {
      return null
    }
  }
  return null
}

const strip = (s: string, chars: string) => {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

export function cleanLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let t = raw.trim()
  if (t.includes('\n') || t.includes('\r')) return null
  t = t.replace(BULLET, '').trim()
  while (t.length >= 2 && QUOTES.includes(t[0]) && QUOTES.includes(t[t.length - 1]))
    t = t.slice(1, -1).trim()
  t = strip(t, QUOTES + ' ')
  if (!t || t.length > MAX_LINE_CHARS || t.length < 2) return null
  if (META.test(t) || MARKDOWN.test(t) || t.includes('<') || t.includes('>')) return null
  if (!/[A-Za-z]/.test(t)) return null
  return t
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseLines(
  text: string,
  existing: Set<string>,
  limit: number,
): { text: string; reason: string }[] {
  const data = extractJson(text)
  const items = isObj(data) ? data.suggestions : null
  if (!Array.isArray(items)) return []
  const seen = new Set([...existing].map((e) => e.trim().toLowerCase()))
  const out: { text: string; reason: string }[] = []
  for (const it of items) {
    const t = cleanLine(isObj(it) ? it.text : it)
    if (t === null || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    const r = isObj(it) ? it.reason : ''
    out.push({
      text: t,
      reason: typeof r === 'string' ? r.split(/\s+/).filter(Boolean).join(' ').slice(0, 160) : '',
    })
    if (out.length >= Math.min(limit, MAX_CANDIDATES)) break
  }
  return out
}

export function parseNotes(text: string): string[] {
  const data = extractJson(text)
  let items = isObj(data) ? data.notes : null
  if (typeof items === 'string') items = [items]
  if (!Array.isArray(items)) return []
  const out: string[] = []
  for (const it of items) {
    if (typeof it === 'string' && it.trim())
      out.push(
        it
          .replace(MARKDOWN_ALL, '')
          .split(/\s+/)
          .filter(Boolean)
          .join(' ')
          .slice(0, MAX_NOTE_CHARS),
      )
    if (out.length >= MAX_NOTES) break
  }
  return out
}
