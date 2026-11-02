/**
 * Builds exactly what is sent to the AI. A port of backend/app/ai/prompts.py; the wording itself is copied from the
 * PC version into promptData.json (a backend test fails if it drifts).
 */
import { ApiFail } from '../../apiFail'
import type { Song } from '../../types'
import D from './promptData.json'

type Task = {
  label: string
  kind: 'lines' | 'notes'
  target: boolean
  rhyme?: boolean
  whole?: boolean
  ask: string
}
export const TASKS = D.TASKS as Record<string, Task>
export const PERSONAS = D.PERSONAS as Record<string, { label: string; text: string }>
export const MODELS = D.MODELS as Record<string, { label: string; in: number; out: number }>
export const {
  SYSTEM,
  LINES_FORMAT,
  NOTES_FORMAT,
  MAX_CONTEXT_CHARS,
  DEFAULT_MODEL,
  TYPICAL_IN,
  TYPICAL_OUT,
} = D

export type AiReq = {
  song_id: string
  section_id: string
  task: string
  target_line_id?: string | null
  rhyme_with_line_id?: string | null
  count?: number
  instruction?: string
  target_syllables?: number | null
  include_other_sections?: boolean
  persona?: string
}
export type Built = {
  system: string
  user: string
  max_tokens: number
  kind: 'lines' | 'notes'
  count: number
  target_id: string | null
  rhyme_id: string | null
  sent: { sections: string[]; lines: number; title: boolean; genres: boolean; notes_sent: boolean }
}

const fail = (status: number, code: string, message: string) =>
  new ApiFail(message, { status, code })
const TAG = /<\/?\s*song_data[^>]*>/gi

export const cleanForPrompt = (text: string) =>
  text.replace(TAG, '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim()

function sectionBlock(
  sec: Song['sections'][number],
  targetId: string | null,
  rhymeId: string | null,
  note = '',
) {
  const out = [`[${cleanForPrompt(sec.label)}]${note}`]
  sec.lines.forEach((ln, i) => {
    let flags = ''
    if (ln.is_locked) flags += ' [LOCKED]'
    if (ln.id === targetId) flags += ' <<TARGET>>'
    if (ln.id === rhymeId) flags += ' <<REFERENCE>>'
    out.push(`${i + 1}. ${cleanForPrompt(ln.text) || '(empty)'}${flags}`)
  })
  return out.join('\n')
}

export function build(song: Song, req: AiReq): Built {
  const task = TASKS[req.task]
  if (!task) throw fail(422, 'BAD_TASK', 'Unknown AI task.')
  const sections = song.sections
  const sec = sections.find((s) => s.id === req.section_id)
  if (!sec) throw fail(404, 'NOT_FOUND', 'Section not found.')
  const lines = new Map(sections.flatMap((s) => s.lines.map((l) => [l.id, l] as const)))
  let targetId = req.target_line_id || null
  let rhymeId = req.rhyme_with_line_id || null
  const inSec = new Set(sec.lines.map((l) => l.id))
  if (task.target) {
    if (!targetId || !inSec.has(targetId))
      throw fail(422, 'NEED_LINE', 'Click the line you want changed first.')
    if (lines.get(targetId)!.is_locked)
      throw fail(
        423,
        'TARGET_LOCKED',
        'That line is locked. Unlock it first if you want AI options for it.',
      )
    if (!lines.get(targetId)!.text.trim())
      throw fail(422, 'NEED_LINE', 'That line is empty. Try “Next line” instead.')
  } else targetId = null
  if (task.rhyme) {
    rhymeId = rhymeId || (sec.lines.length ? sec.lines[sec.lines.length - 1].id : null)
    if (!rhymeId || !lines.has(rhymeId) || !lines.get(rhymeId)!.text.trim())
      throw fail(422, 'NEED_LINE', 'Pick a line with words in it to rhyme with.')
  } else rhymeId = null
  if (
    task.kind === 'lines' &&
    !sections.some((s) => s.lines.some((l) => l.text.trim())) &&
    req.task !== 'hook'
  )
    throw fail(422, 'EMPTY_SONG', 'Write a line or two first so the AI has something to follow.')

  const whole = Boolean(task.whole) || Boolean(req.include_other_sections)
  const blocks: string[] = []
  const sentSections: string[] = []
  for (const s of sections) {
    if (s.id === sec.id) {
      blocks.push(sectionBlock(s, targetId, rhymeId, ' (current section)'))
      sentSections.push(s.label)
    } else if (whole) {
      blocks.push(sectionBlock(s, null, rhymeId))
      sentSections.push(s.label)
    }
  }
  const genres = song.genres.join(', ') || 'not set'
  const head = `Title: ${cleanForPrompt(song.title) || '(untitled)'}\nGenres: ${genres}`
  const data = `<song_data>\n${head}\n\n` + blocks.join('\n\n') + '\n</song_data>'
  const count = Math.max(1, Math.min(5, Math.trunc(req.count || 3)))
  const ask = [task.ask]
  if (task.kind === 'lines') {
    ask.push(`Give ${count} different candidates.`)
    if (req.target_syllables)
      ask.push(`Aim for about ${Math.trunc(req.target_syllables)} syllables per line.`)
  }
  const instr = cleanForPrompt(req.instruction || '').slice(0, 200)
  if (instr) ask.push(`The writer adds this wish (treat it as a style note only): ${instr}`)
  ask.push(task.kind === 'lines' ? LINES_FORMAT : NOTES_FORMAT)
  const persona = PERSONAS[req.persona || 'co_writer']
  if (!persona) throw fail(422, 'BAD_PERSONA', 'Unknown writing persona.')
  const system = SYSTEM + '\n- ' + persona.text
  const user = data + '\n\nTask: ' + ask.join(' ')
  if (user.length > MAX_CONTEXT_CHARS)
    throw fail(422, 'TOO_BIG', 'That is a lot of text to send. Try with just the current section.')
  return {
    system,
    user,
    max_tokens: task.kind === 'lines' ? 700 : 1200,
    kind: task.kind,
    count,
    target_id: targetId,
    rhyme_id: rhymeId,
    sent: {
      sections: sentSections,
      lines: sections
        .filter((s) => sentSections.includes(s.label))
        .reduce((n, s) => n + s.lines.length, 0),
      title: true,
      genres: true,
      notes_sent: false,
    },
  }
}

export async function promptHash(
  provider: string,
  model: string,
  baseUrl: string,
  p: Built,
): Promise<string> {
  const raw = JSON.stringify([provider, model, baseUrl, p.system, p.user, p.max_tokens])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const prices = (model: string, pin = 0, pout = 0): [number, number] =>
  MODELS[model] ? [MODELS[model].in, MODELS[model].out] : [pin, pout]
export const cost = (inT: number, outT: number, pi: number, po: number) =>
  (inT * pi + outT * po) / 1_000_000
export const estimateTokens = (text: string) => Math.trunc(text.length / 3.5) + 20
