// Login landing page. Credentials are entered on the Cognito Hosted UI;
// this page is the branded entry point that kicks off the OAuth flow.

import Link from 'next/link';

const ERROR_MESSAGES: Record<string, string> = {
  bad_state: 'Your sign-in session expired. Please try again.',
  missing_code: 'Sign-in did not complete. Please try again.',
  exchange_failed: 'Could not complete sign-in. Please try again.',
  unauthorized: 'Your account is not authorized to use this app.',
  access_denied: 'Access denied.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const href = `/api/auth/login?next=${encodeURIComponent(next || '/')}`;
  const message = error ? ERROR_MESSAGES[error] || 'Sign-in failed. Please try again.' : null;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 className="login-title">AlphaROC</h1>
        <p className="login-sub">Credit Management</p>
        {message && <p className="login-error">{message}</p>}
        <Link className="login-btn" href={href}>
          Sign in with AlphaROC
        </Link>
        <p className="login-foot muted small">Restricted to @alpharoc.ai accounts.</p>
      </div>
    </div>
  );
}
