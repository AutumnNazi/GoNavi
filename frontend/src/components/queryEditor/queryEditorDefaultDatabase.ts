import { isElasticsearchConnection } from '../../utils/elasticsearchConsole';
import { isConnectionScopedQueryEditorMetadata } from './queryEditorLazyTablesCache';

export interface DefaultDatabaseSelectionInput {
  config?: {
    type?: unknown;
    driver?: unknown;
    oceanBaseProtocol?: unknown;
  } | null;
  currentDb?: unknown;
  databaseNames?: readonly unknown[];
}

// 新建查询拿到库列表后，若当前没有选中库，则默认选中列表里的第一个。
//
// 只在列表加载完成时补一次默认值：调用点持有的列表与连接是同一份，避免用上一个连接的
// 库去回填。Elasticsearch 的库位是可选索引、SQLite 的元数据本就与库无关，两者保持不选。
export const resolveDefaultQueryEditorDatabase = ({
  config,
  currentDb,
  databaseNames,
}: DefaultDatabaseSelectionInput): string => {
  if (!config) return '';
  if (String(currentDb ?? '').trim()) return '';
  if (isElasticsearchConnection(config)) return '';
  if (isConnectionScopedQueryEditorMetadata({ config })) return '';

  const names = Array.isArray(databaseNames) ? databaseNames : [];
  for (const name of names) {
    const normalized = String(name ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
};
