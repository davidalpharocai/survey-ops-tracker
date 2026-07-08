'use client';

import { useRef } from 'react';

import { createClientAction } from './actions';

export default function NewClientDialog({ today }: { today: string }) {
  const ref = useRef<HTMLDialogElement>(null);
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
            <label>Client name <input name="name" type="text" required autoFocus /></label>
            <label>Became a client on <input name="became_on" type="date" defaultValue={today} required /></label>
            <label>Primary contact name <input name="primary_contact_name" type="text" /></label>
            <label>Primary contact cell <input name="primary_contact_cell" type="tel" /></label>
            <label>Primary contact email <input name="primary_contact_email" type="email" /></label>
            <label>Relationship manager <input name="relationship_manager" type="text" placeholder="AlphaROC team member" /></label>
          </div>
          <div className="actions">
            <button type="submit">Create client</button>
            <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
