import { Menu } from './Menu'

/** The "⋯" menu on a song row: Open, Delete. */
export function RowMenu({
  title,
  onOpen,
  onDelete,
}: {
  title: string
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <Menu
      label={`More for ${title}`}
      items={[
        { label: 'Open', onSelect: onOpen },
        { label: 'Delete…', onSelect: onDelete, danger: true, ariaLabel: `Delete ${title}` },
      ]}
    />
  )
}
