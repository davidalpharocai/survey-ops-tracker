'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiForRequest, parseId } from '../../../lib/action';

export async function createContractAction(formData: FormData): Promise<void> {
  const clientId = parseId(formData.get('client_id'));
  if (clientId == null) redirect('/contracts/new');
  const api = await apiForRequest();
  await api.createContract({
    client_id: formData.get('client_id'),
    name: formData.get('name'),
    occurred_on: formData.get('occurred_on'),
    renewal_on: formData.get('renewal_on'),
    credits_amount: formData.get('credits_amount'),
    dollars_amount: formData.get('dollars_amount'),
  });
  revalidatePath('/', 'layout');
  redirect(`/contracts/new?client_id=${clientId}`);
}

export async function updateContractAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirect('/contracts/new');
  const api = await apiForRequest();
  const t = await api.getTransaction(id);
  if (!t || t.kind !== 'contract') redirect('/contracts/new');
  await api.updateContract(id, {
    name: formData.get('name'),
    occurred_on: formData.get('occurred_on'),
    renewal_on: formData.get('renewal_on'),
    credits_amount: formData.get('credits_amount'),
    dollars_amount: formData.get('dollars_amount'),
  });
  revalidatePath('/', 'layout');
  redirect(`/contracts/new?client_id=${t.clientId}`);
}

export async function deleteContractAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirect('/contracts/new');
  const api = await apiForRequest();
  const r = await api.deleteContract(id);
  revalidatePath('/', 'layout');
  redirect(`/contracts/new?client_id=${r.clientId}`);
}
