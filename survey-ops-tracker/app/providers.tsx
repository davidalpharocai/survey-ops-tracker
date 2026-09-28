'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Toaster } from '@/components/shared/Toaster'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000 },
        },
      })
  )
  // The compliance portal manages its own .dark class on #portal-root
  // (separate localStorage key, external reviewers). Force a neutral theme
  // on /portal routes so the internal next-themes class on <html> never
  // leaks into portal pages' dark: variants.
  const pathname = usePathname()
  const isPortal = pathname?.startsWith('/portal')
  // The printable client documents (/sales/accounts/[id]/print,
  // /sales/surveys/print) are paper. The default theme is dark, and under
  // print-color-adjust: exact the shell's bg-background would print as a navy
  // page around a white sheet. Forced light, so screen and PDF match.
  const isPrint = pathname?.endsWith('/print')
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      forcedTheme={isPortal || isPrint ? 'light' : undefined}
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
