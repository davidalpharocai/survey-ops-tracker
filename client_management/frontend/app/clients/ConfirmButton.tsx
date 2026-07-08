'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  message: string;
  children: ReactNode;
}

export default function ConfirmButton({ message, children, onClick, ...rest }: Props) {
  return (
    <button
      {...rest}
      onClick={e => {
        if (!window.confirm(message)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
