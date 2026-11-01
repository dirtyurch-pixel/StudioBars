import { GENRES, type Genre } from '../types'

export function GenrePicker({
  value,
  onChange,
}: {
  value: Genre[]
  onChange: (g: Genre[]) => void
}) {
  return (
    <div className="chips" role="group" aria-label="Genres">
      {GENRES.map((g) => {
        const on = value.includes(g.id)
        return (
          <button
            key={g.id}
            type="button"
            className={`chip chip-btn${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}
          >
            {g.label}
          </button>
        )
      })}
    </div>
  )
}
