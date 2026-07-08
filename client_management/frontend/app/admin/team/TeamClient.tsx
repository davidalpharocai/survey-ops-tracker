'use client';

import { useState, useTransition } from 'react';

import type { TeamList } from '../../../lib/api';
import {
  inviteMemberAction,
  setAdminAction,
  setEnabledAction,
  type TeamActionState,
} from './actions';

export default function TeamClient({ data }: { data: TeamList }) {
  const [msg, setMsg] = useState<TeamActionState>({});
  const [pending, startTransition] = useTransition();

  const run = (fn: (fd: FormData) => Promise<TeamActionState>, fd: FormData) => {
    setMsg({});
    startTransition(async () => setMsg(await fn(fd)));
  };

  return (
    <div>
      {msg.ok && <p className="pos" role="status">{msg.ok}</p>}
      {msg.error && <p className="neg" role="alert">{msg.error}</p>}

      {!data.configured ? (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Sign-in is managed in AWS Cognito</h2>
          <p className="muted">
            This environment isn&apos;t connected to the Cognito user pool, so
            members can&apos;t be invited from here yet. Until the backend has the
            Cognito admin permissions, add users in the AWS console:
          </p>
          <ol className="muted" style={{ paddingLeft: '1.2rem', lineHeight: 1.7 }}>
            <li>Cognito → the CCM user pool → <strong>Users</strong> → Create user (their @{data.allowedDomain} email).</li>
            <li>Add them to the <code>{data.allowedGroup}</code> group so they can sign in.</li>
            <li>For admin rights, also add them to <code>{data.adminGroup}</code>.</li>
          </ol>
          <p className="muted">
            Regardless of Cognito groups, these emails are always admins (set via
            the <code>CCM_ADMIN_EMAILS</code> env var):
          </p>
          <ul>
            {data.allowlistAdmins.map(e => <li key={e}><strong>{e}</strong></li>)}
          </ul>
        </section>
      ) : (
        <>
          <section className="panel" style={{ marginTop: 12 }}>
            <h2>Invite a member</h2>
            <form
              className="add-row-form"
              onSubmit={e => { e.preventDefault(); run(inviteMemberAction, new FormData(e.currentTarget)); }}
            >
              <label>Email
                <input name="email" type="email" placeholder={`name@${data.allowedDomain}`} required />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
                <input name="is_admin" type="checkbox" /> Admin
              </label>
              <button className="btn" type="submit" disabled={pending}>
                {pending ? 'Inviting…' : 'Send invite'}
              </button>
            </form>
            <p className="muted small">
              Cognito emails the person a temporary password. Only @{data.allowedDomain} emails are accepted.
            </p>
          </section>

          <table className="report" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Admin</th>
                <th>Access</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.members.map(m => (
                <tr key={m.email} style={m.enabled ? undefined : { opacity: 0.55 }}>
                  <td>{m.email}</td>
                  <td className="muted">{m.status}</td>
                  <td>
                    {m.isAdmin ? (
                      <span className="tag tag-contract">
                        admin{m.adminSource === 'allowlist' ? ' (allow-list)' : ''}
                      </span>
                    ) : ''}
                  </td>
                  <td>{m.enabled ? 'enabled' : 'disabled'}</td>
                  <td className="row-actions">
                    {m.adminSource === 'allowlist' ? (
                      <span className="muted small">via CCM_ADMIN_EMAILS</span>
                    ) : (
                      <button
                        className="btn btn-sm"
                        disabled={pending}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('email', m.email);
                          fd.set('is_admin', String(!m.isAdmin));
                          run(setAdminAction, fd);
                        }}
                      >
                        {m.isAdmin ? 'Remove admin' : 'Make admin'}
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set('email', m.email);
                        fd.set('enabled', String(!m.enabled));
                        run(setEnabledAction, fd);
                      }}
                    >
                      {m.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
