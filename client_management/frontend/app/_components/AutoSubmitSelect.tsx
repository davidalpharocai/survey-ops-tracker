'use client';

import type { SelectHTMLAttributes } from 'react';

export default function AutoSubmitSelect({
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      onChange={e => {
        e.target.form?.submit();
      }}
    >
      {children}
    </select>
  );
}
