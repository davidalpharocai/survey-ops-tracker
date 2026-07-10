'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { SearchResults } from '../../lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Item {
  key: string;
  label: string;
  sub: string;
  href: string;
  group: string;
}

function toItems(r: SearchResults): Item[] {
  const out: Item[] = [];
  r.clients.forEach(c =>
    out.push({ key: `cl${c.id}`, label: c.name, sub: c.code ? `Client · ${c.code}` : 'Client', href: `/clients?id=${c.id}`, group: 'Clients' }));
  r.contracts.forEach(t =>
    out.push({ key: `co${t.id}`, label: t.name, sub: `Contract · ${t.clientName}`, href: `/reports/transactions?client_id=${t.clientId}`, group: 'Contracts' }));
  r.studies.forEach(t =>
    out.push({ key: `st${t.id}`, label: t.name, sub: `Survey · ${t.clientName}`, href: `/reports/transactions?client_id=${t.clientId}`, group: 'Surveys' }));
  r.contacts.forEach(u =>
    out.push({ key: `ct${u.id}`, label: u.name, sub: `Contact · ${u.clientName}`, href: `/users/${u.id}`, group: 'Contacts' }));
  return out;
}

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setItems([]);
      setOpen(false);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as SearchResults;
        setItems(toItems(data));
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted / offline — ignore */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function go(it: Item) {
    setOpen(false);
    setQ('');
    setItems([]);
    router.push(it.href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) go(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  let lastGroup = '';
  return (
    <div className="search-box" ref={boxRef}>
      <span className="search-icon" aria-hidden="true">🔍</span>
      <input
        type="search"
        className="search-input"
        placeholder="Search clients, surveys, contacts…"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open}
        aria-controls="search-pop"
        aria-autocomplete="list"
      />
      {open && (
        <div className="search-pop" id="search-pop" role="listbox">
          {items.length === 0 ? (
            <div className="search-empty muted">No matches.</div>
          ) : (
            items.map((it, i) => {
              const header = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
              return (
                <div key={it.key}>
                  {header && <div className="search-group">{header}</div>}
                  <button
                    type="button"
                    className={`search-item${i === active ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={e => {
                      e.preventDefault();
                      go(it);
                    }}
                  >
                    <span className="search-item-label">{it.label}</span>
                    <span className="search-item-sub muted small">{it.sub}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
