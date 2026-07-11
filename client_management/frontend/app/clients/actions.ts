'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../lib/action';
import type { ApiClient } from '../../lib/api';

/**
 * Turn the salesperson picker's fields into a concrete salesperson id.
 * `salesperson_id` is either an existing id or the sentinel `__new__`; in
 * the latter case a salesperson is created from `new_salesperson_name` /
 * `new_salesperson_email` first. Returns null when nothing usable was sent.
 */
async function resolveSalespersonId(
  api: ApiClient,
  formData: FormData,
): Promise<number | null> {
  const raw = (formData.get('salesperson_id') || '').toString().trim();
  if (raw && raw !== '__new__') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const name = (formData.get('new_salesperson_name') || '').toString().trim();
  if (!name) return null;
  const email = (formData.get('new_salesperson_email') || '').toString().trim();
  const sp = await api.createSalesperson({ name, email: email || null });
  return sp.id;
}

export async function createClientAction(formData: FormData): Promise<void> {
  const api = await apiForRequest();
  const salespersonId = await resolveSalespersonId(api, formData);
  const c = await api.createClient({
    name: formData.get('name'),
    became_on: formData.get('became_on'),
    primary_contact_name: formData.get('primary_contact_name'),
    primary_contact_cell: formData.get('primary_contact_cell'),
    primary_contact_email: formData.get('primary_contact_email'),
    salesperson_id: salespersonId,
  });
  revalidatePath('/', 'layout');
  redirectTo(`/clients?id=${c.id}`);
}

export async function updateClientAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/clients');
  const api = await apiForRequest();
  const salespersonId = await resolveSalespersonId(api, formData);
  const body: Record<string, unknown> = {
    name: formData.get('name'),
    became_on: formData.get('became_on'),
    primary_contact_name: formData.get('primary_contact_name'),
    primary_contact_cell: formData.get('primary_contact_cell'),
    primary_contact_email: formData.get('primary_contact_email'),
    salesperson_id: salespersonId,
  };
  // Only send parent_id when the picker was on the form (admins editing a
  // non-parent client); omitting it leaves the link unchanged server-side.
  if (formData.has('parent_id')) {
    body.parent_id = parseId(formData.get('parent_id'));
  }
  await api.updateClient(id, body);
  revalidatePath('/', 'layout');
  redirectTo(`/clients?id=${id}`);
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/clients');
  const api = await apiForRequest();
  await api.deleteClient(id);
  revalidatePath('/', 'layout');
  redirectTo('/clients');
}

export async function createClientUserAction(formData: FormData): Promise<void> {
  const clientId = parseId(formData.get('client_id'));
  if (clientId == null) redirectTo('/clients');
  const api = await apiForRequest();
  await api.createClientUser(clientId, {
    name: formData.get('name'),
    email: formData.get('email'),
  });
  revalidatePath('/', 'layout');
  redirectTo(`/clients?id=${clientId}`);
}

export async function updateClientUserAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/clients');
  const api = await apiForRequest();
  const u = await api.getClientUser(id);
  if (!u) redirectTo('/clients');
  await api.updateClientUser(id, {
    name: formData.get('name'),
    email: formData.get('email'),
  });
  revalidatePath('/', 'layout');
  redirectTo(`/clients?id=${u.clientId}`);
}

export async function deleteClientUserAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/clients');
  const api = await apiForRequest();
  const u = await api.getClientUser(id);
  if (!u) redirectTo('/clients');
  const r = await api.deleteClientUser(id);
  revalidatePath('/', 'layout');
  redirectTo(`/clients?id=${r.clientId}`);
}
