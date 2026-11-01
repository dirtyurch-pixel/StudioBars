import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import type { Section } from '../types'
import { MAX_LINE_CHARS } from '../types'

export type FocusRequest = { id: string; caret: number; n: number } | null

type Props = {
  section: Section
  activeLineId: string | null
  focusReq: FocusRequest
  onText: (id: string, text: string) => void
  onSplit: (id: string, start: number, end: number) => void
  onBackspaceEmpty: (id: string) => void
  onMergeUp: (id: string) => void
  onPaste: (id: string, start: number, end: number, text: string) => boolean
  onActive: (id: string) => void
  onToggleLock: (id: string) => void
  onBlocked: () => void
  onNotes: (id: string) => void
}

export function Pad(p: Props) {
  const refs = useRef(new Map<string, HTMLInputElement>())

  useEffect(() => {
    if (!p.focusReq) return
    const el = refs.current.get(p.focusReq.id)
    if (el) {
      el.focus()
      const c = Math.min(p.focusReq.caret, el.value.length)
      el.setSelectionRange(c, c)
    }
  }, [p.focusReq])

  function move(id: string, dir: -1 | 1) {
    const i = p.section.lines.findIndex((l) => l.id === id)
    const next = p.section.lines[i + dir]
    if (next) refs.current.get(next.id)?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, id: string, locked: boolean) {
    const el = e.currentTarget
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    if (e.key === 'Enter') {
      e.preventDefault()
      p.onSplit(id, start, end)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(id, -1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(id, 1)
    } else if (e.key === 'Backspace' && !locked && start === 0 && end === 0) {
      e.preventDefault()
      if (el.value === '') p.onBackspaceEmpty(id)
      else p.onMergeUp(id)
    } else if (
      locked &&
      (e.key === 'Backspace' ||
        e.key === 'Delete' ||
        (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey))
    ) {
      p.onBlocked()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, id: string, locked: boolean) {
    const text = e.clipboardData.getData('text')
    if (locked) {
      e.preventDefault()
      p.onBlocked()
      return
    }
    if (!/[\r\n]/.test(text)) return
    const el = e.currentTarget
    const start = el.selectionStart ?? 0
    if (p.onPaste(id, start, el.selectionEnd ?? start, text)) e.preventDefault()
  }

  return (
    <div className="pad" role="group" aria-label={`${p.section.label} lyrics`}>
      {p.section.lines.map((l, i) => (
        <div key={l.id} className={`pad-line${p.activeLineId === l.id ? ' active' : ''}`}>
          <span className="pad-num" aria-hidden="true">
            {i + 1}
          </span>
          <input
            ref={(el) => {
              if (el) refs.current.set(l.id, el)
              else refs.current.delete(l.id)
            }}
            data-line-input
            className="pad-input"
            value={l.text}
            readOnly={l.is_locked}
            maxLength={MAX_LINE_CHARS}
            aria-label={`Line ${i + 1}${l.is_locked ? ' (locked)' : ''}`}
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck
            enterKeyHint="next"
            onChange={(e) => p.onText(l.id, e.target.value)}
            onFocus={() => p.onActive(l.id)}
            onKeyDown={(e) => onKeyDown(e, l.id, l.is_locked)}
            onPaste={(e) => onPaste(e, l.id, l.is_locked)}
          />
          <button
            type="button"
            className={`pad-btn${l.comments.length ? ' has' : ''}`}
            aria-label={`Notes for line ${i + 1} (${l.comments.length})`}
            onClick={() => p.onNotes(l.id)}
          >
            💬{l.comments.length > 0 && <sup>{l.comments.length}</sup>}
          </button>
          <button
            type="button"
            className={`pad-btn lock${l.is_locked ? ' on' : ''}`}
            aria-pressed={l.is_locked}
            aria-label={`${l.is_locked ? 'Unlock' : 'Lock'} line ${i + 1}`}
            onClick={() => p.onToggleLock(l.id)}
          >
            {l.is_locked ? '🔒' : '🔓'}
          </button>
        </div>
      ))}
    </div>
  )
}
