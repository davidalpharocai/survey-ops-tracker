// Capability NAMES only — no imports, no DB, no 'server-only'.
//
// This file exists because lib/auth/capabilities.ts is `server-only`: importing
// it from a client component throws at bundle time. The browser hook
// (lib/hooks/useCapabilities.ts) and the server reader both need the same
// string, and a string duplicated in two places is a gate that can silently
// drift, so the name lives here on its own and both sides import it.

/** The only capability so far: may see prices, margins and other money that is
 *  not the cost ceiling. Free text in the DB, so adding one here is enough. */
export const VIEW_FINANCIALS = 'view_financials'
export type Capability = typeof VIEW_FINANCIALS
