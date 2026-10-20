import type { JobCreateInput, JobOperation, JobSnapshot, JobTarget } from './jobManagementTypes';
import { mysqlName, mysqlText, required, sqlText } from './jobManagementSQL';

export const distributedManagementSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  if (target.kind === 'oceanbase-mysql') {
    const name = mysqlText(target.name);
    if (operation === 'enable' || operation === 'disable') return `CALL DBMS_SCHEDULER.${operation.toUpperCase()}(${name});`;
    if (operation === 'edit') return `CALL DBMS_SCHEDULER.SET_ATTRIBUTE(${name}, 'max_run_duration', '__GONAVI_VALUE__');`;
    return '';
  }
  if (target.kind === 'starrocks-task') {
    const name = `${mysqlName(target.database)}.${mysqlName(operation === 'create' ? input.name : target.name)}`;
    if (operation === 'create') return `SUBMIT TASK ${name}\nSCHEDULE EVERY(INTERVAL 1 DAY)\nAS\n${input.action};`;
    if (operation === 'drop') return `DROP TASK ${name};`;
    if (operation === 'enable' || operation === 'disable') return `ALTER TASK ${name} ${operation === 'enable' ? 'RESUME' : 'SUSPEND'};`;
    // Native ALTER TASK changes properties, not SQL or the schedule. The user explicitly supplies the property.
    if (operation === 'edit') return `ALTER TASK ${name} SET ('__GONAVI_PROPERTY__' = '__GONAVI_VALUE__');`;
    return '';
  }
  if (target.kind === 'doris-job') {
    if (operation === 'create') return `CREATE JOB ${mysqlName(input.name)}\nON SCHEDULE ${input.schedule || 'EVERY 1 DAY'}\nDO\n${input.action};`;
    const label = String(required(snapshot.job, 'job_label'));
    // Doris requires a string literal in this grammar, not a general HEX expression.
    if (/[\\\0]/.test(label)) throw new Error('database_jobs.manage.invalid_identity');
    const command = { enable: 'RESUME', disable: 'PAUSE', drop: 'DROP' }[operation as 'enable' | 'disable' | 'drop'];
    return command ? `${command} JOB WHERE jobName = ${sqlText(label)};` : '';
  }
  return '';
};

export const starRocksSupportsAlterTask = (version: string): boolean => {
  const match = version.match(/(?:^|[^\d])(\d+)\.(\d+)\./);
  return Boolean(match && (Number(match[1]) > 4 || (Number(match[1]) === 4 && Number(match[2]) >= 1)));
};
