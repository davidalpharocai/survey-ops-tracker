import 'server-only'
import { Resend } from 'resend'
import nodemailer, { type Transporter } from 'nodemailer'
import { createAdminClient } from '@/lib/supabase/admin'

export type SendArgs = {
  to: string
  subject: string
  html: string
  template: string
  submissionId: string | null
}

// Lazy module-level singleton: only built the first time it's needed, and
// only when SMTP is actually configured (never at import/build time).
let smtpTransport: Transporter | null | undefined

function getSmtpTransport(): Transporter | null {
  if (smtpTransport !== undefined) return smtpTransport
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    smtpTransport = null
    return smtpTransport
  }
  smtpTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
  return smtpTransport
}

// Sends one email and logs it. Returns false on failure — callers proceed
// regardless (a failed notification must never block a submission/decision).
// SMTP (nodemailer) is preferred when SMTP_HOST + SMTP_USER + SMTP_PASS are
// all configured; otherwise falls back to Resend; if neither is configured
// this just logs a failed attempt and returns false.
export async function sendAndLog(args: SendArgs): Promise<boolean> {
  let admin: ReturnType<typeof createAdminClient> | null = null
  try {
    admin = createAdminClient()
  } catch {
    // If admin client cannot be created, we still must not throw.
    return false
  }

  const transport = getSmtpTransport()

  if (transport) {
    try {
      const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!
      await transport.sendMail({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      })
      try {
        await admin.from('notification_log').insert({
          submission_id: args.submissionId,
          recipient_email: args.to,
          template: args.template,
        })
      } catch {
        // Log insert failure is non-fatal — swallow silently.
      }
      return true
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
        template: error ? `${args.template}:failed` : args.template,
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
