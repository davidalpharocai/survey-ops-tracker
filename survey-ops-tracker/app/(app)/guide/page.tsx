import { marked } from 'marked'
import guideMd from '@/USER_GUIDE.md'
import { GuideNav, type TocItem } from './GuideNav'

export const metadata = { title: 'User Guide — Survey Ops Command Center' }

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'section'
  )
}

// Heading inner HTML → plain display text (strip tags, decode the entities marked emits).
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

// The in-app User Guide renders the repo's USER_GUIDE.md (single source of truth,
// bundled at build time — see the webpack rule in next.config.ts). We inject id
// anchors into h1–h3 and build a table of contents (h2 + h3) for the side nav so
// readers can search + jump. Trusted first-party content → HTML injection is safe.
export default function GuidePage() {
  const raw = marked.parse(guideMd, { async: false }) as string

  const toc: TocItem[] = []
  const seen = new Set<string>()
  const html = raw.replace(/<h([123])>([\s\S]*?)<\/h\1>/g, (_m, lvl: string, inner: string) => {
    const text = plainText(inner)
    const base = slugify(text)
    let slug = base
    let i = 1
    while (seen.has(slug)) slug = `${base}-${++i}`
    seen.add(slug)
    if (Number(lvl) >= 2) toc.push({ level: Number(lvl), text, slug })
    return `<h${lvl} id="${slug}">${inner}</h${lvl}>`
  })

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 lg:flex lg:gap-8">
      <aside className="mb-5 lg:mb-0 lg:w-60 lg:shrink-0 lg:sticky lg:top-4 lg:self-start">
        <GuideNav toc={toc} />
      </aside>
      <article className="doc-prose min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
