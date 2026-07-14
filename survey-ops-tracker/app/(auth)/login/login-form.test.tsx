import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginForm from './login-form'

let searchParamsValue = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}))

const signInWithOtp = vi.fn()
const signOut = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOtp, signOut } }),
}))

beforeEach(() => {
  searchParamsValue = new URLSearchParams()
  signInWithOtp.mockClear()
  signOut.mockClear()
})

describe('LoginForm (passwordless magic link)', () => {
  it('sends a magic link to the @alpharoc.ai email and shows the confirmation', async () => {
    signInWithOtp.mockResolvedValue({ error: null })
    render(<LoginForm />)
    fireEvent.change(screen.getByPlaceholderText('you'), { target: { value: 'someone' } })
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }))
    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'someone@alpharoc.ai',
          options: expect.objectContaining({ shouldCreateUser: false }),
        })
      )
    )
    expect(await screen.findByText(/Check your email/i)).toBeInTheDocument()
    expect(screen.getByText(/someone@alpharoc\.ai/)).toBeInTheDocument()
  })

  it('strips a pasted full email down to the username before building the address', async () => {
    signInWithOtp.mockResolvedValue({ error: null })
    render(<LoginForm />)
    fireEvent.change(screen.getByPlaceholderText('you'), { target: { value: 'someone@alpharoc.ai' } })
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }))
    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: 'someone@alpharoc.ai' }))
    )
  })

  it('signs out and warns on ?unauthorized', () => {
    searchParamsValue = new URLSearchParams('unauthorized=1')
    render(<LoginForm />)
    expect(signOut).toHaveBeenCalled()
    expect(screen.getByText(/Only @alpharoc\.ai accounts can access/i)).toBeInTheDocument()
  })

  it('shows the expired-link notice when error=link is present', () => {
    searchParamsValue = new URLSearchParams('error=link')
    render(<LoginForm />)
    expect(screen.getByText(/That sign-in link expired or was already used/i)).toBeInTheDocument()
  })
})
