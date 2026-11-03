import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import type { Section } from '../types'
import { MAX_LINE_CHARS } from '../types'
import {
  FAMILY_COLOURS,
  highlightSegments,
  singleWord,
  syllableLabel,
  type HighlightMode,
  type SyllableDisplay,
} from '../phonetics/highlight'
import type { AnalysisState } from '../phonetics/useLineAnalysis'

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
  // Phase 2 (all optional)
  analysis?: AnalysisState
  syllableDisplay?: SyllableDisplay
  /** Syllable target for this section (lines outside it are marked). */
  sylTarget?: { min: number; max: number } | null
  highlight?: HighlightMode
  onSelectWord?: (word: string) => void
}

export function Pad(p: Props) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>())
  const hlRefs = useRef(new Map<string, HTMLDivElement>())
  const mode = p.syllableDisplay ?? 'numbers'

  /** Keep the highlight layer lined up with its box (it wraps the same way). */
  function syncScroll(id: string) {
    const input = refs.current.get(id)
    const hl = hlRefs.current.get(id)
    if (input && hl) hl.scrollTop = input.scrollTop
  }

  /**
   * A long line wraps onto the next ruled lines instead of scrolling sideways. It is still ONE musical line:
   * the box just grows by whole ruled lines.
   */
  function fit(el: HTMLTextAreaElement) {
    const rule = parseFloat(getComputedStyle(el).lineHeight) || 40
    el.style.height = `${rule}px`
    const rows = Math.max(1, Math.ceil((el.scrollHeight - 4) / rule))
    el.style.height = `${rows * rule}px`
    const field = el.parentElement
    if (field) field.style.height = el.style.height
  }
  useLayoutEffect(() => {
    for (const el of refs.current.values()) fit(el)
  })
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    let w = 0
    const ro = new ResizeObserver((es) => {
      const nw = es[0]?.contentRect.width ?? 0
      if (Math.abs(nw - w) < 1) return
      w = nw
      for (const el of refs.current.values()) fit(el)
    })
    const first = refs.current.values().next().value
    const pad = first?.closest('.pad')
    if (pad) ro.observe(pad)
    return () => ro.disconnect()
  }, [])

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

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, id: string, locked: boolean) {
    const el = e.currentTarget
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    const wrapped = el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight || '40') * 1.5
    if (e.key === 'Enter') {
      e.preventDefault()
      p.onSplit(id, start, end)
    } else if (e.key === 'ArrowUp' && (!wrapped || (start === 0 && end === 0))) {
      // inside a wrapped line the arrow first moves between its rows, then to the line above
      e.preventDefault()
      move(id, -1)
    } else if (e.key === 'ArrowDown' && (!wrapped || start === el.value.length)) {
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

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>, id: string, locked: boolean) {
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
    <div
      className={`pad${mode === 'numbers' ? ' numbers' : ''}`}
      role="group"
      aria-label={`${p.section.label} lyrics`}
    >
      {p.section.lines.map((l, i) => {
        const res = p.analysis?.byId.get(l.id)
        const fresh = !!res && res.text === l.text
        const segs = highlightSegments(
          l.text,
          res?.text,
          res?.words,
          p.analysis?.families ?? [],
          p.highlight ?? 'off',
        )
        const drawn = segs.some((x) => x.family !== null || x.guess)
        const label = syllableLabel(res?.syllables, fresh ? res?.words : [])
        const empty = l.text.trim() === ''
        const t = p.sylTarget
        const off =
          t && mode === 'syllables' && res && fresh && !empty
            ? res.syllables.min > t.max
              ? 'over'
              : res.syllables.max < t.min
                ? 'under'
                : null
            : null
        const offText = off
          ? ` ${off === 'over' ? 'Over' : 'Under'} the target of ${t!.min === t!.max ? t!.min : `${t!.min}–${t!.max}`}.`
          : ''
        const margin =
          mode === 'numbers'
            ? String(i + 1)
            : empty
              ? ''
              : !res
                ? p.analysis?.failed
                  ? '–'
                  : '·'
                : label.text
        return (
          <div
            key={l.id}
            className={`pad-line${p.activeLineId === l.id ? ' active' : ''}${l.is_locked ? ' locked' : ''}`}
          >
            <span className="pad-no" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span id={`syl-${l.id}`} className="sr">
              {mode === 'syllables' && !empty ? label.title + offText : ''}
            </span>
            <div className="pad-field">
              {drawn && (
                <div
                  className="pad-hl"
                  aria-hidden="true"
                  ref={(el) => {
                    if (el) {
                      hlRefs.current.set(l.id, el)
                      requestAnimationFrame(() => syncScroll(l.id))
                    } else hlRefs.current.delete(l.id)
                  }}
                >
                  {segs.map((x, k) => (
                    <span
                      key={k}
                      className={
                        x.family !== null
                          ? `rf rf-${x.family % FAMILY_COLOURS} rfs-${x.family % 3}`
                          : x.guess
                            ? 'rg'
                            : undefined
                      }
                    >
                      {x.text}
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={(el) => {
                  if (el) refs.current.set(l.id, el)
                  else refs.current.delete(l.id)
                }}
                data-line-input
                rows={1}
                className="pad-input"
                value={l.text}
                readOnly={l.is_locked}
                maxLength={MAX_LINE_CHARS}
                aria-label={`Line ${i + 1}${l.is_locked ? ' (locked)' : ''}`}
                aria-describedby={`syl-${l.id}`}
                autoCapitalize="sentences"
                autoComplete="off"
                spellCheck
                enterKeyHint="next"
                onChange={(e) => {
                  const v = e.target.value
                  const nl = v.search(/[\r\n]/)
                  if (nl < 0) return p.onText(l.id, v)
                  // a phone keyboard's Enter can arrive as a typed newline: treat it as "new line here"
                  const without = v.replace(/[\r\n]+/g, '')
                  if (without === l.text) p.onSplit(l.id, nl, nl)
                  else p.onText(l.id, v.replace(/[\r\n]+/g, ' '))
                }}
                onFocus={() => p.onActive(l.id)}
                onKeyDown={(e) => onKeyDown(e, l.id, l.is_locked)}
                onKeyUp={() => syncScroll(l.id)}
                onScroll={() => syncScroll(l.id)}
                onSelect={(e) => {
                  syncScroll(l.id)
                  const el = e.currentTarget
                  const sel = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
                  const w = singleWord(sel)
                  if (w) p.onSelectWord?.(w)
                }}
                onPaste={(e) => onPaste(e, l.id, l.is_locked)}
              />
            </div>
            <span
              className={`pad-num${mode === 'syllables' ? ' syl' : ''}${mode === 'syllables' && res && !fresh ? ' stale' : ''}${res?.syllables.guessed && mode === 'syllables' ? ' guess' : ''}${off ? ` off-target ${off}` : ''}`}
              title={mode === 'syllables' ? label.title + offText : `Line ${i + 1}`}
              aria-hidden="true"
            >
              {margin}
            </span>
            {l.comments.length > 0 && (
              <button
                type="button"
                className="pad-ind"
                aria-label={`Notes for line ${i + 1} (${l.comments.length})`}
                onClick={() => p.onNotes(l.id)}
              >
                💬<sup>{l.comments.length}</sup>
              </button>
            )}
            {l.is_locked && (
              <button
                type="button"
                className="pad-ind lock"
                aria-pressed={true}
                aria-label={`Unlock line ${i + 1}`}
                title="Locked. Tap to unlock."
                onClick={() => p.onToggleLock(l.id)}
              >
                🔒
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
