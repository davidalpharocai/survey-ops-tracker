import { stopImpersonationAction } from '../admin/impersonate/actions';
import SubmitButton from './SubmitButton';

/**
 * App-wide banner shown while an admin is viewing CCM as another user.
 * Makes the read-only impersonation state impossible to miss and gives a
 * one-click exit back to the admin's own identity.
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
      <form action={stopImpersonationAction} className="inline-form">
        <SubmitButton className="btn-sm" pendingLabel="Exiting…">Exit view-as</SubmitButton>
      </form>
    </div>
  );
}
