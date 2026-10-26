import { isElasticsearchConnection } from '../../utils/elasticsearchConsole';
import { isConnectionScopedQueryEditorMetadata } from './queryEditorLazyTablesCache';

export interface DefaultDatabaseSelectionInput {
  config?: {
    type?: unknown;
    driver?: unknown;
    oceanBaseProtocol?: unknown;
    database?: unknown;
  } | null;
  currentDb?: unknown;
  databaseNames?: readonly unknown[];
}

// 新建查询拿到库列表后，若当前没有选中库，则优先使用连接配置中的库。
//
// 系统库不能作为用户查询的隐式目标；没有配置库时跳过它们，避免异步列表返回后
// 查询编辑器悄悄切到 information_schema 等系统库。Elasticsearch 的库位是可选索引、
// SQLite 的元数据本就与库无关，两者保持不选。
export const resolveDefaultQueryEditorDatabase = ({
  config,
  currentDb,
  databaseNames,
}: DefaultDatabaseSelectionInput): string => {
  if (!config) return '';
  if (String(currentDb ?? '').trim()) return '';
  if (isElasticsearchConnection(config)) return '';
  if (isConnectionScopedQueryEditorMetadata({ config })) return '';

  const names = (Array.isArray(databaseNames) ? databaseNames : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean);
  const configured = String(config.database ?? '').trim();
  if (configured) {
    const configuredMatch = names.find((name) => name.toLowerCase() === configured.toLowerCase());
    if (configuredMatch) return configuredMatch;
  }
  const systemDatabases = new Set([
    'information_schema', 'mysql', 'performance_schema', 'sys',
    'system', 'pg_catalog', 'pg_toast',
  ]);
  return names.find((name) => !systemDatabases.has(name.toLowerCase())) || '';
};
