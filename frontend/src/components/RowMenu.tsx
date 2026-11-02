import { useEffect, useRef, useState } from 'react'

/** The "⋯" menu on a song row: Open, Delete. Closes on outside tap or Escape. */
export function RowMenu({
  title,
  onOpen,
  onDelete,
}: {
  title: string
  onOpen: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="row-menu" ref={box}>
      <button
        className="icon-btn"
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="row-menu-list" role="menu" aria-label={`${title} options`}>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpen()
            }}
          >
            Open
          </button>
          <button
            role="menuitem"
            className="danger"
            aria-label={`Delete ${title}`}
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  )
}
