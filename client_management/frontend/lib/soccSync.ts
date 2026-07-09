// Parse a SOCC export's Projects tab into per-project status rows for the
// manual CCM<-SOCC sync. Client-side (ExcelJS), mirroring the importer.

import ExcelJS from 'exceljs';

import { normHeader, pick, sheetRows } from './importer';
import type { SoccStatus } from './types';

export async function parseSoccStatuses(file: File): Promise<SoccStatus[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const projectsWs = wb.worksheets.find(w => normHeader(w.name) === 'projects');
  if (!projectsWs) {
    throw new Error('This file has no "Projects" tab — export the Survey Ops projects and try again.');
  }
  const clientsWs = wb.worksheets.find(w => normHeader(w.name) === 'clients');
  const idToName = new Map<string, string>();
  if (clientsWs) {
    for (const c of sheetRows(clientsWs)) {
      if (c.id) idToName.set(c.id, c.name || '');
    }
  }

  const out: SoccStatus[] = [];
  let sawBoard = false;
  for (const r of sheetRows(projectsWs)) {
    if (r.deletedat) continue;
    const prCode = pick(r, 'soccprojectcode', 'projectcode', 'prcode', 'code');
    if (!prCode) continue;
    const boardColumn = pick(r, 'boardcolumn', 'board', 'stage', 'status', 'column', 'phase');
    if (boardColumn) sawBoard = true;
    const projectName = pick(r, 'projectname', 'name');
    const clientName = pick(r, 'client', 'clientname') || (r.clientid ? idToName.get(r.clientid) || '' : '');
    out.push({ prCode, boardColumn, projectName, clientName });
  }

  if (out.length > 0 && !sawBoard) {
    throw new Error(
      'The Projects tab has no board-column/status column. Add a "Board column" (or "Status") column to the SOCC export so CCM can read the fielding stage.',
    );
  }
  return out;
}
