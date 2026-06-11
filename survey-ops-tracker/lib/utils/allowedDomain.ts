// Only company accounts may use the app
export const ALLOWED_EMAIL_DOMAIN = 'alpharoc.ai'

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)
}
