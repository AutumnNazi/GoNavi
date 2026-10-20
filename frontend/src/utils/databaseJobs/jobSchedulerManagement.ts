import type { JobCreateInput, JobOperation, JobSnapshot, JobTarget } from './jobManagementTypes';
import { numericID, pgText, plBlock, qualifiedJob, required, sqlText, value } from './jobManagementSQL';

const schedulerName = (target: JobTarget) => qualifiedJob(target.owner, target.name);

export const schedulerManagementSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  if (target.kind === 'dbms-job') return legacyJobSQL(target, operation, snapshot, input);
  if (target.kind === 'kingbase-scheduler') return kingbaseJobSQL(target, operation, input);
  if (target.kind === 'oceanbase-oracle') return oceanBaseOracleSQL(target, operation, input);
  const name = schedulerName(target);
  if (operation === 'create') return plBlock([
    `DBMS_SCHEDULER.CREATE_JOB(job_name => ${qualifiedJob(target.owner, input.name)}, job_type => ${sqlText(input.jobType || 'PLSQL_BLOCK')}, job_action => ${sqlText(input.action)}, start_date => SYSTIMESTAMP, repeat_interval => ${sqlText(input.schedule || null)}, enabled => FALSE, auto_drop => FALSE)`,
  ]);
  const procedures: Partial<Record<JobOperation, string>> = {
    enable: `DBMS_SCHEDULER.ENABLE(${name})`, disable: `DBMS_SCHEDULER.DISABLE(${name}, FALSE)`,
    run: `DBMS_SCHEDULER.RUN_JOB(${name}, FALSE)`, stop: `DBMS_SCHEDULER.STOP_JOB(${name}, FALSE)`,
    drop: `DBMS_SCHEDULER.DROP_JOB(${name}, FALSE)`,
  };
  if (procedures[operation]) return plBlock([procedures[operation]!]);
  if (operation !== 'edit') return '';
  const attributes = ['job_type', 'comments', 'repeat_interval'];
  const program = value(snapshot.job, 'program_name');
  if (!program) attributes.push('action');
  else attributes.splice(0, 1); // A referenced program owns its type and action.
  if (value(snapshot.job, 'schedule_name')) attributes.splice(attributes.indexOf('repeat_interval'), 1);
  const statements = attributes.filter(key => value(snapshot.job, key) !== undefined).map(key => {
    const field = key === 'action' ? 'job_action' : key;
    const v = value(snapshot.job, key);
    return v == null || v === ''
      ? `DBMS_SCHEDULER.SET_ATTRIBUTE_NULL(${name}, ${sqlText(field)})`
      : `DBMS_SCHEDULER.SET_ATTRIBUTE(${name}, ${sqlText(field)}, ${sqlText(v)})`;
  });
  // Never inline a referenced program's SQL into this job or change a shared schedule implicitly.
  for (const kind of ['program', 'schedule']) {
    const ref = value(snapshot.job, `${kind}_name`);
    if (ref) statements.push(`DBMS_SCHEDULER.SET_ATTRIBUTE(${name}, '${kind}_name', ${qualifiedJob(String(value(snapshot.job, `${kind}_owner`) || target.owner), String(ref))})`);
  }
  if (!statements.length) throw new Error('database_jobs.manage.incomplete_metadata');
  return plBlock(statements);
};

const legacyJobSQL = (target: JobTarget, operation: JobOperation, snapshot: JobSnapshot, input: JobCreateInput): string => {
  if (operation === 'create') return `DECLARE\n  job_id ${target.dialect === 'dm' ? 'INTEGER' : 'BINARY_INTEGER'};\nBEGIN\n${target.owner ? `  IF USER <> ${sqlText(target.owner)} THEN RAISE_APPLICATION_ERROR(-20001, 'Create the job with its owner login'); END IF;\n` : ''}  DBMS_JOB.SUBMIT(job_id, ${sqlText(input.action)}, SYSDATE + 1, ${sqlText(input.schedule || 'null')});\n  DBMS_JOB.BROKEN(job_id, TRUE);\n  COMMIT;\nEND;`;
  const id = numericID(target.name);
  const statements: Partial<Record<JobOperation, string>> = {
    drop: `DBMS_JOB.REMOVE(${id})`, run: `DBMS_JOB.RUN(${id})`,
    disable: `DBMS_JOB.BROKEN(${id}, TRUE)`, enable: `DBMS_JOB.BROKEN(${id}, FALSE, SYSDATE)`,
  };
  if (operation === 'edit') return plBlock([
    `DBMS_JOB.WHAT(${id}, ${sqlText(required(snapshot.job, 'action'))})`,
    `DBMS_JOB.INTERVAL(${id}, ${sqlText(required(snapshot.job, 'repeat_interval'))})`, 'COMMIT',
  ]);
  return statements[operation] ? plBlock([statements[operation]!, 'COMMIT']) : '';
};

const kingbaseJobSQL = (target: JobTarget, operation: JobOperation, input: JobCreateInput): string => {
  const name = pgText(target.name);
  if (operation === 'create') {
    if (!input.program.trim() || !input.scheduleName.trim()) throw new Error('database_jobs.manage.references_required');
    return `CALL DBMS_SCHEDULER.CREATE_JOB(${pgText(input.name)}, ${pgText(input.program)}, ${pgText(input.scheduleName)}, 'Routine Maintenance', FALSE, TRUE, NULL);`;
  }
  const procedures: Partial<Record<JobOperation, string>> = {
    drop: 'DROP_JOB', enable: 'ENABLE', disable: 'DISABLE', run: 'RUN_JOB',
  };
  return procedures[operation] ? `CALL DBMS_SCHEDULER.${procedures[operation]}(${name});` : '';
};

const oceanBaseOracleSQL = (target: JobTarget, operation: JobOperation, input: JobCreateInput): string => {
  // OceanBase identifies jobs tenant-wide by their native name; quoted Oracle schema.name is rejected.
  const name = sqlText(operation === 'create' ? input.name : target.name);
  if (operation === 'create') return plBlock([
    ...(target.owner ? [`IF USER <> ${sqlText(target.owner)} THEN RAISE_APPLICATION_ERROR(-20001, 'Create the job with its owner login'); END IF`] : []),
    `DBMS_SCHEDULER.CREATE_JOB(job_name => ${name}, job_type => ${sqlText(input.jobType)}, job_action => ${sqlText(input.action)}, start_date => SYSTIMESTAMP, repeat_interval => ${sqlText(input.schedule || null)}, enabled => FALSE, auto_drop => FALSE)`,
  ]);
  const procedures: Partial<Record<JobOperation, string>> = {
    enable: `DBMS_SCHEDULER.ENABLE(${name})`, disable: `DBMS_SCHEDULER.DISABLE(${name}, FALSE)`,
    run: `DBMS_SCHEDULER.RUN_JOB(${name}, FALSE)`, stop: `DBMS_SCHEDULER.STOP_JOB(${name}, FALSE)`,
    drop: `DBMS_SCHEDULER.DROP_JOB(${name}, FALSE)`,
    edit: `DBMS_SCHEDULER.SET_ATTRIBUTE(${name}, 'max_run_duration', '__GONAVI_VALUE__')`,
  };
  return procedures[operation] ? plBlock([procedures[operation]!]) : '';
};
