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

// Archive a study straight from the ledger (soft delete — recoverable in
// Admin → Recently Archived). Redirects back to the same client's ledger.
export async function deleteLedgerStudyAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  const clientId = parseId(formData.get('client_id'));
  if (id == null || clientId == null) redirectTo('/reports/transactions');
  const api = await apiForRequest();
  await api.deleteStudy(id);
  revalidatePath('/', 'layout');
  redirectTo(`/reports/transactions?client_id=${clientId}`);
}

// Archive a contract from the ledger. The backend 409s if active studies
// still roll up to it; the UI only offers Delete on contracts with none.
export async function deleteLedgerContractAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  const clientId = parseId(formData.get('client_id'));
  if (id == null || clientId == null) redirectTo('/reports/transactions');
  const api = await apiForRequest();
  await api.deleteContract(id);
  revalidatePath('/', 'layout');
  redirectTo(`/reports/transactions?client_id=${clientId}`);
}
