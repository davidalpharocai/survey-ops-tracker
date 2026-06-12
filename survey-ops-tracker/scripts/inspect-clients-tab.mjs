// Dump the Unique Clients tab (name -> Cl id) and search all client names
// for the merge targets David mentioned.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))
const wb = XLSX.readFile(path.join(dir, 'survey-ops.xlsx'))
console.log('TABS:', wb.SheetNames.join(' | '))

const tab = wb.SheetNames.find(n => n.toLowerCase().startsWith('unique clients'))
const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null })
console.log(`\n=== ${tab}: header ===`)
console.log(JSON.stringify(rows[0]))

const entries = []
for (const r of rows.slice(1)) {
  const name = typeof r[0] === 'string' ? r[0].trim() : null
  if (!name) continue
  entries.push({ name, is_private: r[1], notes: r[2], status: r[3], code: typeof r[4] === 'string' ? r[4].trim() : r[4] })
}
console.log(`\n${entries.length} client rows:`)
for (const e of entries) console.log(`${e.code ?? '(no id)'}\t${e.name}${e.is_private === true ? '  [private]' : ''}${e.notes ? '  // ' + String(e.notes).slice(0, 40) : ''}`)

// search every tab for the mystery names
const NEEDLES = ['capital', 'iowa', 'millen', 'fire', 'us coc', 'berman', 'foulkes', 'rerun - and then']
console.log('\n=== mystery-name hits across all tabs (col A-F) ===')
for (const name of wb.SheetNames) {
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
  rs.forEach((r, i) => {
    for (const cell of r.slice(0, 6)) {
      if (typeof cell === 'string' && NEEDLES.some(n => cell.toLowerCase().includes(n))) {
        console.log(`${name} row ${i + 1}: ${JSON.stringify(cell.slice(0, 80))}`)
        break
      }
    }
  })
}
