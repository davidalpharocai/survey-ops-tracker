import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { extractText, kindFromFilename } from '@/lib/parsing/extract-text'

describe('kindFromFilename', () => {
  it('maps extensions', () => {
    expect(kindFromFilename('q.docx')).toBe('docx')
    expect(kindFromFilename('q.xlsx')).toBe('sheet')
    expect(kindFromFilename('q.csv')).toBe('sheet')
    expect(kindFromFilename('q.pdf')).toBe('pdf')
    expect(kindFromFilename('q.txt')).toBe('unsupported')
  })
})

describe('extractText', () => {
  it('passes csv through as text', async () => {
    const csv = 'Q#,Question,Type\n1,What is your role?,Single select'
    const buf = Buffer.from(csv, 'utf-8')
    const text = await extractText(buf, 'questions.csv')
    expect(text).toContain('What is your role?')
  })

  it('extracts xlsx sheets as csv text', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Q#', 'Question', 'Type'],
      ['1', 'Why did you choose us?', 'Open end'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Survey')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const text = await extractText(buf, 'questions.xlsx')
    expect(text).toContain('Why did you choose us?')
    expect(text).toContain('Open end')
  })

  it('throws for unsupported extensions', async () => {
    await expect(extractText(Buffer.from('x'), 'notes.txt')).rejects.toThrow(/unsupported/i)
  })
})
