import { describe, it, expect } from 'vitest'
import { resolveAccess } from './resolvePermissions'
import {
  VIEW_FINANCIALS,
  MANAGE_PERMISSIONS,
  EXPORT_DATA,
  ROLE_FINANCE,
  ROLE_ADMIN,
  ROLE_SALES,
} from './capabilityNames'

// Permission bugs are silent: too permissive returns extra data, too strict
// returns none, and neither raises an error. So these tests assert the exact
// membership of both sets in every case rather than spot-checking one flag —
// including the cases that only happen in production for a few hours, between a
// deploy and David applying the SQL by hand.

const BUNDLES = [
  { role: ROLE_FINANCE, permission: VIEW_FINANCIALS },
  { role: ROLE_ADMIN, permission: MANAGE_PERMISSIONS },
]

describe('resolveAccess', () => {
  it('grants a permission that comes from a role', () => {
    const { capabilities, roles } = resolveAccess({
      direct: [],
      roles: [{ role: ROLE_FINANCE }],
      bundles: BUNDLES,
    })
    expect([...capabilities]).toEqual([VIEW_FINANCIALS])
    expect([...roles]).toEqual([ROLE_FINANCE])
  })

  it('grants a permission that was given directly, with no role at all', () => {
    // This is the 079 shape and must keep working forever: the three finance
    // holders were granted view_financials directly before roles existed.
    const { capabilities, roles } = resolveAccess({
      direct: [{ capability: VIEW_FINANCIALS }],
      roles: [],
      bundles: BUNDLES,
    })
    expect([...capabilities]).toEqual([VIEW_FINANCIALS])
    expect(roles.size).toBe(0)
  })

  it('unions the two mechanisms without duplicating the overlap', () => {
    // Migration 085 seeds the finance ROLE onto people who already hold the
    // direct grant, so this is the real state of David's account.
    const { capabilities } = resolveAccess({
      direct: [{ capability: VIEW_FINANCIALS }],
      roles: [{ role: ROLE_FINANCE }, { role: ROLE_ADMIN }],
      bundles: BUNDLES,
    })
    expect(capabilities.size).toBe(2)
    expect(capabilities.has(VIEW_FINANCIALS)).toBe(true)
    expect(capabilities.has(MANAGE_PERMISSIONS)).toBe(true)
  })

  it('IGNORES bundles for roles the person does not hold', () => {
    // The load-bearing assertion. role_permissions is fetched wholesale and
    // cached because it is reference data — if this filter were wrong, holding
    // any role at all would grant every permission in the catalogue.
    const { capabilities } = resolveAccess({
      direct: [],
      roles: [{ role: ROLE_SALES }],
      bundles: [...BUNDLES, { role: ROLE_SALES, permission: EXPORT_DATA }],
    })
    expect([...capabilities]).toEqual([EXPORT_DATA])
    expect(capabilities.has(VIEW_FINANCIALS)).toBe(false)
    expect(capabilities.has(MANAGE_PERMISSIONS)).toBe(false)
  })

  it('gives a role that bundles nothing exactly nothing', () => {
    // 'sales' deliberately bundles no permissions until the sales surface
    // exists. Holding it must not be an error, and must not grant anything.
    const { capabilities, roles } = resolveAccess({
      direct: [],
      roles: [{ role: ROLE_SALES }],
      bundles: BUNDLES,
    })
    expect(capabilities.size).toBe(0)
    expect([...roles]).toEqual([ROLE_SALES])
  })

  it('falls back to the direct grant when the role queries failed (pre-085)', () => {
    // Between the deploy and the migration, profile_roles and role_permissions
    // 404 and their .data is null. A finance holder must keep their access.
    const { capabilities, roles } = resolveAccess({
      direct: [{ capability: VIEW_FINANCIALS }],
      roles: null,
      bundles: null,
    })
    expect([...capabilities]).toEqual([VIEW_FINANCIALS])
    expect(roles.size).toBe(0)
  })

  it('grants nothing when every query failed', () => {
    // Fails closed. "Don't know" and "not allowed" must be the same answer.
    const { capabilities, roles } = resolveAccess({
      direct: null,
      roles: null,
      bundles: null,
    })
    expect(capabilities.size).toBe(0)
    expect(roles.size).toBe(0)
  })

  it('grants nothing when the catalogue is missing but roles are held', () => {
    // The inverse partial failure: we know the person holds finance, but not
    // what finance means. Granting on a guess would be the wrong direction.
    const { capabilities, roles } = resolveAccess({
      direct: [],
      roles: [{ role: ROLE_FINANCE }],
      bundles: null,
    })
    expect(capabilities.size).toBe(0)
    expect([...roles]).toEqual([ROLE_FINANCE])
  })

  it('grants nothing to someone with no roles and no grants', () => {
    // Every one of the fourteen internal accounts except three.
    const { capabilities } = resolveAccess({ direct: [], roles: [], bundles: BUNDLES })
    expect(capabilities.size).toBe(0)
  })

  it('skips malformed rows instead of adding empty permissions', () => {
    const { capabilities, roles } = resolveAccess({
      direct: [{ capability: '' }, { capability: VIEW_FINANCIALS }],
      roles: [{ role: '' }, { role: ROLE_ADMIN }],
      bundles: [{ role: ROLE_ADMIN, permission: '' }, ...BUNDLES],
    })
    expect(capabilities.has('' as never)).toBe(false)
    expect(roles.has('' as never)).toBe(false)
    expect(capabilities.has(VIEW_FINANCIALS)).toBe(true)
    expect(capabilities.has(MANAGE_PERMISSIONS)).toBe(true)
  })
})
