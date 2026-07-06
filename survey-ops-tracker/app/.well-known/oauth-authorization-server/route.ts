import { corsJson, optionsResponse, baseUrl } from '@/lib/oauth/http'
export const dynamic = 'force-dynamic'
export async function GET() {
  return corsJson({
    issuer: baseUrl(),
    authorization_endpoint: `${baseUrl()}/oauth/authorize`,
    token_endpoint: `${baseUrl()}/api/oauth/token`,
    registration_endpoint: `${baseUrl()}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'reminders:write'],
  })
}
export async function OPTIONS() { return optionsResponse() }
