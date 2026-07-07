import { describe, it, expect } from 'vitest'
import { replySubject, renderReplyHtml, type ReplySummary } from './reply'

const filedSummary: ReplySummary = {
  queueUrl: 'https://app.example.com/deliverables',
  items: [{ name: '2026.06.15 — Topline.pdf', status: 'filed', clientName: 'Coatue', projectLabel: 'B2B Tracker (PR00003)', driveUrl: 'https://drive.google.com/file/d/xyz/view' }],
}
const reviewSummary: ReplySummary = {
  queueUrl: 'https://app.example.com/deliverables',
  items: [{ name: 'mystery.pdf', status: 'review' }],
}

describe('replySubject', () => {
  it('says Filed when everything filed', () => {
    expect(replySubject('Final topline', filedSummary)).toBe('Filed ✓ — Final topline')
  })
  it('says Needs review when any item is queued', () => {
    expect(replySubject('Final topline', reviewSummary)).toBe('Needs a quick review — Final topline')
  })
  it('tolerates a missing original subject', () => {
    expect(replySubject(undefined, filedSummary)).toBe('Filed ✓')
  })
  it('says Already filed when every item is a duplicate', () => {
    const dupSummary: ReplySummary = { queueUrl: 'https://app.example.com/deliverables', items: [{ name: 'x.pdf', status: 'duplicate' }] }
    expect(replySubject('Final topline', dupSummary)).toBe('Already filed — Final topline')
  })
})

describe('renderReplyHtml', () => {
  it('shows the client, project, and a Drive link for filed items', () => {
    const html = renderReplyHtml(filedSummary)
    expect(html).toContain('Coatue')
    expect(html).toContain('B2B Tracker (PR00003)')
    expect(html).toContain('https://drive.google.com/file/d/xyz/view')
    expect(html).toContain('2026.06.15 — Topline.pdf')
  })
  it('links to the review queue for queued items', () => {
    const html = renderReplyHtml(reviewSummary)
    expect(html).toContain('https://app.example.com/deliverables')
    expect(html.toLowerCase()).toContain('review')
  })
  it('shows the client name and queue link for an unsorted (no-project) item', () => {
    const html = renderReplyHtml({
      queueUrl: 'https://app.example.com/deliverables',
      items: [{ name: 'topline.pdf', status: 'unsorted', clientName: 'Coatue' }],
    })
    expect(html).toContain('Coatue')
    expect(html).toContain('_Unsorted')
    expect(html).toContain('https://app.example.com/deliverables')
  })
  it('marks a duplicate item as already filed', () => {
    const html = renderReplyHtml({
      queueUrl: 'https://app.example.com/deliverables',
      items: [{ name: 'dupe.pdf', status: 'duplicate' }],
    })
    expect(html.toLowerCase()).toContain('already filed')
  })
  it('surfaces the best guess in a needs-review line when the matcher had one', () => {
    const html = renderReplyHtml({
      queueUrl: 'https://app.example.com/deliverables',
      items: [{ name: 'topline.pdf', status: 'review', clientName: 'Coatue', projectLabel: 'B2B Tracker (PR00003)' }],
    })
    expect(html).toContain('best guess')
    expect(html).toContain('Coatue → B2B Tracker (PR00003)')
  })
  it('says it could not auto-match when there is no guess', () => {
    const html = renderReplyHtml(reviewSummary)
    expect(html.toLowerCase()).toContain("couldn't auto-match")
  })
})
