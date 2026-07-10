const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * App-wide banner shown while an admin is viewing CCM as another user.
 * Makes the read-only impersonation state impossible to miss and gives a
 * one-click exit back to the admin's own identity. Exit is a native POST to
 * the route handler (full-page nav) so the client fully rebuilds as the real
 * user — a server-action soft-redirect left a stale client cache / 404.
 */
export default function ImpersonationBanner({
  viewingAs,
  by,
}: {
  viewingAs: string;
  by: string;
}) {
  return (
    <div className="imp-banner" role="status">
      <span className="imp-banner-text">
        👁 Viewing as <strong>{viewingAs}</strong> — read-only.
        <span className="muted small"> Signed in as {by}.</span>
      </span>
      <form method="post" action={`${BASE_PATH}/api/impersonate`} className="inline-form">
        <input type="hidden" name="intent" value="stop" />
        <button type="submit" className="btn-sm">Exit view-as</button>
      </form>
    </div>
  );
}
