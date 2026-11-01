import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportDialog } from './ImportDialog'

const api = vi.hoisted(() => ({ previewImport: vi.fn(), commitImport: vi.fn() }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

/** A file whose contents take a while to read, like a slow disk or a busy machine. */
function slowFile(name: string, content: string, ms: number): File {
  const f = new File([content], name)
  Object.defineProperty(f, 'text', {
    value: () => new Promise<string>((r) => setTimeout(() => r(content), ms)),
  })
  return f
}

beforeEach(() => {
  vi.resetAllMocks()
  api.previewImport.mockResolvedValue({
    title: 'T',
    warnings: [],
    line_count: 1,
    locked_count: 0,
    sections: [{ label: 'V', section_type: 'verse', lines: ['hi'] }],
  })
  api.commitImport.mockResolvedValue({ id: 'abc12345' })
})

describe('ImportDialog', () => {
  it('fills in the title from the file name when the user has not typed one', async () => {
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Choose a/), {
      target: { files: [slowFile('my song.txt', '[Verse]\nhi', 10)] },
    })
    await waitFor(() => expect(screen.getByLabelText('Title (optional)')).toHaveValue('my song'))
  })

  it('never overwrites a title the user typed while the file was still being read', async () => {
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Choose a/), {
      target: { files: [slowFile('e2e.json', '{}', 80)] },
    })
    fireEvent.change(screen.getByLabelText('Title (optional)'), {
      target: { value: 'My typed title' },
    }) // typed before the read finishes
    await new Promise((r) => setTimeout(r, 200)) // the file read has now finished
    expect(screen.getByLabelText('Title (optional)')).toHaveValue('My typed title')
  })

  it('imports with the title the user chose', async () => {
    const done = vi.fn()
    render(<ImportDialog onClose={vi.fn()} onImported={done} />)
    fireEvent.change(screen.getByLabelText(/or paste text/), { target: { value: '[Verse]\nhi' } })
    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: 'Chosen' } })
    fireEvent.click(screen.getByText('Preview'))
    fireEvent.click(await screen.findByText('Import as new song'))
    await waitFor(() =>
      expect(api.commitImport).toHaveBeenCalledWith('txt', '[Verse]\nhi', 'Chosen'),
    )
    await waitFor(() => expect(done).toHaveBeenCalledWith('abc12345'))
  })
})
