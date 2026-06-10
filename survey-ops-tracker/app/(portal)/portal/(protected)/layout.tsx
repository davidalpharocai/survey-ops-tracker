// Auth lives in each protected page via requirePortalUser() so the
// login redirect can carry the page's own path as ?next=.
export default function ProtectedPortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
