import { describe, expect, it } from 'vitest';

import {
  computeKpis,
  filterOwned,
  ownsAny,
  ownsClient,
} from '../clientPulse';
import type { BalanceHealthRow, BalanceRow, Client, RenewalRow } from '../types';

function client(id: number, salespersonEmail: string | null): Client {
  return { id, name: `C${id}`, becameClientOn: new Date('2024-01-01'), salespersonEmail };
}

function healthRow(id: number, email: string | null, status: BalanceHealthRow['status']): BalanceHealthRow {
  return {
    client: client(id, email),
    credits: 0,
    dollars: 0,
    monthlyCreditBurn: 0,
    monthlyDollarBurn: 0,
    creditsRunOutOn: null,
    dollarsRunOutOn: null,
    status,
  };
}

describe('ownsClient', () => {
  it('matches on salesperson email, case-insensitively', () => {
    expect(ownsClient(client(1, 'Jenna@AlphaROC.ai'), 'jenna@alpharoc.ai')).toBe(true);
  });
  it('is false when either side is blank', () => {
    expect(ownsClient(client(1, null), 'jenna@alpharoc.ai')).toBe(false);
    expect(ownsClient(client(1, 'jenna@alpharoc.ai'), '')).toBe(false);
  });
  it('is false for a different owner', () => {
    expect(ownsClient(client(1, 'alex@alpharoc.ai'), 'jenna@alpharoc.ai')).toBe(false);
  });
});

describe('ownsAny', () => {
  const rows = [healthRow(1, 'jenna@alpharoc.ai', 'ok'), healthRow(2, 'alex@alpharoc.ai', 'ok')];
  it('is true when the user owns at least one', () => {
    expect(ownsAny(rows, 'jenna@alpharoc.ai')).toBe(true);
  });
  it('is false when the user owns none', () => {
    expect(ownsAny(rows, 'vineet@alpharoc.ai')).toBe(false);
  });
});

describe('filterOwned', () => {
  const rows = [healthRow(1, 'jenna@alpharoc.ai', 'ok'), healthRow(2, 'alex@alpharoc.ai', 'ok')];
  it('returns everything in "all" mode', () => {
    expect(filterOwned(rows, 'jenna@alpharoc.ai', 'all')).toHaveLength(2);
  });
  it('keeps only the user\'s clients in "mine" mode', () => {
    const mine = filterOwned(rows, 'jenna@alpharoc.ai', 'mine');
    expect(mine).toHaveLength(1);
    expect(mine[0].client.id).toBe(1);
  });
});

describe('computeKpis', () => {
  it('counts statuses, near renewals, and sums current-year dollar value', () => {
    const health: BalanceHealthRow[] = [
      healthRow(1, null, 'negative'),
      healthRow(2, null, 'low'),
      healthRow(3, null, 'low'),
      healthRow(4, null, 'ok'),
    ];
    const renewals: RenewalRow[] = [
      { client: client(1, null), contractId: 1, contractName: 'x', renewalOn: new Date(), daysUntil: 10, creditsAmount: 0, dollarsAmount: 0, remainingCredits: 0, remainingDollars: 0, overDrawn: false, bucket: '30' },
      { client: client(2, null), contractId: 2, contractName: 'y', renewalOn: new Date(), daysUntil: 45, creditsAmount: 0, dollarsAmount: 0, remainingCredits: 0, remainingDollars: 0, overDrawn: false, bucket: '60' },
    ];
    const balances: BalanceRow[] = [
      { client: client(1, null), credits: 0, dollars: 0, cyCredits: 0, cyValue: 1000, cyRenewal: null },
      { client: client(2, null), credits: 0, dollars: 0, cyCredits: 0, cyValue: 240, cyRenewal: null },
    ];
    expect(computeKpis(health, renewals, balances)).toEqual({
      negative: 1,
      low: 2,
      renewals30: 1,
      cyCredits: 0,
      cyValue: 1240,
    });
  });
});
