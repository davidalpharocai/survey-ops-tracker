export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
}
export function corsJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } })
}
export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://survey-ops-tracker.vercel.app'
}
export const MCP_RESOURCE = () => `${baseUrl()}/api/mcp`
