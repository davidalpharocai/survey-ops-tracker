'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { apiForRequest, parseId } from '../../lib/action';

export async function createClientAction(formData: FormData): Promise<void> {
  const api = await apiForRequest();
  const c = await api.createClient({
    name: formData.get('name'),
    became_on: formData.get('became_on'),
    primary_contact_name: formData.get('primary_contact_name'),
    primary_contact_cell: formData.get('primary_contact_cell'),
    primary_contact_email: formData.get('primary_contact_email'),
    relationship_manager: formData.get('relationship_manager'),
  });
  revalidatePath('/', 'layout');
  redirect(`/clients?id=${c.id}`);
}

export async function updateClientAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirect('/clients');
  const api = await apiForRequest();
  await api.updateClient(id, {
    name: formData.get('name'),
    became_on: formData.get('became_on'),
    primary_contact_name: formData.get('primary_contact_name'),
    primary_contact_cell: formData.get('primary_contact_cell'),
    primary_contact_email: formData.get('primary_contact_email'),
    relationship_manager: formData.get('relationship_manager'),
  });
  revalidatePath('/', 'layout');
  redirect(`/clients?id=${id}`);
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirect('/clients');
  const api = await apiForRequest();
  await api.deleteClient(id);
  revalidatePath('/', 'layout');
  redirect('/clients');
}

export async function createClientUserAction(formData: FormData): Promise<void> {
  const clientId = parseId(formData.get('client_id'));
  if (clientId == null) redirect('/clients');
  const api = await apiForRequest();
  await api.createClientUser(clientId, {
    name: formData.get('name'),
    email: formData.get('email'),
  });
  revalidatePath('/', 'layout');
  redirect(`/clients?id=${clientId}`);
}

export async function updateClientUserAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirect('/clients');
  const api = await apiForRequest();
  const u = await api.getClientUser(id);
  if (!u) redirect('/clients');
  await api.updateClientUser(id, {
    name: formData.get('name'),
    email: formData.get('email'),
  });
  revalidatePath('/', 'layout');
  redirect(`/clients?id=${u.clientId}`);
}

export async function deleteClientUserAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirect('/clients');
  const api = await apiForRequest();
  const u = await api.getClientUser(id);
  if (!u) redirect('/clients');
  const r = await api.deleteClientUser(id);
  revalidatePath('/', 'layout');
  redirect(`/clients?id=${r.clientId}`);
}
