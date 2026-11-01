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
})
