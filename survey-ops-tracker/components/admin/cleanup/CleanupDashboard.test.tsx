import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { cleanSurvey, resetFixtureSeq } from '@/lib/admin/fixtures'
import { CHECKS, type CleanupRow } from '@/lib/admin/cleanup'
import type { CleanupData } from '@/app/(app)/admin/cleanup/load'
import { CleanupDashboard } from './CleanupDashboard'

/**
 * What this dashboard must never do: draw a zero it cannot stand behind.
 *
 * The three failures worth guarding are all "a number that looks fine":
 *   · a blocked source rendering as 0 rather than as "not measured";
 *   · the legacy-import exclusion moving counts without saying so;
 *   · the CSV going out with headers that do not name the database columns,
 *     which is what makes the round trip back into the database guesswork.
 */

// The file and the audit note are the two side effects; the CSV TEXT is built
// by lib/admin/cleanupCsv and is asserted here as it is handed over.
const { downloadCsv, logExport } = vi.hoisted(() => ({
  downloadCsv: vi.fn<(text: string, filename: string) => void>(),
  // The id echoes the row count, so an assertion on the message also proves
  // the right number of rows was reported to the audit log.
  logExport: vi.fn(async (entry: { route: string; rowCount: number; includedRestricted: boolean }) =>
    ({ ok: true, status: 200, id: `abcd1234-${entry.rowCount}`, error: null })),
}))
vi.mock('@/lib/utils/exportCsv', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/utils/exportCsv')>()),
  downloadCsv,
  logExport,
}))

const router = {
  push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(),
}

function data(over: Partial<CleanupData> = {}): CleanupData {
  return {
    projects: [],
    fielding: {},
    contacts: {},
    internalTargets: [],
    blocked: [],
    blockedWhy: [],
    today: '2026-09-28',
    loadedAtLabel: '2:00 PM',
    error: null,
    ...over,
  }
}

function show(d: CleanupData) {
  return render(
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <CleanupDashboard data={d} />
    </AppRouterContext.Provider>,
  )
}

const tile = (id: string) => screen.getByTestId(`tile-${id}`)

beforeEach(() => {
  resetFixtureSeq()
  downloadCsv.mockClear()
  logExport.mockClear()
})

describe('the tiles come from the model', () => {
  it('draws one tile per check, and counts what the model counted', () => {
    const rows: CleanupRow[] = [
      cleanSurvey({ id: 'a', project_code: 'PR00042', due_date: null }),
      cleanSurvey({ id: 'b', project_code: 'PR00043', due_date: null }),
      cleanSurvey({ id: 'c', project_code: 'PR00044' }),
    ]
    show(data({ projects: rows }))

    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(CHECKS.length)
    const due = tile('no_due_date')
    expect(due).toHaveAttribute('data-state', 'work')
    expect(within(due).getByText('2')).toBeInTheDocument()
    expect(within(due).getByText(/of 3 checked/)).toBeInTheDocument()
  })

  it('states the rerun waves beside the headline count, never folded into it', () => {
    show(data({
      projects: [
        cleanSurvey({ id: 'a', project_code: 'PR00042', due_date: null }),
        // A repeat wave: series_id makes it one (lib/reruns/isRerun.ts).
        cleanSurvey({ id: 'w', project_code: 'PR00050', due_date: null, series_id: 's1', rerun_number: 2 }),
      ],
    }))
    const due = tile('no_due_date')
    expect(within(due).getByText('1')).toBeInTheDocument()
    expect(within(due).getByText(/plus 1 rerun wave not yet picked up/)).toBeInTheDocument()
  })

  it('a tile at zero reads as settled, and is not a control', () => {
    show(data({ projects: [cleanSurvey({ id: 'a' })] }))
    const due = tile('no_due_date')
    expect(due).toHaveAttribute('data-state', 'clear')
    expect(within(due).getByText(/✓ 0/)).toBeInTheDocument()
    expect(within(due).getByText(/Clear/)).toBeInTheDocument()
    expect(due.tagName).not.toBe('BUTTON')
    expect(within(due).queryByText(/See the surveys/)).not.toBeInTheDocument()
  })

  it('says how many tiles are at zero, which is the number being driven', () => {
    show(data({ projects: [cleanSurvey({ id: 'a', due_date: null })] }))
    expect(screen.getByText(`${CHECKS.length - 1} of ${CHECKS.length}`)).toBeInTheDocument()
    expect(screen.getByText(/tiles are at zero/)).toBeInTheDocument()
    expect(screen.getByText(/survey needs/)).toBeInTheDocument()
  })

  it('a blocked source shows a dash and names the read, never a zero', () => {
    show(data({
      projects: [cleanSurvey({ id: 'a' })],
      blocked: ['contacts'],
      blockedWhy: [{ source: 'contacts', message: 'permission denied for table client_contacts' }],
    }))
    const occam = tile('flag_occam_not_onboarded')
    expect(occam).toHaveAttribute('data-state', 'blocked')
    expect(within(occam).getByText('—')).toBeInTheDocument()
    expect(within(occam).getByText(/Not measured — client contacts did not load/)).toBeInTheDocument()
    // Once on the tile, once in the page banner.
    expect(screen.getAllByText(/client contacts did not load/).length).toBe(2)
    expect(screen.getByText(/permission denied for table client_contacts/)).toBeInTheDocument()
  })
})

describe('the legacy-import scope', () => {
  const legacy = () => data({
    projects: [
      cleanSurvey({ id: 'new', project_code: 'PR00100', due_date: null, created_at: '2026-08-01T09:00:00Z' }),
      // Import day itself. A string compare against the bare date would let
      // this one in; the model compares dates, and so must the page.
      cleanSurvey({ id: 'old', project_code: 'PR00001', due_date: null, created_at: '2026-06-10T23:59:59Z' }),
    ],
  })

  it('excludes the import by default and says so in words, with the count', () => {
    show(legacy())
    expect(within(tile('no_due_date')).getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/Include the 1 surveys imported from the Survey Ops sheet on June 10, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/1 set aside; 1 surveys are being checked/)).toBeInTheDocument()
  })

  it('the toggle changes the counts', async () => {
    const user = userEvent.setup()
    show(legacy())
    await user.click(screen.getByRole('checkbox', { name: /Include the 1 surveys imported/ }))
    expect(within(tile('no_due_date')).getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/counted in every number on this page right now/)).toBeInTheDocument()
  })
})

describe('the drill', () => {
  const dirty = () => data({
    projects: [
      cleanSurvey({ id: 'a', project_code: 'PR00042', project_name: 'Buyer pulse', due_date: null }),
      cleanSurvey({ id: 'b', project_code: 'PR00043', project_name: 'Seller pulse' }),
      cleanSurvey({ id: 'w', project_code: 'PR00050', due_date: null, series_id: 's1', rerun_number: 3 }),
    ],
  })

  it('lists the surveys that fail that check, and only those', async () => {
    const user = userEvent.setup()
    show(dirty())
    await user.click(tile('no_due_date'))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'PR00042' })).toHaveAttribute('href', '/projects/a')
    expect(within(dialog).queryByRole('link', { name: 'PR00043' })).not.toBeInTheDocument()
    // The wave is behind its own switch, exactly as on the tile.
    expect(within(dialog).queryByRole('link', { name: 'PR00050' })).not.toBeInTheDocument()
    // The field the check is about is a column, and it reads empty.
    expect(within(dialog).getByRole('columnheader', { name: 'due_date' })).toBeInTheDocument()
    expect(within(dialog).getAllByText('empty').length).toBeGreaterThan(0)

    await user.click(within(dialog).getByRole('checkbox', { name: /Include the 1 rerun wave/ }))
    expect(within(dialog).getByRole('link', { name: 'PR00050' })).toBeInTheDocument()
  })

  it('exports a worksheet whose headers name the database columns, and logs it', async () => {
    const user = userEvent.setup()
    show(dirty())
    await user.click(tile('no_due_date'))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Export these 1 rows/ }))

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [text, filename] = downloadCsv.mock.calls[0]
    const [header, ...rows] = text.split('\r\n')
    expect(header.split(',')).toEqual([
      'project_code', 'project_name', 'client', 'stage', 'status', 'rerun_wave', 'requested_by',
      'due_date (current)', 'due_date',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].startsWith('PR00042,Buyer pulse,')).toBe(true)
    // The blank column to type into is the last cell, and it is blank.
    expect(rows[0].endsWith(',')).toBe(true)
    expect(filename).toBe('socc-cleanup-no-due-date-2026-09-28.csv')

    expect(logExport).toHaveBeenCalledWith(expect.objectContaining({
      route: 'admin-cleanup-no_due_date',
      rowCount: 1,
      includedRestricted: false,
    }))
    expect(await screen.findByText(/Logged as export #abcd1234/)).toBeInTheDocument()
  })

  it('opens with the waves already shown when the waves are the whole count', async () => {
    const user = userEvent.setup()
    show(data({
      projects: [
        cleanSurvey({ id: 'a', project_code: 'PR00042' }),
        cleanSurvey({ id: 'w', project_code: 'PR00050', captain_id: null, series_id: 's1', rerun_number: 2 }),
      ],
    }))
    const cap = tile('no_captain')
    // The headline is the actionable number, which is zero — and the tile is
    // still work, because the waves are not nothing.
    expect(cap).toHaveAttribute('data-state', 'work')
    expect(within(cap).getByText(/plus 1 rerun wave/)).toBeInTheDocument()

    await user.click(cap)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'PR00050' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /Include the 1 rerun wave/ })).toBeChecked()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    show(dirty())
    await user.click(tile('no_due_date'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('a failed read is not a clean book', () => {
  it('renders no numbers at all when the surveys did not load', () => {
    show(data({ error: 'survey_projects did not load' }))
    expect(screen.getByText(/The surveys did not load/)).toBeInTheDocument()
    expect(screen.queryByTestId(/^tile-/)).not.toBeInTheDocument()
    expect(screen.getByText(/survey_projects did not load/)).toBeInTheDocument()
  })
})

describe('the page-level exports', () => {
  it('writes one row per tile, with blanks where a source did not load', async () => {
    const user = userEvent.setup()
    show(data({ projects: [cleanSurvey({ id: 'a', due_date: null })], blocked: ['contacts'] }))
    await user.click(screen.getByRole('button', { name: /Export every tile/ }))

    const [text, filename] = downloadCsv.mock.calls[0]
    expect(filename).toBe('socc-cleanup-summary-2026-09-28.csv')
    const lines = text.split('\r\n')
    expect(lines[0].split(',').slice(0, 6)).toEqual(['check_id', 'check', 'group', 'severity', 'surveys', 'rerun_waves'])
    const occam = lines.find(l => l.startsWith('flag_occam_not_onboarded'))!
    // surveys and rerun_waves are EMPTY, not 0 — the check was never measured.
    expect(occam).toContain(',,,')
    expect(logExport).toHaveBeenCalledWith(expect.objectContaining({ route: 'admin-cleanup-summary' }))
  })
})
