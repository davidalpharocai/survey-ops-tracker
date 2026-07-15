import { describe, it, expect } from 'vitest'
import { buildRerunNudge, type NudgeItem } from './nudgeDigest'

const overdue: NudgeItem[] = [
  { title: 'Holocene — Monthly PS', due: '2026-07-04', daysToDue: -11 },
  { title: 'BAM — Quarterly', due: '2026-07-14', daysToDue: -1 },
]
const prep: NudgeItem[] = [{ title: 'Coatue — Monthly', due: '2026-07-20', daysToDue: 5 }]

describe('buildRerunNudge', () => {
  it('summarizes both counts in the subject, overdue first', () => {
    const { subject } = buildRerunNudge('sree@alpharoc.ai', overdue, prep)
    expect(subject).toBe('Rerun nudge — 2 overdue, 1 due soon')
  })

  it('omits a section (and its count) when empty', () => {
    expect(buildRerunNudge('x@alpharoc.ai', overdue, []).subject).toBe('Rerun nudge — 2 overdue')
    expect(buildRerunNudge('x@alpharoc.ai', [], prep).subject).toBe('Rerun nudge — 1 due soon')
  })

  it('renders overdue items before prep items in the body', () => {
    const { html } = buildRerunNudge('x@alpharoc.ai', overdue, prep)
    expect(html.indexOf('overdue')).toBeLessThan(html.indexOf('coming up'))
    expect(html).toContain('11d overdue')
    expect(html).toContain('due in 5d')
    expect(html).toContain('/reruns')
  })

  it('names the backup owner when provided', () => {
    const withBackup = buildRerunNudge('x@alpharoc.ai', overdue, [], 'jenna@alpharoc.ai')
    expect(withBackup.html).toContain('Backup owner: jenna@alpharoc.ai')
    const without = buildRerunNudge('x@alpharoc.ai', overdue, [])
    expect(without.html).not.toContain('Backup owner')
  })

  it('escapes HTML in titles', () => {
    const { html } = buildRerunNudge('x@alpharoc.ai', [{ title: 'A & <b>B</b>', due: '2026-07-01', daysToDue: -2 }], [])
    expect(html).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;')
    expect(html).not.toContain('<b>B</b>')
  })

  it('labels a same-day due as "due today"', () => {
    const { html } = buildRerunNudge('x@alpharoc.ai', [], [{ title: 'Z', due: '2026-07-15', daysToDue: 0 }])
    expect(html).toContain('due today')
  })
})
