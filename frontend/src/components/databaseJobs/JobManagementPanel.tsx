import React from 'react';
import { Alert, Button, Select, Space, Table, Tooltip } from 'antd';
import { t } from '../../i18n';
import { useStore } from '../../store';
import Editor from '../MonacoEditor';
import { JOB_OPERATIONS } from '../../utils/databaseJobs/jobManagementTypes';
import type { JobManagementRequest } from './jobManagementRequest';
import { JobCreateFields } from './JobCreateFields';
import { useJobManagement } from './useJobManagement';
import { confirmDiscardJobSQL } from './jobManagementRuntime';
import './jobManagement.css';

export const JobManagementPanel = ({ request, onClose }: { request: JobManagementRequest; onClose: () => void }) => {
  const state = useJobManagement(request);
  const dark = useStore(s => s.theme === 'dark');
  const replacingDraft = async (action: () => void) => {
    if (state.sql && state.plan && state.sql !== state.plan.sql && !await confirmDiscardJobSQL()) return;
    action();
  };
  const columns = Array.from(new Set(state.rows.flatMap(row => Object.keys(row)))).map(key => ({
    title: key, dataIndex: key, key, ellipsis: true,
    render: (v: unknown) => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v),
  }));
  return <div className="gn-job-manager">
    <Space wrap>
      <strong>{t(`database_jobs.source.${request.kind}`)}</strong>
      <span>{[request.database, request.owner, request.name].filter(Boolean).join(' / ')}</span>
    </Space>
    {request.operation !== 'create' && <Space wrap>
      {JOB_OPERATIONS.map(operation => <Tooltip key={operation} title={state.unavailable(operation) ? t(state.unavailable(operation)) : undefined}>
        <span><Button size="small" type={state.operation === operation ? 'primary' : 'default'}
          danger={operation === 'drop' || operation === 'stop'}
          disabled={state.busy || state.loading || Boolean(state.unavailable(operation)) || (state.protectedConnection && !['history', 'status'].includes(operation))}
          onClick={() => void replacingDraft(() => state.changeOperation(operation))}>{t(`database_jobs.manage.${operation}`)}</Button></span>
      </Tooltip>)}
    </Space>}
    {state.protectedConnection && <Alert type="warning" showIcon message={t('database_jobs.manage.protected')} />}
    {request.operation === 'create' && <JobCreateFields kind={request.kind} input={state.input} onChange={state.changeInput} disabled={state.busy || state.loading || state.protectedConnection} />}
    {state.plan?.warning && <Alert type="warning" showIcon message={t(state.plan.warning)} />}
    <Space wrap>
      <Button loading={state.loading} disabled={state.busy} onClick={() => void replacingDraft(() => void state.load())}>{t('database_jobs.manage.load_sql')}</Button>
      {state.operation === 'edit' && state.snippets.length > 0 && <Select className="gn-job-snippets" placeholder={t('database_jobs.manage.snippets')} value={null}
        disabled={!state.plan || state.loading || state.busy || state.protectedConnection}
        options={state.snippets.map(s => ({ value: s.key, label: t(`database_jobs.manage.${s.key}`) }))}
        onChange={key => { const snippet = state.snippets.find(s => s.key === key); if (snippet) void replacingDraft(() => state.setSQL(snippet.sql)); }} />}
      <Button type="primary" danger={!state.readOnly} loading={state.busy}
        disabled={!state.plan || state.loading || (!state.readOnly && state.protectedConnection)} onClick={() => void state.submit()}>
        {t(state.readOnly ? 'database_jobs.manage.query' : 'database_jobs.manage.apply')}
      </Button>
      <Button disabled={state.busy} onClick={() => void replacingDraft(onClose)}>{t('common.close')}</Button>
    </Space>
    {state.error && <Alert type="error" showIcon message={state.error} />}
    {state.notice && <Alert type="success" showIcon message={state.notice} />}
    <div className="gn-job-sql">
      <Editor height="100%" language="sql" gonaviTypography="sql" theme={dark ? 'transparent-dark' : 'transparent-light'} value={state.sql}
        onChange={sql => state.setSQL(sql || '')} options={{ readOnly: state.readOnly || state.busy || state.loading || state.protectedConnection, minimap: { enabled: false }, automaticLayout: true, wordWrap: 'on' }} />
    </div>
    {state.readOnly && <Table size="small" columns={columns} dataSource={state.rows.map((r, i) => ({ ...r, __gonavi_row_key: i }))}
      rowKey="__gonavi_row_key" pagination={{ pageSize: 20 }} scroll={{ x: 'max-content', y: 250 }} />}
  </div>;
};
