'use server';

import { revalidatePath } from 'next/cache';

import { apiForRequest } from '../../../lib/action';
import { currentUserIsAdmin } from '../../../lib/auth';
import { ApiError } from '../../../lib/api';

export interface TeamActionState {
  ok?: string;
  error?: string;
}

async function guard(): Promise<string | null> {
  return (await currentUserIsAdmin()) ? null : 'Admin access required.';
}

function msg(e: unknown): string {
  return e instanceof ApiError ? e.detail : e instanceof Error ? e.message : String(e);
}

export async function inviteMemberAction(formData: FormData): Promise<TeamActionState> {
  const denied = await guard();
  if (denied) return { error: denied };
  const email = String(formData.get('email') || '').trim();
  const is_admin = formData.get('is_admin') === 'on';
  if (!email) return { error: 'Enter an email.' };
  try {
    const api = await apiForRequest();
    await api.inviteTeamMember({ email, is_admin });
    revalidatePath('/admin/team');
    return { ok: `Invited ${email}${is_admin ? ' as an admin' : ''}. Cognito emailed them a temporary password.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function setAdminAction(formData: FormData): Promise<TeamActionState> {
  const denied = await guard();
  if (denied) return { error: denied };
  const email = String(formData.get('email') || '');
  const is_admin = formData.get('is_admin') === 'true';
  try {
    const api = await apiForRequest();
    await api.setTeamAdmin({ email, is_admin });
    revalidatePath('/admin/team');
    return { ok: `${email} is ${is_admin ? 'now an admin' : 'no longer an admin'}.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function setEnabledAction(formData: FormData): Promise<TeamActionState> {
  const denied = await guard();
  if (denied) return { error: denied };
  const email = String(formData.get('email') || '');
  const enabled = formData.get('enabled') === 'true';
  try {
    const api = await apiForRequest();
    await api.setTeamEnabled({ email, enabled });
    revalidatePath('/admin/team');
    return { ok: `${email} ${enabled ? 'enabled' : 'disabled'}.` };
  } catch (e) {
    return { error: msg(e) };
  }
}
