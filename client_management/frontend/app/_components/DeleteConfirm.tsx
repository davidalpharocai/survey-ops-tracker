'use client';

import { useState } from 'react';

// SOCC-style destructive confirm: the Delete button expands to require
// typing "Delete" before Confirm is enabled, so nothing is archived by a
// stray click. The delete itself is a soft delete (recoverable in
// Admin → Recently Archived). `action` is a server action.

interface Props {
  action: (formData: FormData) => void | Promise<void>;
  id: number;
  clientId: number;
  name: string;
}

export default function DeleteConfirm({ action, id, clientId, name }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const armed = text.trim().toLowerCase() === 'delete';

  if (!open) {
    return (
      <button
        type="button"
        className="btn-sm btn-danger"
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
    );
  }

  return (
    <form action={action} className="delete-confirm">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="client_id" value={clientId} />
      <input
        className="delete-confirm-input"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder='Type "Delete"'
        aria-label={`Type Delete to archive ${name}`}
        autoFocus
      />
      <button type="submit" className="btn-sm btn-danger" disabled={!armed}>
        Confirm
      </button>
      <button
        type="button"
        className="btn-sm"
        onClick={() => {
          setOpen(false);
          setText('');
        }}
      >
        Cancel
      </button>
    </form>
  );
}
