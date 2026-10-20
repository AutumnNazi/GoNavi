import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { t } from '../../i18n';
import { buildJobManagementPlan } from '../../utils/databaseJobs/jobManagementPlans';
import { emptyJobSnapshot, jobOperationUnavailableReason, resolveJobManagementDialect, type JobCreateInput, type JobOperation, type JobSQLPlan, type JobTarget } from '../../utils/databaseJobs/jobManagementTypes';
import { starRocksSupportsAlterTask } from '../../utils/databaseJobs/jobDistributedManagement';
import { readDatabaseJobText } from '../../utils/databaseJobs/jobMetadata';
import { jobManagementSnippets } from '../../utils/databaseJobs/jobManagementSnippets';
import type { DatabaseJobRow } from '../../typeDefs/databaseJobTypes';
import { createJobMetadataExecutor, loadJobManagementSnapshot } from './jobManagementMetadata';
import { isJobMutationRestricted } from './jobManagementExecution';
import { submitJobSQL } from './jobManagementRuntime';
import type { JobManagementRequest } from './jobManagementRequest';

const displayError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith('database_jobs.') ? t(text) : text;
};

export const useJobManagement = (request: JobManagementRequest) => {
  const connection = useStore(s => s.connections.find(c => c.id === request.connectionId));
  const [operation, setOperation] = useState<JobOperation>(request.operation);
  const [input, setInput] = useState<JobCreateInput>({ name: '', action: '', schedule: '', program: '', scheduleName: '', jobType: 'PLSQL_BLOCK' });
  const [sql, setSQL] = useState('');
  const [plan, setPlan] = useState<JobSQLPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rows, setRows] = useState<DatabaseJobRow[]>([]);
  const [version, setVersion] = useState('');
  const alive = useRef(true);
  const revision = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  const dialect = resolveJobManagementDialect(connection?.config);
  const target = useMemo<JobTarget | null>(() => dialect ? ({ dialect, kind: request.kind, database: request.database, owner: request.owner, name: request.name }) : null,
    [dialect, request.kind, request.database, request.owner, request.name]);
  const readOnly = operation === 'history' || operation === 'status';
  const protectedConnection = isJobMutationRestricted(connection);
  const unavailable = (op: JobOperation) => {
    if (request.kind === 'starrocks-task' && ['edit', 'enable', 'disable'].includes(op) && !starRocksSupportsAlterTask(version)) return 'database_jobs.manage.starrocks_version';
    return jobOperationUnavailableReason(request.kind, op);
  };
  const load = async (op: JobOperation = operation) => {
    if (!target || !connection || inFlight.current) return;
    const ticket = ++revision.current;
    setLoading(true); setError(''); setNotice(''); setPlan(null); setRows([]); setSQL('');
    try {
      const execute = createJobMetadataExecutor(connection, request.database);
      if (request.kind === 'starrocks-task') {
        const result = await execute('SELECT current_version() AS version');
        const serverVersion = result.success && Array.isArray(result.data) && result.data[0] ? readDatabaseJobText(result.data[0], 'version') : '';
        if (alive.current && ticket === revision.current) setVersion(serverVersion);
        if (['edit', 'enable', 'disable'].includes(op) && !starRocksSupportsAlterTask(serverVersion)) throw new Error('database_jobs.manage.starrocks_version');
      }
      const snapshot = op === 'create' ? emptyJobSnapshot() : await loadJobManagementSnapshot(target, execute, op === 'edit');
      const next = buildJobManagementPlan(target, op, snapshot, input);
      const result = next.readOnly ? await execute(next.sql) : null;
      if (result && !result.success) throw new Error(result.message || 'database_jobs.error.query_failed');
      if (alive.current && ticket === revision.current) {
        setPlan(next); setSQL(next.sql);
        if (result && Array.isArray(result.data)) { setRows(result.data); setNotice(t('database_jobs.manage.loaded')); }
      }
    } catch (e) { if (alive.current && ticket === revision.current) setError(displayError(e)); }
    finally { if (alive.current && ticket === revision.current) setLoading(false); }
  };
  useEffect(() => { if (operation !== 'create') void load(operation); }, [operation, target, connection?.config]);
  const submit = async () => {
    if (!target || !plan || busy || loading || inFlight.current || unavailable(operation)) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice(''); setRows([]);
    try {
      const result = await submitJobSQL(request, target, operation, input, plan, sql);
      if (!alive.current || !result) return;
      if (!result.success) throw new Error(result.message || 'database_jobs.error.query_failed');
      setRows(Array.isArray(result.data) ? result.data : []);
      setNotice(t(readOnly ? 'database_jobs.manage.loaded' : 'database_jobs.manage.applied'));
      if (!readOnly) setPlan(null); // Prevent a second accidental execution of create/run/drop.
    } catch (e) { if (alive.current) setError(`${displayError(e)}${readOnly ? '' : ` ${t('database_jobs.manage.failure_state')}`}`); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const changeOperation = (op: JobOperation) => { if (!busy && !loading) { setOperation(op); setPlan(null); setSQL(''); setError(''); setRows([]); setNotice(''); } };
  const changeInput = (patch: Partial<JobCreateInput>) => { setInput(previous => ({ ...previous, ...patch })); setPlan(null); setSQL(''); };
  const snippets = useMemo(() => target && request.name ? jobManagementSnippets(target) : [], [target]);
  return { operation, changeOperation, input, changeInput, sql, setSQL, plan, loading, busy, error, notice, rows, load, submit, readOnly, protectedConnection, unavailable, snippets };
};
