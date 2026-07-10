// Canonical explainer text for the (i) tooltips, kept in one place so the
// same concept reads identically everywhere it appears. Written for a
// salesperson entering data, not an engineer.

export const TIP = {
  // Client
  becameOn:
    'The date this organization became a paying client. Used as the start of their relationship and for “client since” on reports.',
  relationshipManager:
    'The AlphaROC person who owns this client relationship (e.g. the salesperson). Shown on the balances report.',
  primaryContact:
    'The main person to reach at the client. Optional, and separate from the “users” below who studies get attributed to.',

  // Client users
  clientUser:
    'A person on the client’s side. Every study is attributed to one of these users, so add the people who request work.',

  // Contract
  contract:
    'A contract ADDS available balance to a client — the credits and/or dollars they’ve purchased. Studies later draw this down.',
  contractDate:
    'The date this contract takes effect. Its balance counts toward the current-year contract value.',
  renewalDate:
    'When this contract is up for renewal. Defaults to one year after the contract date. Drives the renewal shown on reports.',
  creditsToAdd:
    'Credits this contract grants. Enter the number purchased; leave 0 if the contract is dollars-only.',
  dollarsToAdd:
    'Dollars this contract grants. Enter the amount purchased; leave 0 if the contract is credits-only.',

  // Study
  study:
    'A study CONSUMES a client’s balance — the research work delivered. It subtracts from the credits or dollars a contract added.',
  costType:
    'Whether this study is billed in credits or in dollars. It draws down that side of the client’s balance.',
  cadence:
    'How often the study runs. “Single” is one-time. Weekly/monthly/quarterly are recurring trackers billed per run.',
  studyCost:
    'For a single study, the total cost. For a recurring tracker, the cost of ONE run — the annual charge is this × runs per year (weekly 52, monthly 12, quarterly 4).',
  setupCost:
    'A one-time setup charge for recurring trackers, always in credits. Added once on top of the per-run costs. Leave 0 if none.',
  studyUser:
    'The client-side person this study is for. Pick from this client’s users; it attributes the spend to them.',
  studyContract:
    'Optionally roll this study up to one of the client’s contracts, so that contract shows its own remaining balance. Leave as “none” to keep the study Unassigned; it still draws down the client total either way.',

  // Balances / reports
  creditsRemaining:
    'Credits added by contracts minus credits consumed by studies. Negative means the client has overspent their credits.',
  dollarsRemaining:
    'Dollars added by contracts minus dollars consumed by studies. Negative means the client has overspent their dollars.',
  cyValue:
    'What this client contracted for this calendar year — shown in credits and/or dollars depending on how their contracts were priced.',
  cyRenewal:
    'The client’s next upcoming renewal date: the earliest renewal still in the future across all their contracts.',
  creditsDelta:
    'The change to the credit balance from this transaction: contracts add (+), studies subtract (−).',
  dollarsDelta:
    'The change to the dollar balance from this transaction: contracts add (+), studies subtract (−).',

  // Renewal radar
  daysUntilRenewal:
    'Whole days from today until this contract renews. 0 means the renewal is due today.',
  contractCredits:
    'The credits this contract added when it was signed — the size of the deal that is coming up for renewal.',
  contractDollars:
    'The dollars this contract added when it was signed — the size of the deal that is coming up for renewal.',

  // Balance health
  monthlyBurn:
    'Average credits consumed per month, measured over the trailing 90 days: all study spend in that window divided by 3. Zero means no recent activity.',
  runOutDate:
    'The projected date the balance hits zero if the client keeps spending at their trailing-90-day pace. Blank when there is no recent burn or no positive balance to deplete.',
  healthStatus:
    'NEGATIVE: a balance is already below zero. LOW: projected to run out within 60 days. OK: neither — balance covers 60+ days at the current pace.',
} as const;
