'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../../lib/action';

export async function submitCreditRequestAction(formData: FormData): Promise<void> {
  const api = await apiForRequest();
  await api.submitCreditRequest({
    client_id: parseId(formData.get('client_id')),
    credits_delta: (formData.get('credits') || '').toString().trim() || 0,
    dollars_delta: (formData.get('dollars') || '').toString().trim() || 0,
    note: (formData.get('note') || '').toString(),
  });
  revalidatePath('/', 'layout');
  redirectTo('/credit-requests/new?submitted=1');
}

export async function cancelMyCreditRequestAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/credit-requests/new');
  const api = await apiForRequest();
  await api.cancelCreditRequest(id);
  revalidatePath('/', 'layout');
  redirectTo('/credit-requests/new');
}
