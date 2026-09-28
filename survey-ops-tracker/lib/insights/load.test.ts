import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { CHILD_TABLES, INSIGHTS_PROJECT_COLUMNS, INSIGHTS_SELECTS, PAGE, loadInsightsRaw, type InsightsTable } from './load'

/**
 * Insights shows no dollar figure to anyone and must not even SELECT one: a
 * column that is selected reaches the browser whether or not the page draws
 * it. These tests fail the build the day a money-shaped column, an internal
 * target, or a `*` joins any read this page makes.
 */

/** Anything that names money, the internal target, or everything. */
const FORBIDDEN = /\*|budget|spend|price|margin|revenue|cost|cpi|\bbid\b|amount|credit|invoice|financ|n_internal_target/i

describe('no money in any select', () => {
  it('the survey column list names no money column', () => {
    for (const c of INSIGHTS_PROJECT_COLUMNS) expect(c, c).not.toMatch(FORBIDDEN)
    expect(INSIGHTS_PROJECT_COLUMNS).not.toContain('budget')
    expect(INSIGHTS_PROJECT_COLUMNS).not.toContain('actual_spend')
  })
  it('every select this page sends is money-free and never "*"', () => {
    for (const [table, cols] of Object.entries(INSIGHTS_SELECTS)) {
      // The child tables are cost tables by NAME; what matters is that only
      // their survey id is read.
      if ((CHILD_TABLES as readonly string[]).includes(table)) expect(cols).toBe('project_id')
      else expect(cols, table).not.toMatch(FORBIDDEN)
    }
  })
})

/** A Supabase double that records every select and serves pages. */
function fakeClient(tables: Partial<Record<InsightsTable, unknown[] | Error>>) {
  const seen: { table: string; cols: string; from: number; ordered: boolean; live: boolean }[] = []
  return {
    seen,
    from(table: string) {
      return {
        select(cols: string) {
          const st = { ordered: false, live: false, from: 0, to: 0 }
          const q = {
            is() { st.live = true; return q },
            order() { st.ordered = true; return q },
            range(f: number, t: number) { st.from = f; st.to = t; return q },
            then(res: (v: unknown) => void) {
              seen.push({ table, cols, from: st.from, ordered: st.ordered, live: st.live })
              const src = tables[table as InsightsTable] ?? []
              if (src instanceof Error) return Promise.resolve({ data: null, error: { message: src.message } }).then(res)
              return Promise.resolve({ data: src.slice(st.from, st.to + 1), error: null }).then(res)
            },
          }
          return q
        },
      }
    },
  }
}

describe('loadInsightsRaw', () => {
  it('reads only the declared selects, paged and ordered, live rows only for surveys', async () => {
    const projects = Array.from({ length: PAGE + 5 }, (_, i) => ({ id: `p${i}`, client_id: 'acme' }))
    const c = fakeClient({ survey_projects: projects, clients: [{ id: 'acme', name: 'Acme', is_demo: false }] })
    const raw = await loadInsightsRaw(c)
    expect(raw.projects).toHaveLength(PAGE + 5)
    for (const s of c.seen) {
      expect(s.cols).toBe(INSIGHTS_SELECTS[s.table as InsightsTable])
      expect(s.ordered).toBe(true)
    }
    expect(c.seen.filter(s => s.table === 'survey_projects').map(s => s.from)).toEqual([0, PAGE])
    expect(c.seen.find(s => s.table === 'survey_projects')?.live).toBe(true)
  })
  it('drops demo accounts but keeps a survey with no account', async () => {
    const c = fakeClient({
      survey_projects: [{ id: 'a', client_id: 'demo' }, { id: 'b', client_id: null }, { id: 'c', client_id: 'acme' }],
      clients: [{ id: 'demo', name: 'Demo Co', is_demo: true }, { id: 'acme', name: 'Acme', is_demo: false }],
    })
    const raw = await loadInsightsRaw(c)
    expect(raw.projects.map(p => p.id)).toEqual(['b', 'c'])
    expect(raw.demoDropped).toBe(1)
    expect([...raw.accounts.keys()]).toEqual(['acme'])
  })
  it('counts child rows per survey', async () => {
    const c = fakeClient({
      project_blasts: [{ project_id: 'a' }, { project_id: 'a' }],
      project_costs: [{ project_id: 'b' }],
    })
    const raw = await loadInsightsRaw(c)
    expect(raw.rowCounts?.get('a')).toEqual({ blasts: 2, suppliers: 0, costs: 0 })
    expect(raw.rowCounts?.get('b')).toEqual({ blasts: 0, suppliers: 0, costs: 1 })
  })
  it('a failed table is Blocked, never an empty answer', async () => {
    const c = fakeClient({ project_suppliers: new Error('permission denied'), survey_projects: [{ id: 'a', client_id: null }] })
    const raw = await loadInsightsRaw(c)
    expect(raw.blocked).toEqual([{ table: 'project_suppliers', message: 'permission denied' }])
    // Placeholders cannot be checked without every child table, so the counts
    // are withheld rather than half-built.
    expect(raw.rowCounts).toBeNull()
    expect(raw.projects).toHaveLength(1)
  })
  it('when clients fail, the demo count is unknown — null, never 0', async () => {
    const c = fakeClient({ clients: new Error('timeout'), survey_projects: [{ id: 'a', client_id: 'demo' }] })
    const raw = await loadInsightsRaw(c)
    expect(raw.demoDropped).toBeNull()
    expect(raw.blocked.map(b => b.table)).toEqual(['clients'])
  })
})

/* ── The page's own source ─────────────────────────────────────────────── */

const ROOT = path.resolve(__dirname, '..', '..')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
/** Code only: comments may explain what is NOT read without tripping the scan. */
const code = (file: string) =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the Insights page never names a money column', () => {
  const files = [
    path.join(ROOT, 'app', '(app)', 'insights', 'page.tsx'),
    ...walk(path.join(ROOT, 'components', 'insights')),
    ...walk(path.join(ROOT, 'lib', 'insights')),
  ]
  it('finds the files it guards', () => {
    expect(files.length).toBeGreaterThan(3)
  })
  it.each(files.map(f => [path.relative(ROOT, f), f]))('%s', (_rel, file) => {
    const src = code(file)
    expect(src).not.toMatch(/\bbudget\b|actual_spend|price_per_n|n_internal_target|project_financials/)
    expect(src).not.toMatch(/\.select\(\s*['"`]\*['"`]/)
    // The finance classifier is the one finance module this page may import.
    for (const m of src.matchAll(/from\s+['"](@\/lib\/finance\/[^'"]+)['"]/g)) {
      expect(m[1]).toBe('@/lib/finance/lifecycle')
    }
    // No money formatter from the chart kit either.
    expect(src).not.toMatch(/fmtMoney|moneyAuto|\bmoney2?\(/)
  })
})
