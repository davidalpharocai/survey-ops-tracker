'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../../lib/action';
import { authHeaders, BACKEND_BASE } from '../../../lib/api';
import { currentUserEmail } from '../../../lib/auth';

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

// Upload a document to a contract. Forwards the multipart body straight to
// the backend with the same auth headers the JSON client uses; on rejection
// (bad type / too large) it redirects back with a readable message rather
// than throwing an error page. Kept out of the JSON api client because the
// body is multipart, not JSON.
export async function uploadContractAttachmentAction(formData: FormData): Promise<void> {
  const contractId = parseId(formData.get('contract_id'));
  const clientId = parseId(formData.get('client_id'));
  if (contractId == null || clientId == null) redirectTo('/reports/transactions');
  const back = `/reports/transactions?client_id=${clientId}`;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    redirectTo(`${back}&att_error=${encodeURIComponent('Choose a file to upload.')}`);
  }
  const fwd = new FormData();
  fwd.append('file', file, file.name);
  let res: Response;
  try {
    res = await fetch(`${BACKEND_BASE}/api/contracts/${contractId}/attachments`, {
      method: 'POST',
      headers: await authHeaders(await currentUserEmail()),
      body: fwd,
      cache: 'no-store',
    });
  } catch {
    redirectTo(`${back}&att_error=${encodeURIComponent('Upload failed — please try again.')}`);
  }
  if (!res.ok) {
    let detail = `Upload failed (${res.status}).`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j?.detail === 'string') detail = j.detail;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    redirectTo(`${back}&att_error=${encodeURIComponent(detail)}`);
  }
  revalidatePath('/', 'layout');
  redirectTo(`${back}&att_ok=1`);
}

// Soft-delete a contract attachment (recoverable; bytes retained).
export async function deleteContractAttachmentAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  const clientId = parseId(formData.get('client_id'));
  if (id == null || clientId == null) redirectTo('/reports/transactions');
  const api = await apiForRequest();
  await api.deleteAttachment(id);
  revalidatePath('/', 'layout');
  redirectTo(`/reports/transactions?client_id=${clientId}`);
}
