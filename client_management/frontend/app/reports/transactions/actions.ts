'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../../lib/action';

export async function createAdjustmentAction(formData: FormData): Promise<void> {
  const clientId = parseId(formData.get('client_id'));
  if (clientId == null) redirectTo('/reports/transactions');
  const api = await apiForRequest();
  await api.createAdjustment({
    client_id: clientId,
    credits_delta: formData.get('credits_delta'),
    dollars_delta: formData.get('dollars_delta'),
    note: formData.get('note'),
  });
  revalidatePath('/', 'layout');
  redirectTo(`/reports/transactions?client_id=${clientId}`);
}
