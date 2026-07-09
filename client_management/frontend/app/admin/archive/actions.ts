'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest, parseId } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';
import { ApiError, type ArchivedRecordType } from '../../../lib/api';

export interface ArchiveActionState {
  ok?: string;
  error?: string;
}

const TYPES: ArchivedRecordType[] = ['client', 'user', 'transaction'];

function msg(e: unknown): string {
  return e instanceof ApiError ? e.detail : e instanceof Error ? e.message : String(e);
}

export async function restoreArchivedAction(
  formData: FormData,
): Promise<ArchiveActionState> {
  if (!(await currentUserIsAdmin())) return { error: 'Admin access required.' };
  const type = String(formData.get('type') || '') as ArchivedRecordType;
  const id = parseId(formData.get('id'));
  if (!TYPES.includes(type) || id == null) {
    return { error: 'Invalid restore request.' };
  }
  try {
    const api = await apiForRequest();
    const res = await api.restoreArchived({ type, id });
    // The restored record affects lists and balances everywhere.
    revalidatePath('/', 'layout');
    return { ok: `Restored ${res.name}.` };
  } catch (e) {
    return { error: msg(e) };
  }
}
