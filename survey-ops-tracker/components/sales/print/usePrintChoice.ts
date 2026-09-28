'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  choiceSource, clearSavedChoice, columnOn, offeredColumns, printsOf, readSavedChoice, resolveChoice, sameChoice,
  sectionOn, sectionsFor, SYSTEM_DEFAULT, toggleColumn, toggleSection, withChoiceInSearch, writeSavedChoice,
  type ChoiceSource, type PrintChoice, type PrintColumnDef, type PrintColumnId, type PrintDoc, type PrintSectionDef,
  type PrintSectionId, type Prints, type UrlChoice,
} from '@/lib/sales/printColumns'

/** What the pre-send panel needs to draw the "What prints" controls. */
export interface PrintChoiceControls {
  doc: PrintDoc
  columns: { def: PrintColumnDef; on: boolean }[]
  sections: { def: PrintSectionDef; on: boolean }[]
  toggleColumn: (id: PrintColumnId) => void
  toggleSection: (id: PrintSectionId) => void
  save: () => void
  reset: () => void
  source: ChoiceSource
  hasSaved: boolean
  /** The last save or reset, so the panel can say whether it worked. */
  feedback: 'none' | 'saved' | 'save-failed' | 'reset' | 'reset-failed'
}

/**
 * The document's column and section choice, live.
 *
 * Starts from the link, then this person's saved default for this document,
 * then everything (printColumns.resolveChoice). The saved default lives in
 * browser storage, which the server cannot see, so the first render uses the
 * link or the system default and the saved default is applied just after
 * mount — before the print sequence, which waits for fonts and the logo.
 *
 * THE URL follows a change, so a copied link reproduces what is on screen. It
 * is written only when the salesperson changes something: opening the page
 * with a saved default leaves the link as it came, because a saved default is
 * a personal starting point, not a fact about the document. history.replaceState
 * rather than router.replace: the page re-renders from state, so a trip to the
 * server (every read again) would buy nothing, and there is no history entry
 * per tick.
 */
export function usePrintChoice(doc: PrintDoc, fromUrl: UrlChoice, { internal = false }: { internal?: boolean } = {}): {
  prints: Prints
  controls: PrintChoiceControls
} {
  const [choice, setChoice] = useState<PrintChoice>(() => resolveChoice(fromUrl, null))
  const [saved, setSaved] = useState<PrintChoice | null>(null)
  const [touched, setTouched] = useState(false)
  const [feedback, setFeedback] = useState<PrintChoiceControls['feedback']>('none')

  // Read once, on mount. The link's parts win over it (resolveChoice); a part
  // the link does not carry comes from here.
  useEffect(() => {
    const s = readSavedChoice(doc)
    if (!s) return
    setSaved(s)
    setChoice(resolveChoice(fromUrl, s))
    // fromUrl is the server's parse of the link the page opened with; later
    // renders pass a new object for the same link, which must not re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  const change = useCallback((next: PrintChoice) => {
    setChoice(next)
    setTouched(true)
    setFeedback('none')
    try {
      const search = withChoiceInSearch(window.location.search, next, doc)
      window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
    } catch { /* the choice still applies to this print */ }
  }, [doc])

  const save = useCallback(() => {
    if (writeSavedChoice(doc, choice)) {
      setSaved(choice)
      setFeedback('saved')
    } else {
      setFeedback('save-failed')
    }
  }, [doc, choice])

  const reset = useCallback(() => {
    const cleared = clearSavedChoice(doc)
    if (cleared) setSaved(null)
    change(SYSTEM_DEFAULT)
    setFeedback(cleared ? 'reset' : 'reset-failed')
  }, [doc, change])

  const prints = useMemo(() => printsOf(choice, doc, { internal }), [choice, doc, internal])
  const controls: PrintChoiceControls = {
    doc,
    columns: offeredColumns(doc, { internal }).map(def => ({ def, on: columnOn(choice, def.id) })),
    sections: sectionsFor(doc).map(def => ({ def, on: sectionOn(choice, def.id) })),
    toggleColumn: id => change(toggleColumn(choice, id, doc)),
    toggleSection: id => change(toggleSection(choice, id, doc)),
    save,
    reset,
    source: choiceSource({ choice, saved, url: fromUrl, touched, doc }),
    hasSaved: saved != null,
    feedback: feedback === 'saved' && !(saved && sameChoice(choice, saved, doc)) ? 'none' : feedback,
  }
  return { prints, controls }
}
