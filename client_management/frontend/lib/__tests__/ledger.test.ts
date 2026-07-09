import { describe, expect, it } from 'vitest';

import { filterLedger } from '../ledger';
import type { Ledger } from '../types';

function study(name: string, code?: string) {
  return { id: Math.round(name.length), name, soccProjectCode: code } as never;
}

const ledger: Ledger = {
  contracts: [
    {
      id: 1,
      name: '2026 Research Retainer',
      soccProjectCode: 'PR00001',
      remainingCredits: 700,
      remainingDollars: 0,
      studies: [study('Q2 Sentiment Tracker'), study('Energy Pulse')],
    } as never,
    {
      id: 2,
      name: 'H2 Expansion',
      soccProjectCode: 'PR00002',
      remainingCredits: 8000,
      remainingDollars: 0,
      studies: [study('Widget Study')],
    } as never,
  ],
  unassigned: [study('Loose Study'), study('Sentiment Extra')],
  adjustments: [study('Correction') as never],
  totals: { credits: 100, dollars: 0 },
};

describe('filterLedger', () => {
  it('returns the ledger unchanged for an empty query', () => {
    expect(filterLedger(ledger, '   ')).toBe(ledger);
  });

  it('keeps a contract (with all its studies) when the contract name matches', () => {
    const r = filterLedger(ledger, 'retainer');
    expect(r.contracts).toHaveLength(1);
    expect(r.contracts[0].studies).toHaveLength(2);
  });

  it('keeps a contract by PR code, case-insensitively', () => {
    const r = filterLedger(ledger, 'pr00002');
    expect(r.contracts.map(c => c.id)).toEqual([2]);
  });

  it('keeps only matching studies under a non-matching contract', () => {
    const r = filterLedger(ledger, 'energy');
    expect(r.contracts).toHaveLength(1);
    expect(r.contracts[0].id).toBe(1);
    expect(r.contracts[0].studies.map(s => s.name)).toEqual(['Energy Pulse']);
  });

  it('filters unassigned studies and adjustments too', () => {
    const r = filterLedger(ledger, 'sentiment');
    // matches the tracker study (keeps contract 1) + the unassigned "Sentiment Extra"
    expect(r.unassigned.map(s => s.name)).toEqual(['Sentiment Extra']);
    expect(r.adjustments).toHaveLength(0);
    expect(r.contracts.map(c => c.id)).toEqual([1]);
  });
});
