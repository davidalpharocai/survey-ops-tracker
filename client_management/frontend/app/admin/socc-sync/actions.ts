'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest } from '../../../lib/action';
import type { SoccStatus, SoccSyncResult } from '../../../lib/types';

// Apply parsed SOCC statuses (called programmatically from the client, not
// as a form action). The backend is admin-gated and enforces status-only.
export async function applySoccSync(statuses: SoccStatus[]): Promise<SoccSyncResult> {
  const api = await apiForRequest();
  const result = await api.soccSync(statuses);
  revalidatePath('/', 'layout');
  return result;
}
