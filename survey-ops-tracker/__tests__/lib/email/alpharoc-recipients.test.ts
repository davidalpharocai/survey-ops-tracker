import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAlphaRocNotifyList } from '@/lib/email/alpharoc-recipients'

// Helper to build a chainable Supabase query stub returning `data`.
function makeChain(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data }),
    // for array results (no .maybeSingle() call)
    then: (resolve: (v: { data: unknown }) => void) => resolve({ data }),
  }
  return chain
}

// Build a mock admin client whose `from(table)` returns the right canned data.
function buildAdmin({
  explicitRecipients = [] as Array<{ email: string }>,
  submitterEmail = null as string | null,
  captainId = null as string | null,
  captainEmail = null as string | null,
}) {
  return {
    from(table: string) {
      if (table === 'project_recipients') {
        // Returns array, so needs a chain that resolves { data: [...] }
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: explicitRecipients }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: submitterEmail ? { email: submitterEmail } : null }),
            }),
          }),
        }
      }
      if (table === 'survey_projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: captainId ? { captain_id: captainId } : null }),
            }),
          }),
        }
      }
      if (table === 'team_members') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: captainEmail ? { email: captainEmail } : null }),
            }),
          }),
        }
      }
      // Fallback
      return makeChain(null)
    },
  }
}

describe('getAlphaRocNotifyList', () => {
  const savedOverride = process.env.ALPHAROC_NOTIFY_OVERRIDE

  beforeEach(() => {
    delete process.env.ALPHAROC_NOTIFY_OVERRIDE
  })

  afterEach(() => {
    if (savedOverride !== undefined) {
      process.env.ALPHAROC_NOTIFY_OVERRIDE = savedOverride
    } else {
      delete process.env.ALPHAROC_NOTIFY_OVERRIDE
    }
  })

  it('returns only override list when ALPHAROC_NOTIFY_OVERRIDE is set', async () => {
    process.env.ALPHAROC_NOTIFY_OVERRIDE = 'beta@example.com, staging@example.com'
    const admin = buildAdmin({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getAlphaRocNotifyList(admin as any, 'proj-1', 'user-1')
    expect(result).toEqual(['beta@example.com', 'staging@example.com'])
  })

  it('includes shanu + explicit + submitter + captain when no override', async () => {
    // Use same email for submitter and explicit recipient to prove dedupe
    const admin = buildAdmin({
      explicitRecipients: [{ email: 'duplicate@example.com' }],
      submitterEmail: 'duplicate@example.com', // same as explicit → should appear once
      captainId: 'captain-1',
      captainEmail: 'captain@alpharoc.ai',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getAlphaRocNotifyList(admin as any, 'proj-1', 'user-1')
    // shanu always present
    expect(result).toContain('shanu@alpharoc.ai')
    // duplicate@example.com appears exactly once
    expect(result.filter(e => e === 'duplicate@example.com')).toHaveLength(1)
    // captain included
    expect(result).toContain('captain@alpharoc.ai')
    // total: shanu + duplicate (deduped submitter+explicit) + captain = 3
    expect(result).toHaveLength(3)
  })

  it('captain same as submitter appears only once', async () => {
    const admin = buildAdmin({
      explicitRecipients: [],
      submitterEmail: 'shared@alpharoc.ai',
      captainId: 'cap-1',
      captainEmail: 'shared@alpharoc.ai', // same as submitter
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getAlphaRocNotifyList(admin as any, 'proj-1', 'user-1')
    expect(result).toContain('shanu@alpharoc.ai')
    expect(result.filter(e => e === 'shared@alpharoc.ai')).toHaveLength(1)
    expect(result).toHaveLength(2)
  })
})
