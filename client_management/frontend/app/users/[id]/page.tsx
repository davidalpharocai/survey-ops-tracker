import Link from 'next/link';
import { notFound } from 'next/navigation';

import { apiForRequest, parseId } from '../../../lib/action';
import { creditsSigned, dollarsSigned, isoDate } from '../../../lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contact · AlphaROC' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactPage({ params }: PageProps) {
  const { id } = await params;
  const uid = parseId(id);
  if (uid == null) notFound();

  const api = await apiForRequest();
  const data = await api.contactStudies(uid);
  if (!data) notFound();

  const { contact, client, studies } = data;

  return (
    <>
      <Link className="back" href={client ? `/clients?id=${client.id}` : '/users'}>
        ← {client ? client.name : 'Contacts'}
      </Link>
      <h1>{contact.name}</h1>
      <p className="muted">
        {client ? (
          <>Contact at <Link href={`/clients?id=${client.id}`}>{client.name}</Link></>
        ) : (
          'Contact'
        )}
        {contact.email ? <> · {contact.email}</> : null}
      </p>

      <div className="card">
        <h3>Surveys requested <span className="muted small">({studies.length})</span></h3>
        {studies.length > 0 ? (
          <div className="table-scroll">
            <table className="report compact">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Survey</th>
                  <th className="num">Credits</th>
                  <th className="num">Dollars</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {studies.map(s => {
                  const cd = Number(s.creditsDelta);
                  const dd = Number(s.dollarsDelta);
                  return (
                    <tr key={s.id}>
                      <td>{isoDate(s.occurredOn)}</td>
                      <td>
                        {s.name}
                        {s.soccProjectCode ? <span className="muted small"> · {s.soccProjectCode}</span> : null}
                        {s.soccBoardColumn ? (
                          <span className={`tag tag-socc${s.soccBoardColumn.toLowerCase() === 'fielding' ? ' is-fielding' : ''}`}>{s.soccBoardColumn}</span>
                        ) : null}
                      </td>
                      <td className={`num${cd < 0 ? ' neg' : cd > 0 ? ' pos' : ''}`}>{creditsSigned(s.creditsDelta)}</td>
                      <td className={`num${dd < 0 ? ' neg' : dd > 0 ? ' pos' : ''}`}>{dollarsSigned(s.dollarsDelta)}</td>
                      <td className="row-actions">
                        {client && (
                          <Link className="btn-sm" href={`/reports/transactions?client_id=${client.id}`}>Open ledger</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No surveys are attributed to {contact.name} yet.</p>
        )}
      </div>
    </>
  );
}
