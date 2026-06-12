// Tiny pub/sub toast helper — fire-and-forget from anywhere (hooks, event
// handlers, mutation callbacks). The <Toaster /> in app/providers.tsx listens
// for these events and renders the stack.

export type ToastKind = 'error' | 'success'

export interface ToastDetail {
  message: string
  kind: ToastKind
}

export function toast(message: string, kind: ToastKind = 'error') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<ToastDetail>('sot-toast', { detail: { message, kind } })
  )
}
