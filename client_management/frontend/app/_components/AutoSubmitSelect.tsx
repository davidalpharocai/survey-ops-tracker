'use client';

import { useRef } from 'react';
import type { SelectHTMLAttributes } from 'react';

/**
 * A <select> that submits its form when the user commits a choice.
 *
 * A naive `onChange -> form.submit()` is a keyboard trap: on most
 * browsers arrow keys fire `change` for every option they land on, so
 * the form submits (and the page navigates) before a keyboard user can
 * reach the option they want. Here a mouse/touch pick submits at once
 * (for that input, a change *is* the commit), while keyboard navigation
 * defers submission until the user actually commits — Enter, or blurring
 * away after changing the value.
 */
export default function AutoSubmitSelect({
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const usedKeyboard = useRef(false);
  const valueAtFocus = useRef<string | null>(null);

  const submit = (el: HTMLSelectElement) => {
    const form = el.form;
    if (!form) return;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  };

  return (
    <select
      {...rest}
      onFocus={e => {
        valueAtFocus.current = e.currentTarget.value;
        usedKeyboard.current = false;
      }}
      onKeyDown={e => {
        usedKeyboard.current = true;
        if (e.key === 'Enter') submit(e.currentTarget);
      }}
      onChange={e => {
        if (!usedKeyboard.current) submit(e.currentTarget);
      }}
      onBlur={e => {
        if (usedKeyboard.current && e.currentTarget.value !== valueAtFocus.current) {
          submit(e.currentTarget);
        }
      }}
    >
      {children}
    </select>
  );
}
