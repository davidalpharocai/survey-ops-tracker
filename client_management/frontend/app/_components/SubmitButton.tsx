'use client';

import { useFormStatus } from 'react-dom';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Label shown while the form action is in flight (defaults to children). */
  pendingLabel?: ReactNode;
}

/**
 * A submit button that disables itself while its form's server action is
 * running. This is the click-level guard against double submission: a
 * fast double-click on "Record contract" / "Publish study" would
 * otherwise fire the action twice and book the money twice. Pair with the
 * backend's idempotency keys for defence in depth.
 *
 * Must be rendered inside the <form> it submits (useFormStatus reads the
 * nearest enclosing form's pending state).
 */
export default function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...rest
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
