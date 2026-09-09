import 'server-only'

/**
 * What each tier is allowed to reach, as data.
 *
 * THIS FILE EXISTS BECAUSE THREE LEAKS WERE FOUND BY HAND IN ONE WEEK, each by
 * someone remembering to run a probe script:
 *
 *   - 102: the sales tier read budget, actual_spend and n_internal_target off
 *     survey_projects — $124,375 of budget and 84 internal targets.
 *   - 105: the same class on clients, client_contacts and client_terms —
 *     compliance_notes, drive_folder_id, the Occam onboarding flags.
 *   - 107: migration 030 had never been applied, so an EXTERNAL compliance
 *     reviewer at a client firm could read every client's email bodies and the
 *     whole audit history.
 *
 * Each was closed the same way and each could have been caught the same way.
 * The probe is now a fixture rather than a script: scripts/check-tier-surface.mjs
 * asserts this table against production with real user JWTs, and CI runs it.
 *
 * ADDING A TABLE OR A VIEW MEANS ADDING IT HERE. That is the point — the check
 * fails on anything reachable that this file does not mention, so a new table
 * with a permissive policy cannot slip past by being unknown to the test.
 */

export type Tier = 'sales' | 'compliance'

export interface TierSurface {
  /** Relations the tier MAY read, and why. */
  allowed: { name: string; why: string }[]
  /** Relations the tier must reach ZERO rows of. */
  denied: string[]
  /** Columns that must not exist on a relation the tier can read. Keyed by
   *  relation; the check asks PostgREST for each and expects 42703. */
  absentColumns: Record<string, string[]>
}

export const TIER_SURFACE: Record<Tier, TierSurface> = {
  sales: {
    allowed: [
      { name: 'sales_projects', why: 'the pipeline — 33 of survey_projects’ 81 columns (102)' },
      { name: 'sales_clients', why: 'their accounts, without the compliance group (105)' },
      { name: 'sales_contacts', why: 'their contacts, without the Occam flags (105)' },
      { name: 'sales_terms', why: 'credit allowances, never dollars (105)' },
      { name: 'profiles', why: 'their own row, to resolve who they are' },
      { name: 'salespeople', why: 'the name-to-email map RLS itself keys on (093)' },
    ],
    denied: [
      // The base tables behind the views. Every one of these returned rows to
      // Alex at some point this week.
      'survey_projects', 'clients', 'client_contacts', 'client_terms',
      'project_activity', 'project_audit', 'project_steps', 'project_bids',
      'project_data_changes', 'project_seen',
      // Money and internals that no view should ever expose to this tier.
      'project_financials', 'client_term_financials', 'project_costs',
      'project_blasts', 'project_suppliers', 'project_launches',
      'project_segments', 'deliverables', 'email_inbox', 'reminders',
      'team_members', 'question_submissions',
    ],
    absentColumns: {
      sales_projects: ['budget', 'actual_spend', 'n_internal_target', 'latest_next_steps',
                       'audience_size', 'audience_used', 'blocked_by', 'priority',
                       'cancel_reason', 'captain_id', 'n_floor_override'],
      sales_clients: ['compliance_notes', 'compliance_contact', 'drive_folder_id',
                      'compliance_before_fielding', 'compliance_after_fielding'],
      sales_contacts: ['occam_invited', 'occam_invited_at', 'occam_invited_by', 'created_by', 'archived'],
      sales_terms: ['note', 'source', 'dollars_total'],
    },
  },

  compliance: {
    allowed: [
      { name: 'portal_projects', why: 'the safe project projection built by 008' },
      { name: 'question_submissions', why: 'the reviews they are here to do' },
      { name: 'questions', why: 'the questionnaire content under review' },
      { name: 'profiles', why: 'their own row' },
      // Their OWN client row and nothing else — 008 scopes this with
      // my_client_id(), verified: Holocene's reviewer sees 1 of 94. The portal
      // needs it to name the firm it is showing.
      { name: 'clients', why: 'their own client record only (008)' },
    ],
    denied: [
      // An EXTERNAL party. This list is the tightest of the two on purpose.
      'survey_projects', 'client_contacts', 'client_terms',
      'project_activity', 'project_audit', 'project_steps', 'project_bids',
      'project_data_changes', 'project_seen', 'project_financials',
      'client_term_financials', 'project_costs', 'project_blasts',
      'project_suppliers', 'project_launches', 'project_segments',
      'deliverables', 'email_inbox', 'reminders', 'team_members', 'salespeople',
      'sales_projects', 'sales_clients', 'sales_contacts', 'sales_terms',
    ],
    absentColumns: {},
  },
}
