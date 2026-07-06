import { corsJson, optionsResponse, baseUrl, MCP_RESOURCE } from '@/lib/oauth/http'
export const dynamic = 'force-dynamic'
export async function GET() {
  return corsJson({
    resource: MCP_RESOURCE(),
    authorization_servers: [baseUrl()],
    scopes_supported: ['read', 'reminders:write'],
    bearer_methods_supported: ['header'],
  })
}
export async function OPTIONS() { return optionsResponse() }
