import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginForm from './login-form'

const push = vi.fn()
const refresh = vi.fn()
let searchParamsValue = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => searchParamsValue,
}))

const signInWithPassword = vi.fn()
const resetPasswordForEmail = vi.fn()
const signOut = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword,
      resetPasswordForEmail,
      signOut,
    },
  }),
}))

beforeEach(() => {
  searchParamsValue = new URLSearchParams()
  push.mockClear()
  refresh.mockClear()
  signInWithPassword.mockClear()
  resetPasswordForEmail.mockClear()
  signOut.mockClear()
})

describe('LoginForm', () => {
  it('switches into reset mode and back', () => {
    render(<LoginForm />)
    fireEvent.click(screen.getByText(/First time here or forgot your password/i))
    expect(screen.getByText(/Enter your work email/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Back to sign in/i))
    expect(screen.getByText(/Sign in with your @alpharoc\.ai account/i)).toBeInTheDocument()
  })

  it('submits resetPasswordForEmail with the entered email and shows confirmation', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null })
    render(<LoginForm />)
    fireEvent.click(screen.getByText(/First time here or forgot your password/i))
    // Domain-locked field: type just the username; the form appends @alpharoc.ai.
    fireEvent.change(screen.getByPlaceholderText('you'), { target: { value: 'someone' } })
    fireEvent.click(screen.getByRole('button', { name: /Email me a set-password link/i }))
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith('someone@alpharoc.ai'))
    expect(await screen.findByText(/Check your email — we sent you a link/i)).toBeInTheDocument()
  })

  it('shows the amber expired-link notice when error=link is present', () => {
    searchParamsValue = new URLSearchParams('error=link')
    render(<LoginForm />)
    expect(screen.getByText(/That sign-in link has expired or was already used/i)).toBeInTheDocument()
  })
})
