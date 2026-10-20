export const DATABASE_JOB_KINDS = [
  'oracle-scheduler', 'dbms-job', 'dm-agent', 'sqlserver-agent',
  'pg-cron', 'pgagent', 'kingbase-scheduler', 'opengauss-job', 'gaussdb-job',
  'oceanbase-oracle', 'oceanbase-mysql', 'doris-job', 'starrocks-task',
] as const;

export type DatabaseJobKind = typeof DATABASE_JOB_KINDS[number];

export const isDatabaseJobKind = (value: unknown): value is DatabaseJobKind => (
  typeof value === 'string' && DATABASE_JOB_KINDS.some((kind) => kind === value)
);

export const isSchemaScopedJobKind = (kind?: DatabaseJobKind): boolean => (
  kind === 'oracle-scheduler' || kind === 'dbms-job' || kind === 'dm-agent' || kind === 'oceanbase-oracle'
);

export type DatabaseJobEntry = {
  jobName: string;
  /** Display label; jobName remains the stable catalog identity for ID-based providers. */
  jobLabel?: string;
  schemaName: string;
  jobKind: DatabaseJobKind;
  enabled?: string;
  state?: string;
  nextRunAt?: string;
};

export type DatabaseJobRow = Record<string, unknown>;

export type DatabaseJobQueryResult = {
  success: boolean;
  data?: unknown;
  message?: string;
};

export type DatabaseJobQueryExecutor = (sql: string) => Promise<DatabaseJobQueryResult>;
