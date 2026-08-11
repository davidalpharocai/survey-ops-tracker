import { describe, it, expect } from 'vitest'
import { isRerunProject } from './isRerun'

describe('isRerunProject', () => {
  it('true when the project belongs to a rerun series (series_id set)', () => {
    expect(isRerunProject({ series_id: 'abc-123' })).toBe(true)
  })

  it('true when rerun_number is greater than 1 (a later wave)', () => {
    expect(isRerunProject({ rerun_number: 2 })).toBe(true)
  })

  it('false when rerun_number is 1 or null and there is no series / legacy type', () => {
    expect(isRerunProject({ rerun_number: 1 })).toBe(false)
    expect(isRerunProject({ rerun_number: null })).toBe(false)
    expect(isRerunProject({})).toBe(false)
  })

  it('true for a legacy project_type === "Rerun" row', () => {
    expect(isRerunProject({ project_type: 'Rerun' })).toBe(true)
  })

  it('false for a plain PS or B2B row with no series/rerun_number', () => {
    expect(isRerunProject({ project_type: 'PS' })).toBe(false)
    expect(isRerunProject({ project_type: 'B2B' })).toBe(false)
  })
})
