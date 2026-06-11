'use client'

import { useRealtimeSync } from '@/lib/hooks/useRealtimeSync'

/**
 * Invisible component that keeps the app live: mounts the realtime
 * subscription once so teammates' changes appear without refreshing.
 */
export function RealtimeSync() {
  useRealtimeSync()
  return null
}
