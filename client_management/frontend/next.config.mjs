const basePath = '/ccm';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  basePath,
  // The Import Data admin page uploads whole workbooks through a server
  // action; the SOCC export runs ~1 MB, over the 1 MB default.
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  // Inline all env vars into the build. Amplify Hosting injects env vars
  // at build time only — the standalone SSR Lambda does NOT get runtime
  // process.env injection, so anything not baked here is empty at request
  // time. Rotating any of these requires a new Amplify build.
  // COGNITO_CLIENT_SECRET is server-only (used in the Node.js token-exchange
  // route handler, never sent to browsers) so baking it in is safe: it ends
  // up only in the server bundle, not in any client-side JS.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    COGNITO_DOMAIN: process.env.COGNITO_DOMAIN || '',
    COGNITO_ISSUER: process.env.COGNITO_ISSUER || '',
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID || '',
    COGNITO_CLIENT_CREDENTIAL: process.env.COGNITO_CLIENT_CREDENTIAL || '',
    COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET || '',
    COGNITO_ALLOWED_GROUP: process.env.COGNITO_ALLOWED_GROUP || '',
    COGNITO_ADMIN_GROUP: process.env.COGNITO_ADMIN_GROUP || '',
    APP_BASE_URL: process.env.APP_BASE_URL || '',
    ALLOWED_DOMAIN: process.env.ALLOWED_DOMAIN || '',
    CCM_ADMIN_EMAILS: process.env.CCM_ADMIN_EMAILS || '',
    // Server/edge-only (middleware gate + lib/api service secret); no
    // client component references these, so they stay out of browser JS.
    BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD || '',
    BACKEND_SHARED_SECRET: process.env.BACKEND_SHARED_SECRET || '',
    BACKEND_URL: process.env.BACKEND_URL || '',
    DEV_USER_EMAIL: process.env.DEV_USER_EMAIL || '',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; img-src 'self' data:; " +
              // Next.js dev (Fast Refresh / eval-source-map) needs 'unsafe-eval'
              // to hydrate; production must NOT have it. Gate on NODE_ENV.
              "script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : '') +
              "; style-src 'self' 'unsafe-inline'; " +
              "frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
