import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeDatabaseNames } from '../../sidebar/databaseSchemaVisibility';
import { normalizeTableNamesFromMetadataRows } from '../../../utils/tableMetadataRows';
import type { RpcConnectionConfig } from '../../../utils/connectionRpcConfig';
import type { UserManagementBackend } from '../userManagementRpc';

const columnNames = (data: unknown): string[] => (Array.isArray(data) ? data : [])
  .map((row) => (row && typeof row === 'object' ? String((row as Record<string, unknown>).name || '') : String(row || '')))
  .filter(Boolean);

/**
 * 懒加载库/表/列清单并按键缓存，供对象权限树与库选择器复用。
 * 走已有的元数据绑定，不为用户管理新增元数据 RPC。
 */
export const useObjectCatalog = (backend: UserManagementBackend, config: RpcConnectionConfig | null, enabled: boolean) => {
  const [databases, setDatabases] = useState<string[]>([]);
  const cache = useRef(new Map<string, string[]>());

  useEffect(() => {
    cache.current.clear();
    if (!enabled || !config || typeof backend.DBGetDatabases !== 'function') {
      setDatabases([]);
      return;
    }
    let alive = true;
    backend.DBGetDatabases(config).then((result) => {
      if (alive && result?.success !== false) setDatabases(normalizeDatabaseNames(Array.isArray(result?.data) ? result.data : []));
    }).catch(() => {
      if (alive) setDatabases([]);
    });
    return () => { alive = false; };
  }, [backend, config, enabled]);

  const loadTables = useCallback(async (database: string): Promise<string[]> => {
    const key = `t:${database}`;
    const cached = cache.current.get(key);
    if (cached) return cached;
    if (!config || typeof backend.DBGetTables !== 'function') return [];
    const result = await backend.DBGetTables(config, database);
    const names = result?.success === false ? [] : normalizeTableNamesFromMetadataRows(result?.data);
    cache.current.set(key, names);
    return names;
  }, [backend, config]);

  const loadColumns = useCallback(async (database: string, table: string): Promise<string[]> => {
    const key = `c:${database}\u001f${table}`;
    const cached = cache.current.get(key);
    if (cached) return cached;
    if (!config || typeof backend.DBGetColumns !== 'function') return [];
    const result = await backend.DBGetColumns(config, database, table);
    const names = result?.success === false ? [] : columnNames(result?.data);
    cache.current.set(key, names);
    return names;
  }, [backend, config]);

  return { databases, loadTables, loadColumns };
};
