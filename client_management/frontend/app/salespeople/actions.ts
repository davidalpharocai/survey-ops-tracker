'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../lib/action';

function str(v: FormDataEntryValue | null): string {
  return (v ?? '').toString().trim();
}

export async function createSalespersonAction(formData: FormData): Promise<void> {
  const name = str(formData.get('name'));
  if (name) {
    const api = await apiForRequest();
    await api.createSalesperson({ name, email: str(formData.get('email')) || null });
  }
  revalidatePath('/', 'layout');
  redirectTo('/salespeople');
}

export async function updateSalespersonAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/salespeople');
  const api = await apiForRequest();
  await api.updateSalesperson(id, {
    name: str(formData.get('name')),
    email: str(formData.get('email')) || null,
  });
  revalidatePath('/', 'layout');
  redirectTo('/salespeople');
}

export async function deleteSalespersonAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/salespeople');
  const api = await apiForRequest();
  await api.deleteSalesperson(id);
  revalidatePath('/', 'layout');
  redirectTo('/salespeople');
}
