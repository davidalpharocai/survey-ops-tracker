'use client';

import { useEffect, useRef, useState } from 'react';

import type { Salesperson } from '../../lib/types';
import SalespersonPicker from './SalespersonPicker';
import { createClientAction } from './actions';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Match {
  id: number;
  name: string;
  code?: string | null;
}

export default function NewClientDialog({
  today,
  salespeople,
}: {
  today: string;
  salespeople: Salesperson[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);

  // As the name is typed, look for existing clients with a similar name via
  // the same /api/search the omnibox uses — duplicates are born in this exact
  // dialog, and one-client-one-record matters for the SOCC PR##### mapping.
  // Non-blocking: it only surfaces matches; creation is still allowed.
  useEffect(() => {
    const term = name.trim();
    if (term.length < 2) {
      setMatches([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (!res.ok) return;
        const data = await res.json();
        setMatches(Array.isArray(data?.clients) ? data.clients.slice(0, 5) : []);
      } catch {
        /* aborted / offline — ignore */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [name]);

  return (
    <>
      <a
        className="btn btn-sm"
        href="#new-client"
        onClick={e => {
          e.preventDefault();
          ref.current?.showModal();
        }}
      >
        + New
      </a>
      <dialog ref={ref} className="dialog">
        <form action={createClientAction}>
          <h2>New client</h2>
          <div className="form-grid">
            <label>Client name
              <input
                name="name"
                type="text"
                required
                autoFocus
                autoComplete="off"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </label>
            <label>Client since <input name="became_on" type="date" defaultValue={today} required /></label>
            <label>Primary contact name <input name="primary_contact_name" type="text" /></label>
            <label>Primary contact cell <input name="primary_contact_cell" type="tel" /></label>
            <label>Primary contact email <input name="primary_contact_email" type="email" /></label>
          </div>

          {matches.length > 0 && (
            <div className="dup-warn" role="status">
              <strong>Possible existing {matches.length === 1 ? 'match' : 'matches'}</strong> — already a client?
              <ul>
                {matches.map(m => (
                  <li key={m.id}>
                    <a href={`${BASE}/clients?id=${m.id}`}>{m.name}</a>
                    {m.code ? <span className="muted small"> · {m.code}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <SalespersonPicker salespeople={salespeople} />

          <div className="actions">
            <button type="submit">Create client</button>
            <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
