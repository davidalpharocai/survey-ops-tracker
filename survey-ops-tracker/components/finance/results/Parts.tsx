'use client'

/**
 * A computed sentence, rendered.
 *
 * lib/finance/results.ts writes every sentence on the Results tab as a list of
 * parts — plain text, a survey code, an action — so the same words can be a
 * page (here: codes are real links, figures open their drill) and plain text
 * (the connector joins the parts). Nothing in this file composes words.
 */

import Link from 'next/link'
import { ProjectLink } from '../tabs/Card'
import type { Part, ResultsAction } from '@/lib/finance/results'

const ACTION_TITLE: Record<ResultsAction, string> = {
  waterfall: 'Show where this spend went, line by line',
  unpriced: 'Show the surveys with spend and no client price',
  improve: 'Open the Improve tab, which ranks the missing prices',
  cancelled: 'Show the cancelled surveys and what they spent',
  archived: 'Show the surveys archived without delivery and what they spent',
}

export function Parts({ parts, onAction, improveHref, expanded }: {
  parts: Part[]
  onAction: (a: ResultsAction) => void
  /** The Improve tab, as a real href (props.hrefFor({ tab: 'improve' })). */
  improveHref: string
  /** Actions that toggle something open in place (the waterfall), and whether
   *  it is open — read out as aria-expanded. */
  expanded?: Partial<Record<ResultsAction, boolean>>
}) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') return <span key={i}>{p.text}</span>
        if (p.kind === 'survey') return <ProjectLink key={i} id={p.id} code={p.text} />
        if (p.action === 'improve') {
          return (
            <Link key={i} href={improveHref} title={ACTION_TITLE.improve}
              className="font-medium text-primary underline underline-offset-2">
              {p.text}
            </Link>
          )
        }
        const open = expanded?.[p.action]
        return (
          <button
            key={i}
            type="button"
            onClick={() => onAction(p.action)}
            title={ACTION_TITLE[p.action]}
            aria-expanded={open === undefined ? undefined : open}
            className="rounded font-medium tabular-nums text-foreground underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-price)]"
          >
            {p.text}
          </button>
        )
      })}
    </>
  )
}
