import { describe, it, expect } from 'vitest'
import { buildQaReport, renderQaReportText, DEFAULT_QA_CONFIG, type QaDeliverable, type QaProject } from './qa-report'

const NOW = new Date('2026-07-15T12:00:00Z')
const cfg = { ...DEFAULT_QA_CONFIG, now: NOW }

const deliv = (o: Partial<QaDeliverable>): QaDeliverable => ({
  id: 'x', status: 'filed', match_method: null, match_confidence: null, match_candidates: [],
  source: 'email', file_hash: null, project_id: null, file_name: null, original_file_name: null,
  forwarded_by: null, created_at: '2026-07-14T00:00:00Z', filed_at: '2026-07-14T00:00:00Z', deleted_at: null, ...o,
})
const proj = (o: Partial<QaProject>): QaProject => ({
  id: 'x', project_code: 'PR00000', project_name: 'P', client: 'C', deliver_date: null, project_type: null, deleted_at: null, ...o,
})

const deliverables: QaDeliverable[] = [
  // aging review (14 days old) + a fresh review (1 day, not flagged)
  deliv({ id: 'd1', status: 'review', match_candidates: [{ label: 'Coatue → Alpha Study (PR00001)' }], original_file_name: 'Aged.xlsx', forwarded_by: 'analyst@alpharoc.ai', created_at: '2026-07-01T00:00:00Z', filed_at: null }),
  deliv({ id: 'd2', status: 'review', original_file_name: 'Fresh.xlsx', created_at: '2026-07-14T00:00:00Z', filed_at: null }),
  // auto-file spot-check: recent AI + recent low-confidence (flagged); recent high-confidence code (not)
  deliv({ id: 'd3', status: 'filed', match_method: 'ai', match_confidence: 0.95, source: 'email', project_id: 'p1', original_file_name: 'Ai.xlsx', filed_at: '2026-07-14T00:00:00Z' }),
  deliv({ id: 'd4', status: 'filed', match_method: 'name', match_confidence: 0.7, source: 'upload', project_id: 'p1', original_file_name: 'Low.xlsx', filed_at: '2026-07-13T00:00:00Z' }),
  deliv({ id: 'd5', status: 'filed', match_method: 'code', match_confidence: 0.99, source: 'email', project_id: 'p1', original_file_name: 'High.xlsx', filed_at: '2026-07-13T00:00:00Z' }),
  // duplicates: two non-deleted rows sharing a hash (old filed, so not in the recent windows) + a deleted one (excluded)
  deliv({ id: 'd6', status: 'filed', match_method: 'code', match_confidence: 0.99, file_hash: 'HASHDUP', original_file_name: 'Dup.xlsx', filed_at: '2026-07-01T00:00:00Z' }),
  deliv({ id: 'd7', status: 'filed', match_method: 'code', match_confidence: 0.99, file_hash: 'HASHDUP', original_file_name: 'Dup-copy.xlsx', filed_at: '2026-07-01T00:00:00Z' }),
  deliv({ id: 'd9', status: 'filed', file_hash: 'HASHDUP', original_file_name: 'Dup-deleted.xlsx', deleted_at: '2026-07-02T00:00:00Z' }),
  // unsorted
  deliv({ id: 'd8', status: 'unsorted', original_file_name: 'Unsorted.xlsx', filed_at: '2026-07-10T00:00:00Z' }),
]
const projects: QaProject[] = [
  proj({ id: 'p1', project_code: 'PR00001', project_name: 'Alpha Study', deliver_date: '2026-07-10' }), // has filed → no gap
  proj({ id: 'p2', project_code: 'PR00002', project_name: 'Beta Study', deliver_date: '2026-07-05' }),   // no filed → gap
  proj({ id: 'p3', project_code: 'PR00003', project_name: 'Old Study', deliver_date: '2026-05-01' }),    // >30d → excluded
  proj({ id: 'p4', project_code: 'PR00004', project_name: 'Internal Thing', deliver_date: '2026-07-08', project_type: 'Internal' }), // internal → excluded
]

describe('buildQaReport', () => {
  const r = buildQaReport({ deliverables, projects }, cfg)

  it('flags aging review items older than agingDays (and not fresh ones)', () => {
    expect(r.agingReview.total).toBe(1)
    expect(r.agingReview.items[0].file).toContain('Aged')
    expect(r.agingReview.items[0].guess).toContain('Alpha Study')
    expect(r.agingReview.items[0].ageDays).toBe(14)
  })

  it('spot-checks recent AI + low-confidence auto-files only', () => {
    expect(r.autoFileSpotCheck.total).toBe(2)
    const files = r.autoFileSpotCheck.items.map((i) => i.file)
    expect(files.some((f) => f.includes('Ai'))).toBe(true)
    expect(files.some((f) => f.includes('Low'))).toBe(true)
    expect(files.some((f) => f.includes('High'))).toBe(false) // high-confidence non-AI is not surfaced
  })

  it('flags duplicate file hashes, excluding soft-deleted rows', () => {
    expect(r.duplicates.total).toBe(1)
    expect(r.duplicates.items[0].count).toBe(2) // d6 + d7; d9 is deleted
  })

  it('flags unsorted deliverables', () => {
    expect(r.unsorted.total).toBe(1)
    expect(r.unsorted.items[0].file).toContain('Unsorted')
  })

  it('flags recently-delivered projects with no filed deliverable, excluding old + internal', () => {
    expect(r.coverageGap.total).toBe(1)
    expect(r.coverageGap.examples[0]).toContain('Beta Study')
  })

  it('tallies recent filings by source × method', () => {
    expect(r.tally.filed).toBe(3) // d3, d4, d5 (recent, status filed); dups are old; unsorted excluded
    const map = Object.fromEntries(r.tally.bySourceMethod.map((x) => [x.key, x.count]))
    expect(map['email|ai']).toBe(1)
    expect(map['upload|name']).toBe(1)
    expect(map['email|code']).toBe(1)
  })

  it('is not clean when buckets are non-empty', () => {
    expect(r.clean).toBe(false)
  })

  it('is clean for an empty depository', () => {
    const empty = buildQaReport({ deliverables: [], projects: [] }, cfg)
    expect(empty.clean).toBe(true)
    expect(empty.agingReview.total).toBe(0)
    expect(empty.coverageGap.total).toBe(0)
  })

  it('reports the last email-ingest timestamp; healthy with 0 rejections + recent ingest', () => {
    expect(r.pipelineHealth.lastEmailIngestAt).toBe('2026-07-14T00:00:00Z') // newest source=email created_at
    expect(r.pipelineHealth.authRejections7d).toBe(0)
    expect(r.pipelineHealth.healthy).toBe(true)
  })

  it('flags forwarder auth-rejections as unhealthy → report not clean', () => {
    const rr = buildQaReport({ deliverables, projects, authRejections7d: 3 }, cfg)
    expect(rr.pipelineHealth.authRejections7d).toBe(3)
    expect(rr.pipelineHealth.healthy).toBe(false)
    expect(rr.clean).toBe(false)
  })

  it('flags a stale pipeline (no email ingest in >14 days) as unhealthy', () => {
    const stale = buildQaReport({ deliverables: [deliv({ id: 'old', source: 'email', created_at: '2026-06-01T00:00:00Z' })], projects: [], authRejections7d: 0 }, cfg)
    expect(stale.pipelineHealth.daysSince).toBeGreaterThan(14)
    expect(stale.pipelineHealth.healthy).toBe(false)
  })
})

describe('renderQaReportText', () => {
  it('renders the header, section counts, and a queue link', () => {
    const txt = renderQaReportText(buildQaReport({ deliverables, projects }, cfg))
    expect(txt).toContain('Deliverables QA')
    expect(txt).toMatch(/review/i)
    expect(txt).toContain('/deliverables')
  })

  it('renders a clean line for an empty depository', () => {
    const txt = renderQaReportText(buildQaReport({ deliverables: [], projects: [] }, cfg))
    expect(txt).toMatch(/clean/i)
    expect(txt).toMatch(/pipeline/i) // health line shows even when clean
  })

  it('surfaces forwarder auth-rejections prominently in the pipeline line', () => {
    const txt = renderQaReportText(buildQaReport({ deliverables, projects, authRejections7d: 2 }, cfg))
    expect(txt).toMatch(/pipeline/i)
    expect(txt).toContain('rejected forward')
    expect(txt).toContain('🔴')
  })
})
