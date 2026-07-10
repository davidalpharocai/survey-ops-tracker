import { describe, expect, it } from 'vitest';

import {
  DATA_COLUMN_IDS,
  moveColumn,
  normalizeColumnOrder,
  type DataColumnId,
} from '../ledgerColumns';

const DEFAULT = [...DATA_COLUMN_IDS];

describe('normalizeColumnOrder', () => {
  it('returns the default order for null / non-array input', () => {
    expect(normalizeColumnOrder(null)).toEqual(DEFAULT);
    expect(normalizeColumnOrder(undefined)).toEqual(DEFAULT);
    expect(normalizeColumnOrder('nope')).toEqual(DEFAULT);
    expect(normalizeColumnOrder({})).toEqual(DEFAULT);
  });

  it('honours a full valid ordering (e.g. reversed)', () => {
    const reversed = [...DEFAULT].reverse();
    expect(normalizeColumnOrder(reversed)).toEqual(reversed);
  });

  it('appends missing known ids in default order after the saved ones', () => {
    expect(normalizeColumnOrder(['remaining', 'credits'])).toEqual([
      'remaining',
      'credits',
      'forUser',
      'dollars',
      'renewal',
    ]);
  });

  it('drops unknown ids and de-duplicates, keeping first occurrence', () => {
    expect(
      normalizeColumnOrder(['bogus', 'credits', 'credits', 42, 'renewal']),
    ).toEqual(['credits', 'renewal', 'forUser', 'dollars', 'remaining']);
  });

  it('always returns each known id exactly once', () => {
    const result = normalizeColumnOrder(['dollars', 'dollars', 'x']);
    expect([...result].sort()).toEqual([...DEFAULT].sort());
    expect(result.length).toBe(DATA_COLUMN_IDS.length);
  });
});

describe('moveColumn', () => {
  it('moves a column to sit immediately before the target', () => {
    expect(moveColumn(DEFAULT as DataColumnId[], 'remaining', 'forUser')).toEqual([
      'remaining',
      'forUser',
      'credits',
      'dollars',
      'renewal',
    ]);
  });

  it('moves the first column later in the list', () => {
    expect(moveColumn(DEFAULT as DataColumnId[], 'forUser', 'renewal')).toEqual([
      'credits',
      'dollars',
      'forUser',
      'renewal',
      'remaining',
    ]);
  });

  it('returns an unchanged copy when from === to', () => {
    const order = DEFAULT as DataColumnId[];
    const result = moveColumn(order, 'credits', 'credits');
    expect(result).toEqual(order);
    expect(result).not.toBe(order);
  });

  it('never mutates the input array', () => {
    const order = [...DEFAULT] as DataColumnId[];
    const snapshot = [...order];
    moveColumn(order, 'remaining', 'credits');
    expect(order).toEqual(snapshot);
  });
});
