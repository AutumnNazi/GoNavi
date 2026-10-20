import type { DatabaseJobKind } from '../../typeDefs/databaseJobTypes';
import type { DatabaseJobChildQueries, DatabaseJobQueryGroup } from './jobQueryTypes';
import { postgresJobListQueries, postgresJobDefinitionQueries, pgAgentChildQueries, kingbaseJobListQueries, kingbaseJobDefinitionQueries } from './jobPostgresQueries';
import { gaussJobListQueries, gaussJobDefinitionQueries, gaussJobChildQueries, sqlServerJobListQueries, sqlServerJobDefinitionQueries, sqlServerJobChildQueries } from './jobNativeQueries';
import { distributedJobListQueries, distributedJobDefinitionQueries, oceanBaseJobListQueries, oceanBaseJobDefinitionQueries } from './jobDistributedQueries';

export const extendedJobListQueries = (dialect: string, database: string): DatabaseJobQueryGroup[] => {
  if (dialect === 'postgres') return postgresJobListQueries();
  if (dialect === 'kingbase') return kingbaseJobListQueries();
  if (dialect === 'sqlserver') return sqlServerJobListQueries(database);
  if (dialect === 'opengauss' || dialect === 'gaussdb') return gaussJobListQueries(`${dialect}-job`);
  if (dialect === 'oceanbase-oracle' || dialect === 'oceanbase-mysql') return oceanBaseJobListQueries(dialect === 'oceanbase-oracle', database);
  return distributedJobListQueries(dialect, database);
};

export const extendedJobDefinitionQueries = (
  dialect: string, kind: DatabaseJobKind, owner: string, name: string, database: string,
): string[] => {
  if (dialect === 'postgres') return postgresJobDefinitionQueries(kind, name);
  if (dialect === 'kingbase' && kind === 'kingbase-scheduler') return kingbaseJobDefinitionQueries(name);
  if (dialect === 'sqlserver' && kind === 'sqlserver-agent' && database.toLowerCase() === 'msdb') return sqlServerJobDefinitionQueries(name);
  if ((dialect === 'opengauss' || dialect === 'gaussdb') && kind === `${dialect}-job`) return gaussJobDefinitionQueries(kind, name);
  if ((dialect === 'oceanbase-oracle' || dialect === 'oceanbase-mysql') && kind === dialect) return oceanBaseJobDefinitionQueries(dialect === 'oceanbase-oracle', owner, name);
  if ((dialect === 'doris' && kind === 'doris-job') || (dialect === 'starrocks' && kind === 'starrocks-task')) return distributedJobDefinitionQueries(kind, database, name);
  return [];
};

export const extendedJobChildQueries = (kind: DatabaseJobKind, name: string): DatabaseJobChildQueries => {
  if (kind === 'pgagent') return pgAgentChildQueries(name);
  if (kind === 'sqlserver-agent') return sqlServerJobChildQueries(name);
  if (kind === 'opengauss-job' || kind === 'gaussdb-job') return gaussJobChildQueries(name);
  return {};
};
