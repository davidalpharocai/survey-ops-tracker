import { describe, it, expect } from 'vitest'
import { submissionCreatedEmail, decisionEmail } from '@/lib/email/templates'

describe('submissionCreatedEmail', () => {
  it('includes project, counts, and review link', () => {
    const email = submissionCreatedEmail({
      projectName: 'Cloud Survey',
      version: 2,
      questionCount: 24,
      openTextCount: 7,
      reviewUrl: 'https://app.example.com/portal/review/abc',
    })
    expect(email.subject).toContain('Cloud Survey')
    expect(email.html).toContain('24')
    expect(email.html).toContain('7')
    expect(email.html).toContain('https://app.example.com/portal/review/abc')
    expect(email.html).toContain('Version 2')
  })
})

describe('decisionEmail', () => {
  it('approved variant has no note section when note is empty', () => {
    const email = decisionEmail({
      projectName: 'Cloud Survey', version: 1, decision: 'approved', note: null,
    })
    expect(email.subject).toMatch(/approved/i)
    expect(email.html).not.toContain('Reviewer note')
  })

  it('rejected variant includes the reviewer note', () => {
    const email = decisionEmail({
      projectName: 'Cloud Survey', version: 1, decision: 'rejected', note: 'Q5 must go',
    })
    expect(email.subject).toMatch(/rejected/i)
    expect(email.html).toContain('Q5 must go')
  })

  it('escapes HTML in user-supplied note', () => {
    const email = decisionEmail({
      projectName: 'X', version: 1, decision: 'rejected', note: '<script>alert(1)</script>',
    })
    expect(email.html).not.toContain('<script>')
  })
})
