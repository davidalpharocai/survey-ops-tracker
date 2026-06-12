// Escape then preserve line breaks for multi-paragraph user messages
function escMultiline(s: string): string {
  return esc(s).replace(/\n/g, '<br/>')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Shared visual shell: light page background, white card, navy brand header,
// support footer. Inline styles only (email-client safe).
const wrap = (body: string) => `
<div style="background: #f3f4f6; padding: 32px 16px; font-family: Arial, Helvetica, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
    <div style="background: #0f172a; padding: 18px 32px;">
      <span style="font-size: 16px; font-weight: bold; color: #ffffff; letter-spacing: 0.5px;">AlphaRoc</span>
      <span style="font-size: 12px; color: #94a3b8; margin-left: 10px; letter-spacing: 1px; text-transform: uppercase;">Survey Compliance</span>
    </div>
    <div style="padding: 28px 32px; color: #1f2937;">
      ${body}
    </div>
    <div style="border-top: 1px solid #e5e7eb; padding: 16px 32px; background: #f9fafb;">
      <p style="font-size: 12px; color: #9ca3af; margin: 0; line-height: 1.6;">
        This is an automated notification from the AlphaRoc survey compliance system.<br/>
        Questions or access issues? Email
        <a href="mailto:info@alpharoc.ai?subject=Survey%20Compliance%20Link" style="color: #6b7280;">info@alpharoc.ai</a>
        with the subject &ldquo;Survey Compliance Link&rdquo;.
      </p>
    </div>
  </div>
</div>`

const detailRow = (label: string, value: string) => `
      <tr>
        <td style="padding: 6px 16px 6px 0; font-size: 13px; color: #6b7280; white-space: nowrap;">${label}</td>
        <td style="padding: 6px 0; font-size: 13px; color: #111827; font-weight: bold;">${value}</td>
      </tr>`

export function submissionCreatedEmail(args: {
  projectName: string
  version: number
  questionCount: number
  openTextCount: number
  reviewUrl: string
  message?: string | null
}): { subject: string; html: string } {
  const messageBlock = args.message
    ? `
      <div style="border-left: 3px solid #cbd5e1; background: #f8fafc; padding: 14px 18px; margin: 20px 0; border-radius: 0 8px 8px 0;">
        <p style="font-size: 12px; color: #64748b; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Message from AlphaRoc</p>
        <p style="font-size: 14px; color: #334155; margin: 0; line-height: 1.65;">${escMultiline(args.message)}</p>
      </div>`
    : ''
  return {
    subject: `${args.projectName} — survey questions awaiting your approval`,
    html: wrap(`
      <h2 style="font-size: 19px; color: #0f172a; margin: 0 0 6px;">${esc(args.projectName)}</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px; line-height: 1.65;">
        AlphaRoc has submitted a survey question list for your compliance review and approval.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin: 0 0 4px;">
        ${detailRow('Submission', `Version ${args.version}`)}
        ${detailRow('Questions', `${args.questionCount} total`)}
        ${detailRow('Open-text', `${args.openTextCount} question${args.openTextCount === 1 ? '' : 's'}`)}
      </table>
      ${messageBlock}
      <div style="text-align: center; margin: 28px 0 8px;">
        <a href="${esc(args.reviewUrl)}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 13px 36px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: bold;">Review &amp; respond</a>
      </div>
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0 0 16px;">
        This secure link signs you in automatically &mdash; no password needed.
      </p>
      <p style="font-size: 12px; color: #9ca3af; line-height: 1.6; word-break: break-all; margin: 0;">
        If the button doesn't work, copy this link into your browser:<br/>${esc(args.reviewUrl)}
      </p>
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
  const accent = args.decision === 'approved'
    ? { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' }
    : { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' }
  const noteBlock = args.note
    ? `
      <div style="border-left: 3px solid ${accent.border}; background: ${accent.bg}; padding: 14px 18px; margin: 20px 0; border-radius: 0 8px 8px 0;">
        <p style="font-size: 12px; color: #64748b; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Reviewer note</p>
        <p style="font-size: 14px; color: #334155; margin: 0; line-height: 1.65;">${escMultiline(args.note)}</p>
      </div>`
    : ''
  return {
    subject: `${args.projectName} — survey questions ${verb} by compliance`,
    html: wrap(`
      <h2 style="font-size: 19px; color: #0f172a; margin: 0 0 6px;">${esc(args.projectName)}</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 16px; line-height: 1.65;">
        Client compliance has reviewed <strong>Version ${args.version}</strong> of the question list.
      </p>
      <div style="display: inline-block; background: ${accent.bg}; border: 1px solid ${accent.border}; color: ${accent.color}; font-size: 14px; font-weight: bold; padding: 8px 18px; border-radius: 999px; text-transform: capitalize;">
        ${verb}
      </div>
      ${noteBlock}
      <p style="font-size: 14px; color: #475569; margin: 16px 0 0; line-height: 1.65;">
        ${args.decision === 'rejected'
          ? 'Revise the questions and submit a new version from the project page.'
          : 'The survey is cleared to launch.'}
      </p>
    `),
  }
}
