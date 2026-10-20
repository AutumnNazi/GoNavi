import type { ConnectionConfig } from '../../types';
import { normalizeOceanBaseProtocol } from '../oceanBaseProtocol';

export type DatabaseJobDialect = 'oracle' | 'dm' | 'sqlserver' | 'postgres' | 'kingbase'
  | 'opengauss' | 'gaussdb' | 'oceanbase-oracle' | 'oceanbase-mysql' | 'doris' | 'starrocks';

const DIALECTS: Record<string, DatabaseJobDialect> = {
  oracle: 'oracle', godror: 'oracle', dm: 'dm', dameng: 'dm', dm8: 'dm',
  sqlserver: 'sqlserver', mssql: 'sqlserver',
  postgres: 'postgres', postgresql: 'postgres', pg: 'postgres', pgx: 'postgres', timescaledb: 'postgres',
  kingbase: 'kingbase', kingbase8: 'kingbase', kingbasees: 'kingbase', kingbasev8: 'kingbase',
  opengauss: 'opengauss', open_gauss: 'opengauss', 'open-gauss': 'opengauss',
  gaussdb: 'gaussdb', gauss_db: 'gaussdb', 'gauss-db': 'gaussdb',
  diros: 'doris', doris: 'doris', starrocks: 'starrocks',
};

export const resolveDatabaseJobDialect = (
  config: Pick<ConnectionConfig, 'type' | 'driver' | 'oceanBaseProtocol'> | undefined,
): DatabaseJobDialect | null => {
  const type = String(config?.type || '').trim().toLowerCase();
  const engine = type === 'custom' ? String(config?.driver || '').trim().toLowerCase() : type;
  if (engine === 'oceanbase') return normalizeOceanBaseProtocol(config?.oceanBaseProtocol) === 'oracle'
    ? 'oceanbase-oracle' : 'oceanbase-mysql';
  // Do not borrow a metadata dialect: wire compatibility does not imply scheduler compatibility.
  return DIALECTS[engine] || null;
};

export const usesSchemaScopedDatabaseJobs = (config: Parameters<typeof resolveDatabaseJobDialect>[0]): boolean => (
  ['oracle', 'dm', 'oceanbase-oracle'].includes(resolveDatabaseJobDialect(config) || '')
);
