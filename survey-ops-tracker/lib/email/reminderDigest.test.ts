import { describe, it, expect } from 'vitest'
import { groupByUser, buildDigest, type ReminderRow } from './reminderDigest'

const row = (over: Partial<ReminderRow>): ReminderRow => ({
  id: 'id-' + Math.random(),
  user_email: 'a@alpharoc.ai',
  text: 'Follow up',
  due_date: '2026-07-06',
  survey_projects: null,
  ...over,
})

describe('groupByUser', () => {
  it('groups reminders by user_email', () => {
    const rows = [
      row({ id: '1', user_email: 'a@alpharoc.ai' }),
      row({ id: '2', user_email: 'b@alpharoc.ai' }),
      row({ id: '3', user_email: 'a@alpharoc.ai' }),
    ]
    const groups = groupByUser(rows)
    expect(groups.size).toBe(2)
    expect(groups.get('a@alpharoc.ai')?.map(r => r.id)).toEqual(['1', '3'])
    expect(groups.get('b@alpharoc.ai')?.map(r => r.id)).toEqual(['2'])
  })

  it('orders each user list overdue-first (due_date ascending)', () => {
    const rows = [
      row({ id: 'later', user_email: 'a@alpharoc.ai', due_date: '2026-07-10' }),
      row({ id: 'overdue', user_email: 'a@alpharoc.ai', due_date: '2026-07-01' }),
      row({ id: 'today', user_email: 'a@alpharoc.ai', due_date: '2026-07-06' }),
    ]
    const groups = groupByUser(rows)
    expect(groups.get('a@alpharoc.ai')?.map(r => r.id)).toEqual(['overdue', 'today', 'later'])
  })
})

describe('buildDigest', () => {
  it('builds a subject with the count and one <li> per reminder', () => {
    const rows = [
      row({ id: '1', text: 'Send invoice', due_date: '2026-07-01' }),
      row({ id: '2', text: 'Call client', due_date: '2026-07-02' }),
    ]
    const digest = buildDigest('a@alpharoc.ai', rows)
    expect(digest.subject).toBe('Survey Ops reminders — 2 due')
    expect(digest.ids).toEqual(['1', '2'])
    expect(digest.html).toContain('Send invoice')
    expect(digest.html).toContain('Call client')
    expect((digest.html.match(/<li>/g) ?? []).length).toBe(2)
  })

  it('links the project when present and escapes reminder text', () => {
    const rows = [
      row({
        id: '1',
        text: 'Check <script> tags',
        survey_projects: { project_code: 'PR00042', project_name: 'Acme Q3' },
      }),
    ]
    const digest = buildDigest('a@alpharoc.ai', rows)
    expect(digest.html).toContain('PR00042 Acme Q3')
    expect(digest.html).not.toContain('<script>')
    expect(digest.html).toContain('&lt;script&gt;')
  })
})
