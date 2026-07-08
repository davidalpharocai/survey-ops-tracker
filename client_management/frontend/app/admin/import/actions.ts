'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';
import {
  applyPlan,
  buildPlan,
  type ApplyResult,
  type ImportPlan,
} from '../../../lib/importer';

export interface PreviewState {
  plan?: ImportPlan;
  error?: string;
}

export async function previewImportAction(formData: FormData): Promise<PreviewState> {
  if (!(await currentUserIsAdmin())) return { error: 'Admin access required.' };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an .xlsx file first.' };
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return { error: 'Only .xlsx workbooks are supported.' };
  }
  try {
    const api = await apiForRequest();
    const plan = await buildPlan(api, file.name, await file.arrayBuffer());
    return { plan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not read the workbook.' };
  }
}

export interface ApplyState {
  result?: ApplyResult;
  error?: string;
}

export async function applyImportAction(planJson: string): Promise<ApplyState> {
  if (!(await currentUserIsAdmin())) return { error: 'Admin access required.' };
  let plan: ImportPlan;
  try {
    plan = JSON.parse(planJson) as ImportPlan;
  } catch {
    return { error: 'Corrupt plan payload — re-upload the file.' };
  }
  try {
    const api = await apiForRequest();
    const result = await applyPlan(api, plan);
    revalidatePath('/', 'layout');
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Import failed.' };
  }
}
