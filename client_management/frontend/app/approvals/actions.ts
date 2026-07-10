'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../lib/action';

function note(fd: FormData): string | undefined {
  const v = (fd.get('decision_note') || '').toString().trim();
  return v || undefined;
}

export async function approveCreditRequestAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/approvals');
  const api = await apiForRequest();
  await api.approveCreditRequest(id, note(formData));
  revalidatePath('/', 'layout');
  redirectTo('/approvals');
}

export async function rejectCreditRequestAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/approvals');
  const api = await apiForRequest();
  await api.rejectCreditRequest(id, note(formData));
  revalidatePath('/', 'layout');
  redirectTo('/approvals');
}
