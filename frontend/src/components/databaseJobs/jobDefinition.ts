import type { DatabaseJobKind, DatabaseJobRow } from '../../typeDefs/databaseJobTypes';
import { readDatabaseJobText } from '../../utils/databaseJobs/jobMetadata';

export type JobDefinitionTranslate = (key: string, vars?: Record<string, string | number>) => string;

const FIELD_KEYS = new Set([
  'schema_name', 'job_name', 'job_label', 'owner', 'job_id', 'job_type', 'program_owner', 'program_name',
  'number_of_arguments', 'schedule_owner', 'schedule_name', 'repeat_interval',
  'start_date', 'end_date', 'enabled', 'state', 'next_run_at', 'last_start_date',
  'last_run_duration', 'run_count', 'failure_count', 'comments', 'broken',
  'create_time', 'step_id', 'step_sequence', 'step_name', 'step_type', 'database_name', 'success_action',
  'failure_action', 'retry_attempts', 'retry_interval',
]);

const comment = (value: string): string => value.replace(/\r\n/g, '\n').split('\n').map((line) => `-- ${line}`).join('\n');

const formatProperties = (row: DatabaseJobRow, translate: JobDefinitionTranslate): string => (
  Object.entries(row).filter(([key, value]) => (
    key.toLowerCase() !== 'action' && value !== undefined && value !== null
  )).map(([key, value]) => {
    const name = key.toLowerCase();
    const label = FIELD_KEYS.has(name) ? translate(`database_jobs.field.${name}`) : key;
    return comment(`${label}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  }).join('\n')
);

export const formatDatabaseJobDefinition = (
  kind: DatabaseJobKind,
  job: DatabaseJobRow,
  steps: DatabaseJobRow[],
  schedules: DatabaseJobRow[],
  program: DatabaseJobRow | undefined,
  translate: JobDefinitionTranslate,
): string => {
  const sections = [
    comment(translate('database_jobs.definition.catalog_header')),
    comment(translate(`database_jobs.source.${kind}`)),
    formatProperties(job, translate),
  ];
  if (program) {
    sections.push(comment(translate('database_jobs.definition.program')), formatProperties(program, translate));
  }
  schedules.forEach((schedule, index) => {
    sections.push(comment(translate('database_jobs.definition.schedule', { index: index + 1 })), formatProperties(schedule, translate));
  });
  const action = readDatabaseJobText(job, 'action') || (program ? readDatabaseJobText(program, 'action') : '');
  if (action) sections.push(comment(translate('database_jobs.definition.action')), action);
  steps.forEach((step, index) => {
    sections.push(
      comment(translate('database_jobs.definition.step', { index: index + 1 })),
      formatProperties(step, translate),
      readDatabaseJobText(step, 'action'),
    );
  });
  return sections.filter((section) => section !== '').join('\n\n');
};
