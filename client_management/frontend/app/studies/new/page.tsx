import Link from 'next/link';

import { apiForRequest, parseId } from '../../../lib/action';
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
  const clients = await api.listClientsWithUsers();

  let selectedClient = null;
  let selectedClientUsers: ClientUser[] = [];
  let existingStudies: StudyTransaction[] = [];
  if (preselect) {
    selectedClient = clients.find(c => c.id === preselect) || null;
    if (selectedClient) {
      selectedClientUsers = selectedClient.users || [];
      existingStudies = await api.listStudiesByClient(preselect);
    }
  }

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
                  />
                </>
              )}
            </>
          )}

          <h2>Record a new study</h2>
          <NewStudyForm
            clientId={selectedClient ? selectedClient.id : null}
            users={selectedClientUsers}
          />
        </>
      )}
    </>
  );
}
