import type { JobCreateInput, JobOperation, JobSnapshot, JobSQLPlan, JobTarget } from './jobManagementTypes';
import { mysqlName, mysqlText, required } from './jobManagementSQL';

export const eventMetadataSQL = (target: JobTarget): string => `SELECT EVENT_NAME AS job_name, STATUS AS enabled, EVENT_DEFINITION AS action, DEFINER, TIME_ZONE, SQL_MODE, @@session.time_zone AS session_time_zone, @@session.sql_mode AS session_sql_mode, EVENT_TYPE, EXECUTE_AT, INTERVAL_VALUE, INTERVAL_FIELD, STARTS, ENDS, ON_COMPLETION, LAST_EXECUTED, EVENT_COMMENT FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ${mysqlText(target.database)} AND EVENT_NAME = ${mysqlText(target.name)}`;
export const eventShowCreateSQL = (target: JobTarget): string => `SHOW CREATE EVENT ${mysqlName(target.database)}.${mysqlName(target.name)}`;

export const eventManagementPlan = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): JobSQLPlan => {
  if (target.dialect !== 'mysql' && target.dialect !== 'mariadb') throw new Error('database_jobs.manage.no_native_operation');
  const name = `${mysqlName(target.database)}.${mysqlName(operation === 'create' ? input.name : target.name)}`;
  let sql = '';
  if (operation === 'create') sql = `CREATE EVENT ${name}\nON SCHEDULE ${input.schedule || 'EVERY 1 DAY'}\nON COMPLETION PRESERVE\nDISABLE\nDO\n${input.action};`;
  if (operation === 'drop') sql = `DROP EVENT ${name};`;
  if (operation === 'status') sql = eventMetadataSQL(target);
  if (operation === 'edit' || operation === 'enable' || operation === 'disable') {
    assertEventSessionMatches(snapshot);
    const ddl = String(required(snapshot.job, 'create_event'));
    // Retain SHOW CREATE's quoted account rather than splitting user@host ambiguously.
    const account = '(?:`(?:``|[^`])*`|\'(?:\'\'|\\\\.|[^\'])*\')';
    const definer = ddl.match(new RegExp(`^\\s*CREATE\\s+(DEFINER\\s*=\\s*${account}\\s*@\\s*${account})\\s+EVENT\\b`, 'i'));
    if (!definer) throw new Error('database_jobs.manage.incomplete_metadata');
    sql = operation === 'edit' ? ddl.replace(/^\s*CREATE\b/i, 'ALTER') : `ALTER ${definer[1]} EVENT ${name} ${operation.toUpperCase()};`;
  }
  if (!sql) throw new Error('database_jobs.manage.no_native_operation');
  return { sql, readOnly: operation === 'status', warning: operation === 'status' ? undefined : 'database_jobs.manage.event_scope' };
};

const assertEventSessionMatches = (snapshot: JobSnapshot): void => {
  // ALTER captures the current SQL mode and interprets ON SCHEDULE in the session's time zone.
  // Never silently change those semantics or leak SET SESSION changes into a pooled connection.
  const mode = (key: string) => String(required(snapshot.job, key)).toUpperCase().split(',').map(v => v.trim()).sort().join(',');
  const zone = (key: string) => String(required(snapshot.job, key)).trim();
  if (mode('sql_mode') !== mode('session_sql_mode') || zone('time_zone') !== zone('session_time_zone')) {
    throw new Error('database_jobs.manage.event_session_mismatch');
  }
};
