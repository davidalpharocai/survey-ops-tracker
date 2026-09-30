'use client'

import type { ReactNode } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import type { PreSendCheck } from '@/lib/sales/statement'
import { ALWAYS_PRINTED, CHOICE_SOURCE_TEXT, type ChoiceNote } from '@/lib/sales/printColumns'
import type { PrintChoiceControls } from './usePrintChoice'

/**
 * The screen-only checklist above the paper: what to settle before this goes
 * to a client, and what prints. Never printed (`no-print`, `data-print="hide"`).
 *
 * The print dialog opens by itself only when the list is empty. With anything
 * on it, the salesperson reads first and presses Print themselves — a
 * statement that says "at least 410" because two surveys were never priced is
 * better fixed than sent.
 *
 * WHAT PRINTS: a checkbox per column and per section, each unticked one gone
 * from the page below at once, so the preview IS the print. "Save as my
 * default" makes the current choice this person's starting point for this
 * document next time; "Reset to system default" puts every tick back where it
 * started (which is not "everything on": Ref. and the final estimate are opt-in)
 * and forgets the saved one. Notes about the choice itself (Final without Target)
 * sit under the checklist and never count as an item to check: they do not
 * stop the dialog opening, because the choice is the salesperson's to make.
 *
 * App UI, so it uses the app's tokens rather than the document's paper inks.
 */
export function PreSendPanel({ heading, modeLine, checks, name, onPrint, choice, choiceNotes = [] }: {
  heading: ReactNode
  /** The list's line saying whether it prints as a client or an internal document. */
  modeLine?: ReactNode
  checks: PreSendCheck[]
  /** The "Name as printed" field, in client mode. */
  name?: { value: string; onChange: (v: string) => void; internalName: string; saved: string | null }
  onPrint: () => void
  /** The "What prints" controls. */
  choice?: PrintChoiceControls
  /** Advice about the choice. Shown, never counted as an item to check. */
  choiceNotes?: ChoiceNote[]
}) {
  return (
    <aside
      className="no-print mx-auto mb-5 w-[210mm] max-w-full rounded-lg border border-border border-l-4 border-l-primary bg-card px-4 py-3 text-sm text-foreground shadow-sm"
      data-print="hide"
      aria-label="Before you send"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center text-sm font-semibold">
          {heading}
          <InfoTooltip text="A check of this account's records before the document goes to a client. Each item is something the printed page would state in a way you may want to fix first. Nothing in this box prints." />
        </h2>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Not printed</span>
      </div>

      {modeLine && <p className="mt-2 text-[13px] text-muted-foreground">{modeLine}</p>}

      {name && (
        <div className="mt-2.5 grid gap-2 rounded-md bg-muted/60 px-3 py-2 sm:grid-cols-[1fr_minmax(180px,260px)] sm:items-center">
          <label htmlFor="nameAsPrinted" className="flex items-start text-[12.5px] text-muted-foreground">
            <span>
              <b className="text-foreground">Name as printed.</b>{' '}
              {name.saved
                ? <>Saved on the client page as &ldquo;{name.saved}&rdquo;. Change it here for this print only; this box does not save it.</>
                : <>The account has only its internal label, &ldquo;{name.internalName}&rdquo;. Type the client&rsquo;s own name for this print; this box does not save it.</>}
            </span>
            <InfoTooltip text="The name printed after “Prepared for” and in the footer of every page. It fills in from the client page’s “Name as printed on client documents” when an analyst has set one, otherwise from the account’s internal name." />
          </label>
          <input
            id="nameAsPrinted"
            type="text"
            value={name.value}
            onChange={e => name.onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      {choice && <WhatPrints c={choice} />}

      {checks.length > 0 ? (
        <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-[13px] leading-snug">
          {checks.map(c => (
            <li key={c.id}>{c.lead && <b>{c.lead}</b>}{c.lead ? ' ' : ''}{c.text}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-2.5 text-[13px] text-muted-foreground">Nothing to settle before sending.</p>
      )}

      {choiceNotes.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] leading-snug" aria-label="Notes about what prints">
          {choiceNotes.map(n => (
            <li key={n.id} className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
              <b>Note, does not stop printing:</b> {n.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <button
          type="button"
          onClick={onPrint}
          className="rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Print / Save as PDF
        </button>
        <span className="text-xs text-muted-foreground">
          {checks.length > 0
            ? `The print dialog did not open by itself because ${checks.length} ${checks.length === 1 ? 'item needs' : 'items need'} checking. `
            : ''}
          Portrait is set; pick Letter or A4. The page prints its own footer and page numbers, so &ldquo;Headers and
          footers&rdquo; can stay on or off. Use Chrome or Edge: Safari and Firefox leave the footer out.
        </span>
      </div>
    </aside>
  )
}

const FEEDBACK: Record<Exclude<PrintChoiceControls['feedback'], 'none'>, string> = {
  saved: 'Saved. This document will start from this choice next time.',
  'save-failed': 'This browser would not save it (a private window, or site data is blocked). This print still uses your choice.',
  // ── CORRECTED 2026-09-29 ────────────────────────────────────────────────
  // These three said "everything prints again". Reset goes to SYSTEM_DEFAULT,
  // and since Ref. and the final estimate became opt-in that is no longer
  // everything — reset turns those two OFF. The same day's change rewrote the
  // identical claim in CHOICE_SOURCE_TEXT.system and in the user guide and
  // missed these, which is the one place a person is told what the button they
  // just pressed did.
  reset: 'Every tick is back where it started, and your saved default is cleared.',
  'reset-failed': 'Every tick is back where it started on this print, but this browser would not clear your saved default.',
}

/** The column and section checkboxes, and the default buttons. */
function WhatPrints({ c }: { c: PrintChoiceControls }) {
  const docWord = c.doc === 'statement' ? 'statement' : 'study list'
  const box = (key: string, label: string, help: string, on: boolean, toggle: () => void) => (
    <label key={key} className="inline-flex items-center text-[13px] text-foreground">
      <input
        type="checkbox"
        checked={on}
        onChange={toggle}
        className="mr-1.5 h-3.5 w-3.5 accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {label}
      <InfoTooltip text={help} />
    </label>
  )
  const button = 'rounded-md border border-border bg-background px-2.5 py-1 text-[12.5px] font-medium text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 disabled:hover:bg-background'
  return (
    <div role="group" aria-labelledby="whatPrintsTitle" className="mt-2.5 rounded-md bg-muted/60 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="whatPrintsTitle" className="flex items-center text-[12.5px] font-semibold text-foreground">
          What prints
          <InfoTooltip text={`Tick or untick anything on this ${docWord}; the page below changes at once. Most of it prints unless you, or your saved default, turn it off; a few — our PR numbers and the final estimate — print only once you tick them. The link in the address bar carries your choice, so opening it again reproduces this print.`} />
        </h3>
        <span className="text-[12px] font-medium text-muted-foreground" aria-live="polite">{CHOICE_SOURCE_TEXT[c.source]}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Columns
          <InfoTooltip text="The columns of the study table. Totals follow them: a column that does not print has no total either." />
        </span>
        <span className="inline-flex items-center text-[13px] text-muted-foreground">
          <input type="checkbox" checked disabled aria-label={`${ALWAYS_PRINTED.join(' and ')}, always printed`} className="mr-1.5 h-3.5 w-3.5" />
          {ALWAYS_PRINTED.join(', ')}
          <InfoTooltip text="Always printed. A row without the study name and audience matches nothing the client holds. Our own project number is the tick beside this one." />
        </span>
        {c.columns.map(({ def, on }) => box(def.id, def.label, def.help, on, () => c.toggleColumn(def.id)))}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sections
          <InfoTooltip text={`The parts of the ${docWord} around the table. The heading, the page footer and the sign-off always print.`} />
        </span>
        {c.sections.map(({ def, on }) => box(def.id, def.label, def.help[c.doc], on, () => c.toggleSection(def.id)))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" onClick={c.save} disabled={c.source === 'saved'} className={button}>
          Save as my default
        </button>
        <InfoTooltip text={`Makes the ticks above your starting point for every ${docWord} you open in this browser. A link that carries its own choice still prints that choice.`} />
        <button type="button" onClick={c.reset} disabled={c.source === 'system' && !c.hasSaved} className={button}>
          Reset to system default
        </button>
        <InfoTooltip text="Puts every tick back where it started — most columns and sections on, Ref. and Final estimate off — and forgets your saved default, so the next one starts the same way." />
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {c.feedback !== 'none'
            ? FEEDBACK[c.feedback]
            : `Saved in this browser only. Statements and study lists each keep their own.`}
        </span>
      </div>
    </div>
  )
}
