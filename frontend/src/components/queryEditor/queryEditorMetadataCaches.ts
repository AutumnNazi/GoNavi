import type { ColumnDefinition } from '../../types';
import { buildMetadataIdentityKey } from '../../utils/metadataIdentity';
import type { CompletionTableMeta } from './QueryEditorHelpers';
import { normalizeMetadataDialect } from './QueryEditorHelpers';
import { BoundedQueryEditorMetadataCache, type QueryEditorMetadataCacheScope } from './queryEditorMetadataCache';
import { cancelQueryEditorMetadataRequests } from './queryEditorMetadataRequests';

const CACHE_TTL_MS = 5 * 60 * 1_000;

export const queryEditorLazyTablesCache = new BoundedQueryEditorMetadataCache<CompletionTableMeta[]>({
  maxEntries: 48,
  maxEntriesPerConnection: 12,
  maxBytes: 8 * 1024 * 1024,
  ttlMs: CACHE_TTL_MS,
});

export const queryEditorColumnsCache = new BoundedQueryEditorMetadataCache<ColumnDefinition[]>({
  maxEntries: 512,
  maxEntriesPerConnection: 128,
  maxBytes: 16 * 1024 * 1024,
  ttlMs: CACHE_TTL_MS,
});

export const buildQueryEditorLazyTablesCacheKey = (
  connectionId: string,
  dbName: string,
  metadataDialect = '',
): string => `${String(connectionId || '').trim()}|${buildMetadataIdentityKey(metadataDialect, dbName)}`;

export const buildQueryEditorMetadataDatabaseKey = (
  connections: Array<{ id: string; config?: unknown }>,
  connectionId: string,
  dbName: string,
): string => buildMetadataIdentityKey(
  normalizeMetadataDialect(connections.find((connection) => connection.id === connectionId)),
  dbName,
);

export const invalidateQueryEditorMetadataCaches = (
  connectionId: string,
  databaseKey?: string,
): void => {
  queryEditorLazyTablesCache.invalidate(connectionId, databaseKey);
  queryEditorColumnsCache.invalidate(connectionId, databaseKey);
  cancelQueryEditorMetadataRequests(connectionId, databaseKey);
};

export const clearQueryEditorMetadataCaches = (): void => {
  queryEditorLazyTablesCache.clear();
  queryEditorColumnsCache.clear();
};

/** Scope key for one cache entry: which connection/database it belongs to. */
export const buildQueryEditorMetadataCacheScope = (
  connectionId: string,
  databaseKey: string,
): QueryEditorMetadataCacheScope => ({
  connectionId: String(connectionId || '').trim(),
  databaseKey: String(databaseKey || '').trim(),
});
