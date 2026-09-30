/**
 * The finance glossary: the ten terms the page uses, one sentence each.
 *
 * These are the only jargon the finance page is allowed (finance spec, "Glossary
 * drawer"). They are data, not markup, so the drawer, the user guide's finance
 * section and any future tooltip read the same words — a definition that
 * drifts between two places is two definitions.
 *
 * One sentence each, for a busy reader. "QA" is spelled out the first time it
 * appears because it is itself a term.
 */

export interface GlossaryTerm {
  /** Stable id, for an anchor (#term-billed-n) and for tests. */
  id: string
  term: string
  text: string
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: 'client-price',
    term: 'Client price',
    text: 'The client’s price per respondent times the respondents we delivered, never more than the N they bought — what the contract implies, not cash received, because there is no invoice record yet.',
  },
  {
    id: 'our-cost',
    term: 'Our cost',
    text: 'The field cost we recorded: blast rewards (bid × completes), text-message sends (cost per send × people; email is free), panel purchases (price per complete × completes) and vendor lines, minus rewards that went unclaimed and came back.',
  },
  {
    id: 'we-keep',
    term: 'We keep',
    text: 'What is left after field cost, before salaries and overhead: client price minus our cost.',
  },
  {
    id: 'budget',
    term: 'Budget',
    text: 'The most we planned to spend on a study — a cost ceiling with a starting goal of about half the price, and never revenue.',
  },
  {
    id: 'complete',
    term: 'Complete',
    text: 'A respondent we paid for, counted before the quality checks (QA).',
  },
  {
    id: 'qualified-respondent',
    term: 'Qualified respondent',
    text: 'A respondent the client received, after QA.',
  },
  {
    id: 'scrub',
    term: 'Scrub',
    text: 'Completes that QA removed: we paid for them, and the client never received them.',
  },
  {
    id: 'cpqr',
    term: 'CPQR',
    text: 'Cost per qualified respondent: our cost divided by the respondents the client received.',
  },
  {
    id: 'billed-n',
    term: 'Billed N',
    text: 'The respondents we can bill: the N delivered after QA, never more than the N sold (the top of the range, when a range was sold).',
  },
  {
    id: 'route',
    term: 'Route',
    text: 'How a study was actually fielded, read from its cost records rather than how it was filed: blast (B2B email or text), panel (PureSpectrum), or both.',
  },
]
