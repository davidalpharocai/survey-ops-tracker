import Link from 'next/link';

import { apiForRequest, parseId } from '../../../lib/action';
import { onlyNotFound } from '../../../lib/api';
import { currentUserReadOnly } from '../../../lib/auth';
import type { ClientUser, StudyTransaction } from '../../../lib/types';
import AutoSubmitSelect from '../../_components/AutoSubmitSelect';
import ExistingStudiesTable from './ExistingStudiesTable';
import NewStudyForm from './NewStudyForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Record a Study · AlphaROC' };

interface PageProps {
  searchParams: Promise<{ client_id?: string }>;
}

export default async function NewStudyPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const preselect = parseId(sp?.client_id);

  const api = await apiForRequest();
  // Fetch the client list and (when arriving with a preselected client, the
  // common path from the "+ Add study" quicklinks) that client's studies in
  // one parallel wave — the per-client read only needs `preselect` (a URL
  // int), so waiting for the list first was a gratuitous extra round trip.
  const [clients, fetchedStudies, fetchedContracts, readOnly] = await Promise.all([
    api.listClientsWithUsers(),
    preselect
      ? api.listStudiesByClient(preselect).catch(onlyNotFound([] as StudyTransaction[]))
      : Promise.resolve([] as StudyTransaction[]),
    preselect
      ? api.listContractsByClient(preselect).catch(() => [])
      : Promise.resolve([]),
    currentUserReadOnly(),
  ]);

  const selectedClient = preselect ? clients.find(c => c.id === preselect) || null : null;
  const selectedClientUsers: ClientUser[] = selectedClient?.users || [];
  const existingStudies: StudyTransaction[] = selectedClient ? fetchedStudies : [];
  const clientContracts = selectedClient
    ? fetchedContracts.map(c => ({ id: c.id, name: c.name }))
    : [];

  const pending = existingStudies.filter(t => t.isImported).length;

  return (
    <>
      <Link className="back" href="/">← Home</Link>
      <h1>Record a Study</h1>
      <p className="muted">Each study can be attributed to multiple contacts. Trackers run on a recurring cadence; their per-run cost &times; runs per year is the annual draw on the client&apos;s balance.</p>

      {clients.length === 0 ? (
        <p className="warn">No clients yet. <Link href="/clients">Create one first →</Link></p>
      ) : (
        <>
          <form method="get" action="" className="filterbar">
            <label>Client
              <AutoSubmitSelect name="client_id" defaultValue={preselect || ''}>
                <option value="">— pick a client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </AutoSubmitSelect>
            </label>
          </form>

          {readOnly ? (
            <p className="muted">You&apos;re viewing as another user (read-only) — exit to record or edit studies.</p>
          ) : (
            <>
              <h2>Record a new study</h2>
              <NewStudyForm
                clientId={selectedClient ? selectedClient.id : null}
                users={selectedClientUsers}
                contracts={clientContracts}
              />
            </>
          )}

          {selectedClient && (
            <>
              <h2>
                Existing studies for {selectedClient.name}{' '}
                <span className="muted small">({existingStudies.length})</span>
              </h2>

              {existingStudies.length === 0 ? (
                <p className="muted">No studies recorded yet for this client.</p>
              ) : (
                <>
                  {pending > 0 && (
                    <p className="warn small">
                      {pending} imported stud{pending === 1 ? 'y' : 'ies'} need review — set a cost (saves clear the flag), or click <strong>Mark reviewed</strong> if the cost really is zero.
                    </p>
                  )}
                  <ExistingStudiesTable
                    studies={existingStudies}
                    clientUsers={selectedClientUsers}
                    clientId={selectedClient.id}
                    readOnly={readOnly}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
