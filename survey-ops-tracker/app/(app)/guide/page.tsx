import { marked } from 'marked'
import guideMd from '@/USER_GUIDE.md'

export const metadata = { title: 'User Guide — Survey Ops Command Center' }

// The in-app User Guide renders the repo's USER_GUIDE.md — the single source of
// truth — so it can never drift the way a separate Google Doc did. The .md is
// bundled at build time (see the webpack rule in next.config.ts), so there's no
// runtime file access. Trusted, first-party content → marked → HTML is safe to inject.
export default function GuidePage() {
  const html = marked.parse(guideMd, { async: false }) as string
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      <article className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
