'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId, redirectTo } from '../../../lib/action';

interface StudyInput {
  name?: FormDataEntryValue | null;
  occurred_on?: FormDataEntryValue | null;
  cost_type?: FormDataEntryValue | null;
  cadence?: FormDataEntryValue | null;
  cost?: FormDataEntryValue | null;
  cost_per_run?: FormDataEntryValue | null;
  cost_amount?: FormDataEntryValue | null;
  setup_cost?: FormDataEntryValue | null;
  client_user_ids?: FormDataEntryValue[];
}

// Collect the unified study form fields into a backend payload.
function studyBody(src: StudyInput) {
  return {
    name: src.name,
    occurred_on: src.occurred_on,
    cost_type: src.cost_type,
    cadence: src.cadence,
    cost: src.cost,
    cost_per_run: src.cost_per_run,
    cost_amount: src.cost_amount,
    setup_cost: src.setup_cost,
    client_user_ids: (src.client_user_ids || []).filter(Boolean),
  };
}

// Pull a single study's fields from a flat FormData using the same
// `studies[<id>][field]` naming the legacy bulk form used.
function bulkStudyFromFormData(formData: FormData, sid: string): StudyInput {
  const pfx = `studies[${sid}]`;
  return {
    name: formData.get(`${pfx}[name]`),
    occurred_on: formData.get(`${pfx}[occurred_on]`),
    cost_type: formData.get(`${pfx}[cost_type]`),
    cadence: formData.get(`${pfx}[cadence]`),
    cost: formData.get(`${pfx}[cost]`),
    setup_cost: formData.get(`${pfx}[setup_cost]`),
    client_user_ids: formData
      .getAll(`${pfx}[client_user_ids][]`)
      .filter(Boolean),
  };
}

export async function createStudyAction(formData: FormData): Promise<void> {
  const clientId = parseId(formData.get('client_id'));
  if (clientId == null) redirectTo('/studies/new');
  const api = await apiForRequest();
  const body = studyBody({
    name: formData.get('name'),
    occurred_on: formData.get('occurred_on'),
    cost_type: formData.get('cost_type'),
    cadence: formData.get('cadence'),
    cost: formData.get('cost'),
    setup_cost: formData.get('setup_cost'),
    client_user_ids: formData.getAll('client_user_ids'),
  });
  const contractId = parseId(formData.get('contract_id'));
  await api.createStudy({ client_id: formData.get('client_id'), ...body, contract_id: contractId });
  revalidatePath('/', 'layout');
  redirectTo(`/studies/new?client_id=${clientId}`);
}

export async function updateStudyAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/studies/new');
  const api = await apiForRequest();
  const t = await api.getTransaction(id);
  if (!t || t.kind !== 'study') redirectTo('/studies/new');
  // Preserve the existing contract link when the form doesn't carry the
  // field (so an edit that omits it can't silently unlink the study).
  const contractId = formData.has('contract_id')
    ? parseId(formData.get('contract_id'))
    : (t.contractId ?? null);
  await api.updateStudy(id, {
    ...studyBody({
      name: formData.get('name'),
      occurred_on: formData.get('occurred_on'),
      cost_type: formData.get('cost_type'),
      cadence: formData.get('cadence'),
      cost: formData.get('cost'),
      setup_cost: formData.get('setup_cost'),
      client_user_ids: formData.getAll('client_user_ids'),
    }),
    contract_id: contractId,
  });
  revalidatePath('/', 'layout');
  redirectTo(`/studies/new?client_id=${t.clientId}`);
}

export async function deleteStudyAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/studies/new');
  const api = await apiForRequest();
  const r = await api.deleteStudy(id);
  revalidatePath('/', 'layout');
  redirectTo(`/studies/new?client_id=${r.clientId}`);
}

export async function markStudyReviewedAction(formData: FormData): Promise<void> {
  const id = parseId(formData.get('id'));
  if (id == null) redirectTo('/studies/new');
  const api = await apiForRequest();
  const r = await api.markStudyReviewed(id);
  revalidatePath('/', 'layout');
  redirectTo(`/studies/new?client_id=${r.clientId}`);
}

// Save every row of the existing-studies table in one shot.
export async function bulkUpdateStudiesAction(formData: FormData): Promise<void> {
  const clientId = parseId(formData.get('client_id'));
  if (!clientId) redirectTo('/studies/new');

  const sids = new Set<string>();
  for (const key of formData.keys()) {
    const m = key.match(/^studies\[(\d+)\]/);
    if (m) sids.add(m[1]);
  }
  const studies: Record<string, ReturnType<typeof studyBody>> = {};
  for (const sid of sids) {
    studies[sid] = studyBody(bulkStudyFromFormData(formData, sid));
  }

  const api = await apiForRequest();
  await api.bulkUpdateStudies({ client_id: clientId, studies });
  revalidatePath('/', 'layout');
  redirectTo(`/studies/new?client_id=${clientId}`);
}
