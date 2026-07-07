'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { revokeToken } from '@/lib/oauth/store'

export async function revokeConnectionAction(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await revokeToken(id, user.id)
  revalidatePath('/connect')
}
