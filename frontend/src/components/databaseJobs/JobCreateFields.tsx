import React from 'react';
import { Input, Select } from 'antd';
import { t } from '../../i18n';
import type { JobCreateInput, ManagedJobKind } from '../../utils/databaseJobs/jobManagementTypes';

export const JobCreateFields = ({ kind, input, onChange, disabled }: {
  kind: ManagedJobKind; input: JobCreateInput; onChange: (patch: Partial<JobCreateInput>) => void; disabled: boolean;
}) => {
  const text = (key: keyof JobCreateInput, label: string, multiline = false) => (
    <label className="gn-job-field" key={key}>
      <span>{t(label)}</span>
      {multiline ? <Input.TextArea value={input[key]} rows={3} disabled={disabled} onChange={e => onChange({ [key]: e.target.value })} />
        : <Input value={input[key]} disabled={disabled} onChange={e => onChange({ [key]: e.target.value })} />}
    </label>
  );
  return <div className="gn-job-create-fields">
    {text('name', 'database_jobs.field.job_name')}
    {kind === 'kingbase-scheduler' ? <>
      {text('program', 'database_jobs.field.program_name')}
      {text('scheduleName', 'database_jobs.field.schedule_name')}
    </> : <>
      {(kind === 'oracle-scheduler' || kind === 'oceanbase-oracle') && <label className="gn-job-field">
        <span>{t('database_jobs.field.job_type')}</span>
        <Select value={input.jobType} disabled={disabled} onChange={jobType => onChange({ jobType })} options={(kind === 'oracle-scheduler' ? ['PLSQL_BLOCK', 'STORED_PROCEDURE', 'EXECUTABLE', 'CHAIN'] : ['PLSQL_BLOCK', 'STORED_PROCEDURE']).map(v => ({ value: v, label: v }))} />
      </label>}
      {text('action', 'database_jobs.definition.action', true)}
      {!['sqlserver-agent', 'pgagent', 'dm-agent', 'starrocks-task'].includes(kind) && text('schedule', 'database_jobs.field.repeat_interval')}
    </>}
  </div>;
};
