import 'server-only'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

export type SendArgs = {
  to: string
  subject: string
  html: string
  template: string
  submissionId: string | null
}

// Sends one email and logs it. Returns false on failure — callers proceed
// regardless (a failed notification must never block a submission/decision).
export async function sendAndLog(args: SendArgs): Promise<boolean> {
  let admin: ReturnType<typeof createAdminClient> | null = null
  try {
    admin = createAdminClient()
  } catch {
    // If admin client cannot be created, we still must not throw.
    return false
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: args.to,
      subject: args.subject,
      html: args.html,
    })
    try {
      await admin.from('notification_log').insert({
        submission_id: args.submissionId,
        recipient_email: args.to,
        template: args.template,
        resend_id: error ? null : data?.id ?? null,
      })
    } catch {
      // Log insert failure is non-fatal — swallow silently.
    }
    return !error
  } catch {
    try {
      await admin.from('notification_log').insert({
        submission_id: args.submissionId,
        recipient_email: args.to,
        template: `${args.template}:failed`,
      })
    } catch {
      // Log insert failure is non-fatal — swallow silently.
    }
    return false
  }
}
