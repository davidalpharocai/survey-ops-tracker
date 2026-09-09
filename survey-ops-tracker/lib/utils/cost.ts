/**
 * The money arithmetic for a flat cost line (project_costs, migration 080).
 *
 * Pure and server-safe on purpose. `lib/hooks/useProjectCosts.ts` already owns
 * the kind labels and the Σ subtotal, but it is a client hook — it pulls in
 * react-query and the browser Supabase client — so the connector's write path
 * (lib/mcp/registry.ts) cannot borrow from it. This module is the shared half:
 * no imports, no I/O, one definition of one number.
 *
 * WHY THIS IS A FILE AND NOT THREE LINES IN THE HANDLER. Every money bug this
 * codebase has shipped was arithmetic that lived where nothing could test it:
 * a $0.02 rate silently stored as 0 by a rounding helper, and a per-send cost
 * counted twice because two places each believed they owned the total. A cost
 * line's amount is the number that lands in actual_spend, so it gets a pure
 * function and a test file.
 */

/** A cost line's dollars can be stated two ways, and they are mutually exclusive. */
export type CostMoneyInput = {
  /** A flat invoice: the amount exactly as billed. */
  amount?: number | null
  /** Per-unit price, e.g. $0.07 a contact. Needs `quantity`. */
  unitCost?: number | null
  /** How many units `unitCost` covers, e.g. 22,121 contacts. */
  quantity?: number | null
}

export type CostMoney =
  | { ok: true; amount: number; quantity: number | null; fromUnitPair: boolean }
  | { ok: false; reason: 'no-money' | 'disagree'; message: string }

/** Dollars, rounded to the cent, away from float dust.
 *
 *  0.07 × 22121 is 1548.4700000000003 in IEEE 754, and `numeric` would keep the
 *  dust. Scaling by 100 before rounding is the fix; `Number.EPSILON` nudges the
 *  half-cent cases that land a hair below .5 (0.145 → 14.499999999999998 → 14.5)
 *  so they round the way a person reading the invoice expects. */
export function toCents(dollars: number): number {
  return Math.round((dollars + Number.EPSILON) * 100) / 100
}

/**
 * Resolve a cost line's amount from whichever form the caller gave.
 *
 * A caller may pass a flat `amount`, or the `unitCost` + `quantity` pair — and
 * the pair is multiplied HERE, once. The SQL (mcp_log_cost, migration 101)
 * deliberately stores `amount` verbatim and never multiplies, so there is one
 * definition of the number rather than two that can drift.
 *
 * Passing both is an ERROR rather than a preference, when they disagree: the
 * caller believes something we would otherwise be silently overruling. They are
 * allowed to agree, because a caller that computes the product itself and sends
 * both is not wrong, just redundant.
 */
export function resolveCostMoney(input: CostMoneyInput): CostMoney {
  const hasUnit = input.unitCost != null && input.quantity != null
  const hasAmount = input.amount != null

  if (!hasUnit && !hasAmount) {
    return {
      ok: false,
      reason: 'no-money',
      message: 'Give either `amount` for a flat invoice, or both `unit_cost` and `quantity` for a per-unit cost.',
    }
  }

  // A lone unit_cost with no quantity, or a lone quantity with no unit price, is
  // not a per-unit cost — it is half of one. Fall through to `amount` if given,
  // and complain if that is missing too (handled by the branch above).
  if (!hasUnit) {
    return { ok: true, amount: toCents(input.amount as number), quantity: input.quantity ?? null, fromUnitPair: false }
  }

  const computed = toCents((input.unitCost as number) * (input.quantity as number))

  if (hasAmount && Math.abs(computed - (input.amount as number)) > 0.005) {
    return {
      ok: false,
      reason: 'disagree',
      message:
        `unit_cost × quantity is $${computed.toFixed(2)} but amount says ` +
        `$${(input.amount as number).toFixed(2)}. Pass one or the other, or make them agree.`,
    }
  }

  return { ok: true, amount: computed, quantity: input.quantity as number, fromUnitPair: true }
}

/**
 * An idempotency key, or null if the caller effectively gave none.
 *
 * WHY THIS IS A FUNCTION. The two ends of add_cost disagreed: the existence
 * probe was guarded by `args.idem_key ? …`, which is false for "", while the
 * write passed `args.idem_key ?? null`, which is "". So an empty string skipped
 * the lookup and was then stored as a REAL key — and migration 101's partial
 * unique index only covers `idem_key is not null`, so "" is a live key that the
 * index enforces. The second such call silently upserted over the first cost
 * line while the tool previewed "Add" and reported "created".
 *
 * Normalising in one place is what makes both ends agree. Whitespace-only is
 * treated the same as empty: it is not a key anybody meant to send, and letting
 * " " through would make two visually identical calls collide.
 */
export function normalizeIdemKey(key: string | null | undefined): string | null {
  return key?.trim() || null
}

/**
 * What a project's spend becomes if this cost line is written.
 *
 * `prior` is what the line contributed BEFORE the write — 0 for a new line, the
 * stored amount when an idem_key or a cost_ref matched an existing one, and 0
 * again when a key was supplied but matched nothing. Getting that wrong is how
 * an update reads as an addition.
 *
 * `current` is tolerated as null because actual_spend is nullable: a project
 * nobody has spent on yet has no recorded figure, and treating that as 0 here is
 * right — this is the projection of a sum, not a report of one, so there is no
 * "not recorded" to preserve.
 */
export function projectSpendAfter(
  current: number | null | undefined,
  prior: number | null | undefined,
  next: number
): number {
  return toCents((current ?? 0) - (prior ?? 0) + next)
}
