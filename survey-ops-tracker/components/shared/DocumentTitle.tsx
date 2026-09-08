'use client'

import { useEffect } from 'react'

/** The app's own name, and what the tab reads when nothing specific is open. */
export const APP_TITLE = 'Survey Ops Command Center'

/**
 * Puts the open survey's name in the browser tab.
 *
 * David, 2026-09-08: "can you make it so that the tab name in a browser is the
 * app logo followed by the survey name thats open?" A tab shows the FAVICON and
 * then the title, and app/favicon.ico is already the AlphaROC mark — so the logo
 * half is done, and this supplies the second half.
 *
 * A component with an effect rather than Next's `generateMetadata`, because the
 * project page is a client component (it reads useParams and holds editing
 * state), and generateMetadata only exists on the server. The alternative was
 * converting that whole page to a server shell, which is a large change to get a
 * tab caption.
 *
 * Restores the app name on unmount, so navigating from a project back to the
 * board does not leave a stale study name in the tab.
 *
 * Deliberately renders nothing and takes `null` happily: the project page mounts
 * this while the project is still loading, and a tab that briefly says the app
 * name is better than one that says "undefined".
 */
export function DocumentTitle({ title }: { title: string | null | undefined }) {
  useEffect(() => {
    // Guard for the SSR pass and for any environment without a document
    // (thumbnail capture, tests).
    if (typeof document === 'undefined') return
    const clean = (title ?? '').trim()
    document.title = clean === '' ? APP_TITLE : clean
    return () => {
      if (typeof document !== 'undefined') document.title = APP_TITLE
    }
  }, [title])

  return null
}
