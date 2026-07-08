'use client';

import { useEffect } from 'react';

// Default the renewal date to one year after the contract date, unless
// the user has explicitly touched the renewal field.
export default function RenewalAutofill() {
  useEffect(() => {
    const occ = document.getElementById('occurred-on') as HTMLInputElement | null;
    const ren = document.getElementById('renewal-on') as HTMLInputElement | null;
    if (!occ || !ren) return;
    let touched = false;
    const onInput = () => {
      touched = true;
    };
    const onOccChange = () => {
      if (touched) return;
      if (!occ.value) return;
      const d = new Date(occ.value);
      d.setFullYear(d.getFullYear() + 1);
      ren.value = d.toISOString().slice(0, 10);
    };
    ren.addEventListener('input', onInput);
    occ.addEventListener('change', onOccChange);
    if (!ren.value) onOccChange();
    return () => {
      ren.removeEventListener('input', onInput);
      occ.removeEventListener('change', onOccChange);
    };
  }, []);
  return null;
}
