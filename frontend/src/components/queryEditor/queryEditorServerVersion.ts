import type { ConnectionConfig } from '../../types';
import { useStore } from '../../store';
import { DBGetServerVersion } from '../../../wailsjs/go/app/App';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';

type VersionResult = {
  success?: boolean;
  message?: string;
  data?: unknown;
};

type VersionQueryConfig = ConnectionConfig | Partial<ConnectionConfig>;

type VersionQuery = (config: VersionQueryConfig) => Promise<VersionResult>;

const versions = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const defaultVersionQuery: VersionQuery = async (config) => {
  if (typeof DBGetServerVersion !== 'function') {
    return { success: false };
  }
  return DBGetServerVersion(buildRpcConnectionConfig(config));
};

let versionQuery: VersionQuery = defaultVersionQuery;

const parseServerVersion = (result: VersionResult | null | undefined): string => {
  if (!result?.success) {
    return '';
  }
  const message = String(result.message || '').trim();
  if (message) {
    return message;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const row = rows[0];
  if (!row || typeof row !== 'object') {
    return '';
  }
  const record = row as Record<string, unknown>;
  return String(record.version ?? record.Version ?? '').trim();
};

export const setDatabaseServerVersionQuery = (query?: VersionQuery | null): void => {
  versionQuery = query || defaultVersionQuery;
};

export const peekDatabaseServerVersion = (connectionId?: string | null): string => (
  versions.get(String(connectionId || '').trim()) || ''
);

export const buildSqlDialectConstraint = (version?: string | null): string => {
  const trimmed = String(version || '').trim();
  if (trimmed) {
    return `Live database server version: ${trimmed}. Use only SQL syntax and functions this version already supports; do not emit newer-version SQL.`;
  }
  return 'Live database server version is unknown. Stay on a conservative dialect baseline; do not assume the newest SQL features.';
};

export const resetDatabaseServerVersionCache = (): void => {
  versions.clear();
  inflight.clear();
};

export const ensureDatabaseServerVersion = async (
  connection?: {
    id?: string;
    config?: VersionQueryConfig | null;
  } | null,
): Promise<string> => {
  const connectionId = String(connection?.id || '').trim();
  const config = connection?.config;
  if (!connectionId || !config) {
    return '';
  }
  const cached = versions.get(connectionId);
  if (cached !== undefined) {
    return cached;
  }
  const pending = inflight.get(connectionId);
  if (pending) {
    return pending;
  }
  const request = (async () => {
    try {
      const result = await versionQuery(config);
      const version = parseServerVersion(result);
      if (result?.success) versions.set(connectionId, version);
      return version;
    } catch {
      return '';
    } finally {
      inflight.delete(connectionId);
    }
  })();
  inflight.set(connectionId, request);
  return request;
};

export const ensureDatabaseServerVersionById = async (connectionId?: string | null): Promise<string> => {
  const id = String(connectionId || '').trim();
  if (!id) {
    return '';
  }
  const cached = versions.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const connection = useStore.getState().connections?.find((item) => item.id === id);
  return ensureDatabaseServerVersion(connection);
};

export const ensureQueryEditorAiContextServerVersion = async <T extends {
  connectionId?: string;
  databaseVersion?: string;
}>(context: T): Promise<T> => {
  if (String(context.databaseVersion || '').trim()) {
    return context;
  }
  const version = await ensureDatabaseServerVersionById(context.connectionId);
  if (!version) {
    return context;
  }
  return { ...context, databaseVersion: version };
};
