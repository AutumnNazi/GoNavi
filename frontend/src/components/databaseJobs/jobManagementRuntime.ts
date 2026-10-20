import { DBQuery, DBQueryAudited } from '../../../wailsjs/go/app/App';
import { useStore } from '../../store';
import { t } from '../../i18n';
import Modal from '../common/ResizableDraggableModal';
import { confirmProductionMutation } from '../../utils/productionRiskConfirm';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
import { dispatchSidebarDatabaseRefresh } from '../../utils/sidebarDatabaseRefresh';
import { buildJobManagementPlan } from '../../utils/databaseJobs/jobManagementPlans';
import type { JobCreateInput, JobOperation, JobSQLPlan, JobTarget } from '../../utils/databaseJobs/jobManagementTypes';
import { executeJobManagement } from './jobManagementExecution';
import { createJobMetadataExecutor, loadJobManagementSnapshot } from './jobManagementMetadata';
import type { JobManagementRequest } from './jobManagementRequest';

export const confirmJobSQL = (operation: JobOperation, target: string): Promise<boolean> => new Promise(resolve => {
  let settled = false;
  const settle = (value: boolean) => { if (!settled) { settled = true; resolve(value); } };
  Modal.confirm({
    title: t('database_jobs.manage.confirm_title'),
    content: t('database_jobs.manage.confirm_body', { action: t(`database_jobs.manage.${operation}`), target }),
    okText: t('database_jobs.manage.apply'), cancelText: t('common.cancel'),
    okButtonProps: { danger: true }, onOk: () => settle(true), onCancel: () => settle(false), afterClose: () => settle(false),
  });
});

export const confirmDiscardJobSQL = (): Promise<boolean> => new Promise(resolve => {
  let settled = false;
  const settle = (result: boolean) => { if (!settled) { settled = true; resolve(result); } };
  Modal.confirm({ title: t('database_jobs.manage.discard'), okText: t('common.confirm'), cancelText: t('common.cancel'),
    onOk: () => settle(true), onCancel: () => settle(false), afterClose: () => settle(false) });
});

export const submitJobSQL = async (request: JobManagementRequest, target: JobTarget, operation: JobOperation, input: JobCreateInput, plan: JobSQLPlan, sql: string) => {
  const getConnection = () => useStore.getState().connections.find(c => c.id === request.connectionId);
  if (plan.readOnly && sql !== plan.sql) throw new Error('database_jobs.manage.invalid_value');
  const result = await executeJobManagement(operation, sql, {
    getConnection,
    confirm: async connection => await confirmJobSQL(operation, target.name || input.name)
      && await confirmProductionMutation(connection, t(`database_jobs.manage.${operation}`), target.name || input.name),
    validateFresh: operation !== 'edit' ? undefined : async () => {
      const connection = getConnection();
      if (!connection) throw new Error('database_jobs.manage.connection_missing');
      const latest = await loadJobManagementSnapshot(target, createJobMetadataExecutor(connection, target.database));
      const refreshed = buildJobManagementPlan(target, 'edit', latest, input);
      if (refreshed.sql !== plan.sql) throw new Error('database_jobs.manage.concurrent_change');
    },
    execute: (connection, command) => plan.readOnly
      ? DBQuery(buildRpcConnectionConfig(connection.config), target.database, command)
      : DBQueryAudited(buildRpcConnectionConfig(connection.config), target.database, command, 'database_jobs'),
  });
  if (result?.success && !plan.readOnly) {
    dispatchSidebarDatabaseRefresh({ connectionId: request.connectionId, dbName: target.database, schemaName: target.owner, reason: 'external' });
    // Refresh failure must not turn a completed mutation into an apparent write failure.
    try { await request.onChanged?.(); } catch { /* The panel has an explicit reload action. */ }
  }
  return result;
};
