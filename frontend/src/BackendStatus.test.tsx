import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendStatus } from './BackendStatus'

afterEach(() => vi.unstubAllGlobals())

describe('BackendStatus', () => {
  it('shows OK when the backend answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok', service: 's', version: '1.2.3' }),
      }),
    )
    render(<BackendStatus />)
    expect(await screen.findByText(/Backend OK \(version 1\.2\.3\)/)).toBeInTheDocument()
  })

  it('shows a clear error when the backend is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    render(<BackendStatus />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Backend not reachable/)
  })

  it('shows an error on a non-200 reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    render(<BackendStatus />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/500/)
  })
})
