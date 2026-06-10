function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const wrap = (body: string) => `
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a2e;">
  <p style="font-size: 13px; color: #888; margin-bottom: 24px;">AlphaRoc Survey Compliance</p>
  ${body}
  <p style="font-size: 12px; color: #aaa; margin-top: 32px;">This is an automated notification from the AlphaRoc survey compliance system.</p>
</div>`

export function submissionCreatedEmail(args: {
  projectName: string
  version: number
  questionCount: number
  openTextCount: number
  reviewUrl: string
}): { subject: string; html: string } {
  return {
    subject: `Questions ready for compliance review — ${args.projectName}`,
    html: wrap(`
      <h2 style="font-size: 18px;">Question list submitted for your review</h2>
      <p>AlphaRoc has submitted <strong>Version ${args.version}</strong> of the question list for
      <strong>${esc(args.projectName)}</strong>.</p>
      <p>${args.questionCount} questions total, including ${args.openTextCount} open-text.</p>
      <p style="margin: 28px 0;">
        <a href="${esc(args.reviewUrl)}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Review questions</a>
      </p>
      <p style="font-size: 13px; color: #666;">Or copy this link: ${esc(args.reviewUrl)}</p>
    `),
  }
}

export function decisionEmail(args: {
  projectName: string
  version: number
  decision: 'approved' | 'rejected'
  note: string | null
}): { subject: string; html: string } {
  const verb = args.decision === 'approved' ? 'approved' : 'rejected'
  const noteBlock = args.note
    ? `<p style="background: #f4f4f5; padding: 12px 16px; border-radius: 8px;"><strong>Reviewer note:</strong><br/>${esc(args.note)}</p>`
    : ''
  return {
    subject: `Compliance ${verb}: ${args.projectName} (v${args.version})`,
    html: wrap(`
      <h2 style="font-size: 18px;">Question list ${verb}</h2>
      <p>Client compliance has <strong>${verb}</strong> Version ${args.version} of the question list for
      <strong>${esc(args.projectName)}</strong>.</p>
      ${noteBlock}
      ${args.decision === 'rejected' ? '<p>Revise the questions and submit a new version from the project page.</p>' : '<p>The survey is cleared to launch.</p>'}
    `),
  }
}
