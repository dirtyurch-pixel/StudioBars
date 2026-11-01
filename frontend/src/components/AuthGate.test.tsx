import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../api'
import { AuthGate } from './AuthGate'

const api = vi.hoisted(() => ({ authStatus: vi.fn(), authLogin: vi.fn() }))
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), ...api }))

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()))

describe('AuthGate', () => {
  it('shows the app straight away when no PIN is set', async () => {
    api.authStatus.mockResolvedValue({ required: false, ok: true })
    render(<AuthGate>the app</AuthGate>)
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('asks for the PIN, rejects a wrong one, then opens', async () => {
    api.authStatus.mockResolvedValue({ required: true, ok: false })
    api.authLogin.mockRejectedValueOnce(
      new ApiFail('That PIN is not right.', { status: 401, code: 'BAD_PIN' }),
    )
    api.authLogin.mockResolvedValueOnce({ required: true, ok: true })
    render(<AuthGate>the app</AuthGate>)
    const input = await screen.findByLabelText('PIN')
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not right')
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('locks again if the server later says a PIN is needed', async () => {
    api.authStatus.mockResolvedValue({ required: true, ok: true })
    render(<AuthGate>the app</AuthGate>)
    await screen.findByText('the app')
    act(() => {
      window.dispatchEvent(new Event('sb-locked'))
    })
    await waitFor(() => expect(screen.getByLabelText('PIN')).toBeInTheDocument())
  })

  it('lets the editor show its offline banner if the server cannot be reached', async () => {
    api.authStatus.mockRejectedValue(new ApiFail('Cannot reach', { network: true }))
    render(<AuthGate>the app</AuthGate>)
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })
})
