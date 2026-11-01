import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Pad } from './Pad'
import type { Section } from '../types'

const section: Section = {
  id: 's',
  label: 'Verse 1',
  section_type: 'verse',
  lines: [
    { id: 'a', text: 'free line', is_locked: false, comments: [] },
    {
      id: 'b',
      text: 'locked line',
      is_locked: true,
      comments: [{ id: 'c', body: 'n', created_at: '', updated_at: '' }],
    },
  ],
}

function setup() {
  const p = {
    section,
    activeLineId: null,
    focusReq: null,
    onText: vi.fn(),
    onSplit: vi.fn(),
    onBackspaceEmpty: vi.fn(),
    onMergeUp: vi.fn(),
    onPaste: vi.fn(() => true),
    onActive: vi.fn(),
    onToggleLock: vi.fn(),
    onBlocked: vi.fn(),
    onNotes: vi.fn(),
  }
  render(<Pad {...p} />)
  return p
}

describe('Pad', () => {
  it('shows a locked line as read-only and says so', () => {
    setup()
    const locked = screen.getByLabelText('Line 2 (locked)')
    expect(locked).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Line 1')).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText('Unlock line 2')).toHaveAttribute('aria-pressed', 'true')
  })

  it('typing, deleting or pasting on a locked line is reported as blocked', () => {
    const p = setup()
    const locked = screen.getByLabelText('Line 2 (locked)')
    fireEvent.keyDown(locked, { key: 'a' })
    fireEvent.keyDown(locked, { key: 'Backspace' })
    expect(p.onBlocked).toHaveBeenCalledTimes(2)
    fireEvent.paste(locked, { clipboardData: { getData: () => 'x\ny' } })
    expect(p.onBlocked).toHaveBeenCalledTimes(3)
    expect(p.onPaste).not.toHaveBeenCalled()
  })

  it('shortcuts with Ctrl on a locked line are not treated as typing', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByLabelText('Line 2 (locked)'), { key: 'c', ctrlKey: true })
    expect(p.onBlocked).not.toHaveBeenCalled()
  })

  it('Enter splits an editable line; multi-line paste is handed to the editor', () => {
    const p = setup()
    const free = screen.getByLabelText('Line 1')
    fireEvent.keyDown(free, { key: 'Enter' })
    expect(p.onSplit).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number))
    fireEvent.paste(free, { clipboardData: { getData: () => 'one\ntwo' } })
    expect(p.onPaste).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number), 'one\ntwo')
  })

  it('shows the note count and lets you open notes', () => {
    const p = setup()
    fireEvent.click(screen.getByLabelText('Notes for line 2 (1)'))
    expect(p.onNotes).toHaveBeenCalledWith('b')
  })

  describe('syllables and rhyme colours', () => {
    const word = (text: string, start: number, o = {}) => ({
      text,
      start,
      end: start + text.length,
      status: 'known' as const,
      syllables_min: 1,
      syllables_max: 1,
      is_end: false,
      family: null as number | null,
      ...o,
    }) // fmt: skip
    const analysis = (lineText: string, over = {}) => ({
      byId: new Map([
        [
          'a',
          {
            text: lineText,
            syllables: { min: 2, max: 2, exact: true, guessed: false },
            words: [word('free', 0, { family: 0, is_end: true }), word('line', 5)],
          },
        ],
      ]),
      families: [{ id: 0, sound: 'iː', size: 2, end_count: 2 }],
      unknown: [],
      failed: false,
      ...over,
    }) // fmt: skip

    function draw(extra = {}) {
      const base = {
        section,
        activeLineId: null,
        focusReq: null,
        onText: vi.fn(),
        onSplit: vi.fn(),
        onBackspaceEmpty: vi.fn(),
        onMergeUp: vi.fn(),
        onPaste: vi.fn(() => true),
        onActive: vi.fn(),
        onToggleLock: vi.fn(),
        onBlocked: vi.fn(),
        onNotes: vi.fn(),
      } // fmt: skip
      return render(<Pad {...base} {...extra} />)
    }

    it('shows estimated syllables in the margin, not line numbers', () => {
      const { container } = draw({
        analysis: analysis('free line'),
        syllableDisplay: 'syllables',
        highlight: 'off',
      })
      const nums = [...container.querySelectorAll('.pad-num')].map((n) => n.textContent)
      expect(nums[0]).toBe('2')
      expect(container.querySelector('.pad-num')).toHaveAttribute(
        'title',
        expect.stringContaining('Estimated syllables'),
      )
    })

    it('can show line numbers instead', () => {
      const { container } = draw({ analysis: analysis('free line'), syllableDisplay: 'numbers' })
      expect([...container.querySelectorAll('.pad-num')].map((n) => n.textContent)).toEqual([
        '1',
        '2',
      ])
    })

    it('dims a number whose line has changed since it was counted', () => {
      const { container } = draw({
        analysis: analysis('free line (old text)'),
        syllableDisplay: 'syllables',
      })
      expect(container.querySelector('.pad-num')).toHaveClass('stale')
    })

    it('says so when the server cannot be reached', () => {
      const { container } = draw({
        analysis: { byId: new Map(), families: [], unknown: [], failed: true },
        syllableDisplay: 'syllables',
      })
      expect(container.querySelector('.pad-num')?.textContent).toBe('–')
    })

    it('draws a colour behind rhyming words without changing the line text', () => {
      const { container } = draw({
        analysis: analysis('free line'),
        syllableDisplay: 'syllables',
        highlight: 'all',
      })
      const mark = container.querySelector('.pad-hl .rf')
      expect(mark?.textContent).toBe('free')
      expect(container.querySelector('.pad-hl')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByLabelText('Line 1')).toHaveValue('free line')
    })

    it('draws nothing when colours are off', () => {
      const { container } = draw({
        analysis: analysis('free line'),
        syllableDisplay: 'syllables',
        highlight: 'off',
      })
      expect(container.querySelector('.pad-hl')).toBeNull()
    })

    it('reports a selected single word for lookup', () => {
      const onSelectWord = vi.fn()
      draw({ onSelectWord })
      const input = screen.getByLabelText('Line 1') as HTMLInputElement
      input.setSelectionRange(0, 4)
      fireEvent.select(input)
      expect(onSelectWord).toHaveBeenCalledWith('free')
    })
  })
})
