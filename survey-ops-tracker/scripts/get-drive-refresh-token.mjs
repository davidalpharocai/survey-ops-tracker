// scripts/get-drive-refresh-token.mjs
// One-time, NO ADMIN NEEDED: mint a Google Drive refresh token by signing in as yourself.
// Prereqs: a "Desktop app" OAuth client in your Google Cloud project, with its id + secret
// set in env as GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.
// Run:  node --env-file=.env.local scripts/get-drive-refresh-token.mjs
import { google } from 'googleapis'
import http from 'http'

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local first.')
  process.exit(1)
}

const PORT = 53682
const redirectUri = `http://localhost:${PORT}`
const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
const authUrl = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even if previously granted
  scope: ['https://www.googleapis.com/auth/drive'],
})

const server = http.createServer(async (req, res) => {
  try {
    const code = new URL(req.url, redirectUri).searchParams.get('code')
    if (!code) { res.end('Waiting for Google...'); return }
    res.end('Got it - you can close this tab and return to the terminal.')
    server.close()
    const { tokens } = await oauth.getToken(code)
    if (!tokens.refresh_token) {
      console.error('\nNo refresh token returned. Revoke prior access at https://myaccount.google.com/permissions, then re-run.')
      process.exit(1)
    }
    console.log('\n==== GOOGLE_OAUTH_REFRESH_TOKEN (copy into .env.local + Vercel) ====\n')
    console.log(tokens.refresh_token)
    console.log('\n===================================================================\n')
    process.exit(0)
  } catch (e) {
    console.error('Token exchange failed:', e?.message || e)
    process.exit(1)
  }
})

server.listen(PORT, () => {
  console.log('\n1) Open this URL, sign in as a Google account with Shared Drive access (e.g. david@alpharoc.ai), and approve:\n')
  console.log(authUrl)
  console.log(`\n2) After you approve, Google redirects to ${redirectUri} and the refresh token prints below.\n`)
})
