import type { JobTarget } from './jobManagementTypes';
import { guid, mysqlText, numericID, pgBlock, pgText, plBlock, qualifiedJob, sqlText } from './jobManagementSQL';
import { sqlServerBatch } from './jobSqlServerManagement';

export type JobSnippet = { key: string; sql: string };

/** Each snippet is a complete, single-session command; unresolved fields cannot be submitted. */
export const jobManagementSnippets = (target: JobTarget): JobSnippet[] => {
  const name = sqlText(target.name);
  if (target.kind === 'dm-agent') {
    const wrap = (s: string) => plBlock([`SP_JOB_CONFIG_START(${name})`, s, `SP_JOB_CONFIG_COMMIT(${name})`]);
    return [
      { key: 'add_step', sql: wrap(`SP_ADD_JOB_STEP(${name}, '__GONAVI_STEP_NAME__', 0, '__GONAVI_ACTION__', 0, 0, 0, 0, NULL, 0)`) },
      { key: 'drop_step', sql: wrap(`SP_DROP_JOB_STEP(${name}, '__GONAVI_STEP_NAME__')`) },
      { key: 'add_schedule', sql: wrap(`SP_ADD_JOB_SCHEDULE(${name}, '__GONAVI_SCHEDULE_NAME__', 1, 1, 1, 0, 0, '00:00:00', '23:59:59', TO_CHAR(SYSDATE, 'YYYY-MM-DD'), NULL, '')`) },
      { key: 'drop_schedule', sql: wrap(`SP_DROP_JOB_SCHEDULE(${name}, '__GONAVI_SCHEDULE_NAME__')`) },
      { key: 'rename', sql: plBlock([`SP_RENAME_JOB(${name}, '__GONAVI_NEW_NAME__')`]) },
    ];
  }
  if (target.kind === 'sqlserver-agent') {
    const id = guid(target.name);
    return [
      { key: 'add_step', sql: sqlServerBatch([`msdb.dbo.sp_add_jobstep @job_id=${id}, @step_name=N'__GONAVI_STEP_NAME__', @subsystem=N'TSQL', @command=N'__GONAVI_ACTION__', @database_name=N'__GONAVI_DATABASE__'`]) },
      { key: 'drop_step', sql: sqlServerBatch([`msdb.dbo.sp_delete_jobstep @job_id=${id}, @step_id=__GONAVI_STEP_ID__`]) },
      { key: 'add_schedule', sql: sqlServerBatch([`msdb.dbo.sp_add_jobschedule @job_id=${id}, @name=N'__GONAVI_SCHEDULE_NAME__', @freq_type=4, @freq_interval=1, @active_start_time=0`]) },
      { key: 'drop_schedule', sql: sqlServerBatch([`msdb.dbo.sp_detach_schedule @job_id=${id}, @schedule_id=__GONAVI_SCHEDULE_ID__, @delete_unused_schedule=0`]) },
    ];
  }
  if (target.kind === 'pgagent') {
    const id = numericID(target.name);
    return [
      { key: 'add_step', sql: `INSERT INTO pgagent.pga_jobstep (jstjobid, jstname, jstkind, jstcode, jstdbname) VALUES (${id}, '__GONAVI_STEP_NAME__', 's', '__GONAVI_ACTION__', ${pgText(target.database)});` },
      { key: 'drop_step', sql: `DELETE FROM pgagent.pga_jobstep WHERE jstjobid=${id} AND jstid=__GONAVI_STEP_ID__;` },
      { key: 'add_schedule', sql: `INSERT INTO pgagent.pga_schedule (jscjobid, jscname, jscminutes, jschours, jscweekdays, jscmonthdays, jscmonths) VALUES (${id}, '__GONAVI_SCHEDULE_NAME__', ARRAY[TRUE] || array_fill(FALSE, ARRAY[59]), array_fill(TRUE, ARRAY[24]), array_fill(TRUE, ARRAY[7]), array_fill(TRUE, ARRAY[32]), array_fill(TRUE, ARRAY[12]));` },
      { key: 'drop_schedule', sql: `DELETE FROM pgagent.pga_schedule WHERE jscjobid=${id} AND jscid=__GONAVI_SCHEDULE_ID__;` },
      { key: 'add_exception', sql: `INSERT INTO pgagent.pga_exception (jexscid, jexdate, jextime) SELECT jscid, '__GONAVI_DATE__'::date, NULL FROM pgagent.pga_schedule WHERE jscjobid=${id} AND jscid=__GONAVI_SCHEDULE_ID__;` },
      { key: 'drop_exception', sql: `DELETE FROM pgagent.pga_exception WHERE jexid=__GONAVI_EXCEPTION_ID__ AND jexscid IN (SELECT jscid FROM pgagent.pga_schedule WHERE jscjobid=${id});` },
    ];
  }
  if (target.kind === 'oracle-scheduler') return [
    { key: 'attribute', sql: plBlock([`DBMS_SCHEDULER.SET_ATTRIBUTE(${qualifiedJob(target.owner, target.name)}, '__GONAVI_ATTRIBUTE__', '__GONAVI_VALUE__')`]) },
    { key: 'argument', sql: plBlock([`DBMS_SCHEDULER.SET_JOB_ARGUMENT_VALUE(${qualifiedJob(target.owner, target.name)}, __GONAVI_POSITION__, '__GONAVI_VALUE__')`]) },
  ];
  if (target.kind === 'oceanbase-oracle') return [{ key: 'attribute', sql: plBlock([`DBMS_SCHEDULER.SET_ATTRIBUTE(${name}, '__GONAVI_ATTRIBUTE__', '__GONAVI_VALUE__')`]) }];
  if (target.kind === 'oceanbase-mysql') return [{ key: 'attribute', sql: `CALL DBMS_SCHEDULER.SET_ATTRIBUTE(${mysqlText(target.name)}, '__GONAVI_ATTRIBUTE__', '__GONAVI_VALUE__');` }];
  if (target.kind === 'dbms-job') return [{ key: 'next_run', sql: plBlock([`DBMS_JOB.NEXT_DATE(${numericID(target.name)}, TO_DATE('__GONAVI_DATE__', 'YYYY-MM-DD HH24:MI:SS'))`, 'COMMIT']) }];
  if (target.kind === 'pg-cron') return [{ key: 'attribute', sql: pgBlock([`PERFORM cron.alter_job(${numericID(target.name)}, schedule := '__GONAVI_SCHEDULE__', command := '__GONAVI_ACTION__', database := ${pgText(target.database)}, username := '__GONAVI_USERNAME__', active := FALSE)`]) }];
  return [];
};
