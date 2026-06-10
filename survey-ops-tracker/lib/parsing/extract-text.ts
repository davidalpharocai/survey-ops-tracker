import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

export type FileKind = 'docx' | 'sheet' | 'pdf' | 'unsupported'

export function kindFromFilename(filename: string): FileKind {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'sheet'
  if (ext === 'pdf') return 'pdf'
  return 'unsupported'
}

// Returns plain text for docx/sheet files. PDFs are NOT handled here —
// they go to Claude as a native document block (see claude-parser.ts).
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const kind = kindFromFilename(filename)

  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (kind === 'sheet') {
    if (filename.toLowerCase().endsWith('.csv')) {
      return buffer.toString('utf-8')
    }
    const wb = XLSX.read(buffer, { type: 'buffer' })
    return wb.SheetNames.map(name =>
      `--- Sheet: ${name} ---\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])
    ).join('\n\n')
  }

  throw new Error(`Unsupported file type: ${filename}. Use .docx, .xlsx, .csv, or .pdf.`)
}
