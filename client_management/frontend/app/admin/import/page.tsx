import Link from 'next/link';
import { notFound } from 'next/navigation';

import { currentUserIsAdmin } from '../../../lib/auth';
import ImportClient from './ImportClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import Data · AlphaROC' };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default async function ImportPage() {
  if (!(await currentUserIsAdmin())) notFound();

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Import Data</h1>
      <p className="muted">
        Upload a spreadsheet, review exactly what will change, then apply. Accepts the{' '}
        <strong>CMS template</strong> (
        <a href={`${BASE}/admin/import/template`} download>download blank template</a>
        ; the only format that carries costs and contract amounts) or a{' '}
        <strong>Survey Ops export</strong> (adds new clients/studies only — never
        touches existing records). Rows match by name; empty cells never overwrite;
        nothing is ever deleted.
      </p>
      <ImportClient />
    </>
  );
}
