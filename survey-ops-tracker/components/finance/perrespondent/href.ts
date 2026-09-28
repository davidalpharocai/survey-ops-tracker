/**
 * Add one query parameter to an in-app href ("/finance?tab=results" →
 * "/finance?tab=results&by=panel") and keep its path and hash. The shell's
 * `hrefFor` carries the filter and the tab; a tab's own keys (the Results
 * tab's group-by) are added here, so a link lands on exactly the view it names
 * and stays a real, copyable URL.
 */
export function withParam(href: string, key: string, value: string): string {
  const u = new URL(href, 'http://local.invalid')
  u.searchParams.set(key, value)
  return `${u.pathname}${u.search}${u.hash}`
}
