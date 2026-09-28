import type { ReactNode } from 'react'
import { n0 } from '@/lib/sales/statement'

export interface MetaRow {
  label: string
  value: ReactNode
  /** Set on the date line, which is the one a reader looks for first. */
  strong?: boolean
}

/** Where the navy wordmark lives. usePrintWhenReady waits for it to decode. */
export const LOGO_SRC = '/alpharoc-logo-navy.png'

/**
 * The letterhead: wordmark and document title, then who it is for and the
 * facts that frame every number below it — the date and time it was drawn,
 * the period, the contract in force, and who to call.
 *
 * INTERNAL MODE replaces "Prepared for" with the selection and puts a band
 * above everything saying the page is not for a client. A list that spans
 * accounts shows one client another client's work if it is sent, so the
 * warning sits where nobody can print the page without seeing it, and again in
 * the footer of every page.
 */
export function Masthead({ docTitle, preparedFor, internalAccounts, meta }: {
  docTitle: string
  /** The client-facing name. Ignored in internal mode. */
  preparedFor: string
  /** Set (to the account count) for an internal document. */
  internalAccounts: number | null
  meta: MetaRow[]
}) {
  const internal = internalAccounts != null
  return (
    <header className="st-mast">
      {internal && (
        <div className="st-internal">
          Internal · covers {n0(internalAccounts)} {internalAccounts === 1 ? 'account' : 'accounts'} · not for sending to a client
        </div>
      )}
      <div className="st-mast-top">
        {/* A plain <img>, deliberately not next/image: the PDF needs the
            original 868x268 PNG, unresized, and a real element the print
            sequence can call decode() on. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="st-logo" src={LOGO_SRC} alt="AlphaROC" width={868} height={268} />
        <div className="st-doctitle">{docTitle}</div>
      </div>
      <div className="st-mast-body">
        <div>
          {internal ? (
            <>
              <div className="st-label">Selection</div>
              <div className="st-client st-client-sm">
                {n0(internalAccounts)} {internalAccounts === 1 ? 'account' : 'accounts'}
              </div>
            </>
          ) : (
            <>
              <div className="st-label">Prepared for</div>
              <div className="st-client">{preparedFor}</div>
            </>
          )}
        </div>
        <dl className="st-meta">
          {meta.map(m => (
            <div key={m.label} style={{ display: 'contents' }}>
              <dt>{m.label}</dt>
              <dd className={m.strong ? 'st-strong' : undefined}>{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  )
}
