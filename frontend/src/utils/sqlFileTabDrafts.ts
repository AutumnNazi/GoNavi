import type { TabData } from '../types';

const drafts = new Map<string, string>();
let draftMemoryBytes = 0;
const draftChangeListeners = new Set<(tabId: string) => void>();

export const QUERY_TAB_DRAFT_MEMORY_MAX_BYTES = 32 * 1024 * 1024;
export const QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH = 1024 * 1024;

export type QueryTabDraftBudgetState = {
  tabId: string;
  sourceTextLength: number;
  recoveryTextLength: number;
  recoveryTruncated: boolean;
  memoryRetained: boolean;
};

const draftBudgetStates = new Map<string, QueryTabDraftBudgetState>();
const draftBudgetListeners = new Set<(state: QueryTabDraftBudgetState) => void>();

export const subscribeQueryTabDraftBudgetChanges = (
  listener: (state: QueryTabDraftBudgetState) => void,
): (() => void) => {
  draftBudgetListeners.add(listener);
  return () => draftBudgetListeners.delete(listener);
};

export const getQueryTabDraftBudgetState = (tabId: string): QueryTabDraftBudgetState | null => (
  draftBudgetStates.get(String(tabId || '').trim()) || null
);

export const getQueryTabDraftMemoryStats = (): {
  count: number;
  totalBytes: number;
  maxBytes: number;
} => ({
  count: drafts.size,
  totalBytes: draftMemoryBytes,
  maxBytes: QUERY_TAB_DRAFT_MEMORY_MAX_BYTES,
});

const publishDraftBudgetState = (state: QueryTabDraftBudgetState): QueryTabDraftBudgetState => {
  const previous = draftBudgetStates.get(state.tabId);
  draftBudgetStates.set(state.tabId, state);
  if (
    previous?.recoveryTruncated === state.recoveryTruncated
    && previous?.memoryRetained === state.memoryRetained
  ) return state;
  for (const listener of draftBudgetListeners) {
    try {
      listener(state);
    } catch {
      // Budget observers must never interrupt editor input.
    }
  }
  return state;
};

export const subscribeQueryTabDraftChanges = (
  listener: (tabId: string) => void,
): (() => void) => {
  draftChangeListeners.add(listener);
  return () => draftChangeListeners.delete(listener);
};

const notifyQueryTabDraftChanged = (tabId: string): void => {
  for (const listener of draftChangeListeners) {
    try {
      listener(tabId);
    } catch {
      // A snapshot observer must never interrupt the editor input path.
    }
  }
};

const QUERY_TAB_DRAFT_SNAPSHOT_LEGACY_STORAGE_KEY = 'gonavi-query-tab-drafts-v1';
const QUERY_TAB_DRAFT_SNAPSHOT_INDEX_STORAGE_KEY = 'gonavi-query-tab-drafts-v2-index';
const QUERY_TAB_DRAFT_SNAPSHOT_ENTRY_STORAGE_PREFIX = 'gonavi-query-tab-draft-v2:';
const QUERY_TAB_DRAFT_SNAPSHOT_MAX_COUNT = 30;
const QUERY_TAB_DRAFT_SNAPSHOT_DEBOUNCE_MS = 160;
const QUERY_TAB_DRAFT_SNAPSHOT_IDLE_TIMEOUT_MS = 1500;
const QUERY_TAB_DRAFT_SNAPSHOT_FALLBACK_DELAY_MS = 500;

type PersistedQueryTabDraftEntry = {
  tabId: string;
  title: string;
  query: string;
  connectionId: string;
  dbName: string;
  filePath?: string;
  savedQueryId?: string;
  readOnly?: boolean;
  updatedAt: number;
  sourceTextLength: number;
  recoveryTruncated: boolean;
};

type PersistedQueryTabDraftIndexEntry = Omit<PersistedQueryTabDraftEntry, 'query'>;

type QueryTabDraftSnapshotTab = Pick<
  TabData,
  'id' | 'title' | 'connectionId' | 'dbName' | 'filePath' | 'savedQueryId' | 'readOnly'
>;

const persistedDrafts = new Map<string, PersistedQueryTabDraftEntry>();
const dirtyPersistedDraftIds = new Set<string>();
const deletedPersistedDraftIds = new Set<string>();

let persistedDraftsHydrated = false;
let persistTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let persistIdleCallback: number | null = null;
let persistFallbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let persistedDraftRevision = 0;
let flushedPersistedDraftRevision = 0;
let flushListenersBound = false;
let legacySnapshotMigrationPending = false;

const getWindowSchedulingApi = (): {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  requestIdleCallback: typeof window.requestIdleCallback | null;
  cancelIdleCallback: typeof window.cancelIdleCallback | null;
} | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const setTimeoutImpl = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : globalThis.setTimeout;
  const clearTimeoutImpl = typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : globalThis.clearTimeout;
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    return null;
  }
  return {
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    requestIdleCallback: typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback.bind(window)
      : null,
    cancelIdleCallback: typeof window.cancelIdleCallback === 'function'
      ? window.cancelIdleCallback.bind(window)
      : null,
  };
};

const toTabId = (value: unknown): string => String(value ?? '').trim();

const getPersistedDraftStorageKey = (tabId: string): string => (
  `${QUERY_TAB_DRAFT_SNAPSHOT_ENTRY_STORAGE_PREFIX}${encodeURIComponent(tabId)}`
);

const estimateDraftMemoryBytes = (content: string): number => content.length * 2;

const resolvePersistedRecoveryQuery = (entry: PersistedQueryTabDraftEntry): string => {
  const liveContent = drafts.get(entry.tabId);
  if (liveContent !== undefined && dirtyPersistedDraftIds.has(entry.tabId)) {
    entry.query = liveContent.slice(0, QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH);
  }
  return entry.query;
};

const deleteMemoryDraft = (tabId: string): boolean => {
  const current = drafts.get(tabId);
  if (current === undefined) return false;
  drafts.delete(tabId);
  draftMemoryBytes = Math.max(0, draftMemoryBytes - estimateDraftMemoryBytes(current));
  return true;
};

const evictMemoryDraft = (tabId: string): boolean => {
  const current = drafts.get(tabId);
  if (current === undefined) return false;
  const persisted = persistedDrafts.get(tabId);
  if (persisted && dirtyPersistedDraftIds.has(tabId)) {
    persisted.query = current.slice(0, QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH);
  }
  return deleteMemoryDraft(tabId);
};

const retainMemoryDraft = (tabId: string, content: string): boolean => {
  deleteMemoryDraft(tabId);
  const contentBytes = estimateDraftMemoryBytes(content);
  if (contentBytes > QUERY_TAB_DRAFT_MEMORY_MAX_BYTES) return false;
  drafts.set(tabId, content);
  draftMemoryBytes += contentBytes;
  while (draftMemoryBytes > QUERY_TAB_DRAFT_MEMORY_MAX_BYTES && drafts.size > 0) {
    const oldestTabId = drafts.keys().next().value;
    if (oldestTabId === undefined) break;
    evictMemoryDraft(oldestTabId);
    const oldestState = draftBudgetStates.get(oldestTabId);
    if (oldestState) publishDraftBudgetState({ ...oldestState, memoryRetained: false });
  }
  return drafts.has(tabId);
};

const readMemoryDraft = (tabId: string): string | undefined => {
  const content = drafts.get(tabId);
  if (content === undefined) return undefined;
  drafts.delete(tabId);
  drafts.set(tabId, content);
  return content;
};

const toTrimmedString = (value: unknown, fallback = ''): string => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const getDraftSnapshotStorage = (): Storage | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
};

const normalizePersistedDraftEntry = (
  value: unknown,
): PersistedQueryTabDraftEntry | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const tabId = toTabId(raw.tabId);
  if (!tabId) {
    return null;
  }
  const rawQuery = String(raw.query ?? '');
  const query = rawQuery.slice(0, QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH);
  const filePath = toTrimmedString(raw.filePath);
  const savedQueryId = toTrimmedString(raw.savedQueryId);
  if (!query.trim() && !filePath && !savedQueryId) {
    return null;
  }
  const updatedAt = Number(raw.updatedAt);
  const rawSourceTextLength = Number(raw.sourceTextLength);
  const sourceTextLength = Number.isFinite(rawSourceTextLength) && rawSourceTextLength >= query.length
    ? Math.trunc(rawSourceTextLength)
    : rawQuery.length;
  return {
    tabId,
    title: toTrimmedString(raw.title, 'SQL Query'),
    query,
    connectionId: toTrimmedString(raw.connectionId),
    dbName: toTrimmedString(raw.dbName),
    filePath: filePath || undefined,
    savedQueryId: savedQueryId || undefined,
    readOnly: raw.readOnly === true,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.trunc(updatedAt) : Date.now(),
    sourceTextLength,
    recoveryTruncated: raw.recoveryTruncated === true || sourceTextLength > query.length,
  };
};

const ensurePersistedDraftsHydrated = (): void => {
  if (persistedDraftsHydrated) {
    return;
  }
  persistedDraftsHydrated = true;
  const storage = getDraftSnapshotStorage();
  if (!storage) {
    return;
  }
  const hydrateEntries = (entries: PersistedQueryTabDraftEntry[]): void => {
    entries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, QUERY_TAB_DRAFT_SNAPSHOT_MAX_COUNT)
      .forEach((entry) => {
        persistedDrafts.set(entry.tabId, entry);
        publishDraftBudgetState({
          tabId: entry.tabId,
          sourceTextLength: entry.sourceTextLength,
          recoveryTextLength: entry.query.length,
          recoveryTruncated: entry.recoveryTruncated,
          memoryRetained: false,
        });
      });
  };
  const rawIndex = storage.getItem(QUERY_TAB_DRAFT_SNAPSHOT_INDEX_STORAGE_KEY);
  if (rawIndex !== null) {
    try {
      const parsedIndex = JSON.parse(rawIndex);
      if (Array.isArray(parsedIndex)) {
        hydrateEntries(parsedIndex
          .map((entry) => {
            const tabId = toTabId((entry as Record<string, unknown>)?.tabId);
            return normalizePersistedDraftEntry({
              ...(entry as Record<string, unknown>),
              query: tabId ? storage.getItem(getPersistedDraftStorageKey(tabId)) || '' : '',
            });
          })
          .filter((entry): entry is PersistedQueryTabDraftEntry => !!entry));
        return;
      }
    } catch {
      // Fall back to a still-available v1 snapshot.
    }
  }
  try {
    const legacyPayload = storage.getItem(QUERY_TAB_DRAFT_SNAPSHOT_LEGACY_STORAGE_KEY);
    if (!legacyPayload) return;
    const parsed = JSON.parse(legacyPayload);
    if (!Array.isArray(parsed)) {
      return;
    }
    const entries = parsed
      .map((entry) => normalizePersistedDraftEntry(entry))
      .filter((entry): entry is PersistedQueryTabDraftEntry => !!entry);
    hydrateEntries(entries);
    persistedDrafts.forEach((_entry, tabId) => dirtyPersistedDraftIds.add(tabId));
    if (persistedDrafts.size > 0) {
      legacySnapshotMigrationPending = true;
      schedulePersistedDraftFlush();
    }
  } catch {
    // ignore invalid crash-recovery payloads
  }
};

const cancelScheduledPersistedDraftFlush = (): void => {
  const schedulingApi = getWindowSchedulingApi();
  if (persistTimer !== null && schedulingApi) {
    schedulingApi.clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistFallbackTimer !== null && schedulingApi) {
    schedulingApi.clearTimeout(persistFallbackTimer);
    persistFallbackTimer = null;
  }
  if (persistIdleCallback !== null && schedulingApi?.cancelIdleCallback) {
    schedulingApi.cancelIdleCallback(persistIdleCallback);
    persistIdleCallback = null;
  }
};

const hasPendingPersistedDraftWrites = (): boolean => (
  dirtyPersistedDraftIds.size > 0
  || deletedPersistedDraftIds.size > 0
  || flushedPersistedDraftRevision !== persistedDraftRevision
);

const buildPersistedDraftIndex = (): PersistedQueryTabDraftIndexEntry[] => (
  Array.from(persistedDrafts.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, QUERY_TAB_DRAFT_SNAPSHOT_MAX_COUNT)
    .map(({ query: _query, ...entry }) => entry)
);

const writePersistedDraftIndex = (storage: Storage): void => {
  const index = buildPersistedDraftIndex();
  if (index.length === 0) {
    storage.removeItem(QUERY_TAB_DRAFT_SNAPSHOT_INDEX_STORAGE_KEY);
  } else {
    storage.setItem(QUERY_TAB_DRAFT_SNAPSHOT_INDEX_STORAGE_KEY, JSON.stringify(index));
  }
  if (!legacySnapshotMigrationPending) {
    storage.removeItem(QUERY_TAB_DRAFT_SNAPSHOT_LEGACY_STORAGE_KEY);
  }
};

const flushOnePersistedDraft = (storage: Storage): boolean => {
  const deletedTabId = deletedPersistedDraftIds.values().next().value as string | undefined;
  if (deletedTabId !== undefined) {
    storage.removeItem(getPersistedDraftStorageKey(deletedTabId));
    deletedPersistedDraftIds.delete(deletedTabId);
    if (dirtyPersistedDraftIds.size === 0 && deletedPersistedDraftIds.size === 0) {
      legacySnapshotMigrationPending = false;
    }
    if (!legacySnapshotMigrationPending) writePersistedDraftIndex(storage);
    return true;
  }
  const dirtyTabId = dirtyPersistedDraftIds.values().next().value as string | undefined;
  if (dirtyTabId === undefined) return false;
  const entry = persistedDrafts.get(dirtyTabId);
  if (entry) storage.setItem(getPersistedDraftStorageKey(dirtyTabId), resolvePersistedRecoveryQuery(entry));
  dirtyPersistedDraftIds.delete(dirtyTabId);
  if (dirtyPersistedDraftIds.size === 0 && deletedPersistedDraftIds.size === 0) {
    legacySnapshotMigrationPending = false;
  }
  if (!legacySnapshotMigrationPending) writePersistedDraftIndex(storage);
  return true;
};

const flushPersistedDraftChunk = (): boolean => {
  const storage = getDraftSnapshotStorage();
  if (!storage) {
    dirtyPersistedDraftIds.clear();
    deletedPersistedDraftIds.clear();
    flushedPersistedDraftRevision = persistedDraftRevision;
    return true;
  }
  try {
    flushOnePersistedDraft(storage);
    if (dirtyPersistedDraftIds.size === 0 && deletedPersistedDraftIds.size === 0) {
      flushedPersistedDraftRevision = persistedDraftRevision;
    }
    return true;
  } catch {
    return false;
  }
};

const flushPersistedDrafts = (): void => {
  cancelScheduledPersistedDraftFlush();
  if (!hasPendingPersistedDraftWrites()) return;
  const revision = persistedDraftRevision;
  const storage = getDraftSnapshotStorage();
  if (!storage) {
    dirtyPersistedDraftIds.clear();
    deletedPersistedDraftIds.clear();
    flushedPersistedDraftRevision = revision;
    return;
  }
  try {
    for (const tabId of deletedPersistedDraftIds) {
      storage.removeItem(getPersistedDraftStorageKey(tabId));
    }
    for (const tabId of dirtyPersistedDraftIds) {
      const entry = persistedDrafts.get(tabId);
      if (entry) storage.setItem(getPersistedDraftStorageKey(tabId), resolvePersistedRecoveryQuery(entry));
    }
    legacySnapshotMigrationPending = false;
    writePersistedDraftIndex(storage);
    dirtyPersistedDraftIds.clear();
    deletedPersistedDraftIds.clear();
    flushedPersistedDraftRevision = revision;
  } catch {
    // ignore storage quota or serialization failures
  }
};

const bindFlushListeners = (): void => {
  if (flushListenersBound || typeof window === 'undefined') {
    return;
  }
  flushListenersBound = true;
  const handleFlush = () => {
    flushPersistedDrafts();
  };
  window.addEventListener('pagehide', handleFlush, { capture: true });
  window.addEventListener('beforeunload', handleFlush, { capture: true });
  if (typeof document !== 'undefined') {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPersistedDrafts();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
};

const scheduleNextPersistedDraftChunk = (
  schedulingApi: NonNullable<ReturnType<typeof getWindowSchedulingApi>>,
): void => {
  if (!hasPendingPersistedDraftWrites()) return;
  if (schedulingApi.requestIdleCallback) {
    if (persistIdleCallback !== null) return;
    persistIdleCallback = schedulingApi.requestIdleCallback(() => {
      persistIdleCallback = null;
      if (persistTimer !== null) return;
      if (flushPersistedDraftChunk()) scheduleNextPersistedDraftChunk(schedulingApi);
    }, { timeout: QUERY_TAB_DRAFT_SNAPSHOT_IDLE_TIMEOUT_MS });
    return;
  }
  if (persistFallbackTimer !== null) return;
  persistFallbackTimer = schedulingApi.setTimeout(() => {
    persistFallbackTimer = null;
    if (flushPersistedDraftChunk()) scheduleNextPersistedDraftChunk(schedulingApi);
  }, QUERY_TAB_DRAFT_SNAPSHOT_FALLBACK_DELAY_MS);
};

const schedulePersistedDraftFlush = (): void => {
  bindFlushListeners();
  persistedDraftRevision += 1;
  const schedulingApi = getWindowSchedulingApi();
  if (!schedulingApi) {
    flushPersistedDrafts();
    return;
  }
  if (persistTimer !== null) {
    schedulingApi.clearTimeout(persistTimer);
  }
  if (persistFallbackTimer !== null) {
    schedulingApi.clearTimeout(persistFallbackTimer);
    persistFallbackTimer = null;
  }
  if (persistIdleCallback !== null && schedulingApi.cancelIdleCallback) {
    schedulingApi.cancelIdleCallback(persistIdleCallback);
    persistIdleCallback = null;
  }
  persistTimer = schedulingApi.setTimeout(() => {
    persistTimer = null;
    scheduleNextPersistedDraftChunk(schedulingApi);
  }, QUERY_TAB_DRAFT_SNAPSHOT_DEBOUNCE_MS);
};

const trimPersistedDraftCount = (): void => {
  Array.from(persistedDrafts.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(QUERY_TAB_DRAFT_SNAPSHOT_MAX_COUNT)
    .forEach((entry) => {
      persistedDrafts.delete(entry.tabId);
      dirtyPersistedDraftIds.delete(entry.tabId);
      deletedPersistedDraftIds.add(entry.tabId);
    });
};

const upsertPersistedDraftEntry = (
  tab: QueryTabDraftSnapshotTab,
  content: string,
  overrides?: { connectionId?: string; dbName?: string },
): QueryTabDraftBudgetState | null => {
  ensurePersistedDraftsHydrated();
  const tabId = toTabId(tab.id);
  if (!tabId) return null;
  const sourceContent = String(content ?? '');
  const previous = persistedDrafts.get(tabId);
  const memoryRetained = drafts.has(tabId);
  const query = memoryRetained
    ? (previous?.query || '')
    : sourceContent.slice(0, QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH);
  const filePath = toTrimmedString(tab.filePath);
  const savedQueryId = toTrimmedString(tab.savedQueryId);
  const shouldKeep = Boolean(/\S/.test(sourceContent) || filePath || savedQueryId);
  if (!shouldKeep) {
    if (persistedDrafts.delete(tabId)) {
      dirtyPersistedDraftIds.delete(tabId);
      deletedPersistedDraftIds.add(tabId);
      schedulePersistedDraftFlush();
    }
    return publishDraftBudgetState({
      tabId,
      sourceTextLength: sourceContent.length,
      recoveryTextLength: 0,
      recoveryTruncated: false,
      memoryRetained,
    });
  }
  // An override is allowed to intentionally clear a context value (for
  // example a connection-scoped SQLite tab has no database name). Only fall
  // back to the tab snapshot when the property was not supplied at all.
  const hasOverride = (key: 'connectionId' | 'dbName'): boolean => (
    !!overrides && Object.prototype.hasOwnProperty.call(overrides, key)
  );
  const resolvedConnectionId = hasOverride('connectionId')
    ? String(overrides?.connectionId ?? '').trim()
    : toTrimmedString(tab.connectionId);
  const resolvedDbName = hasOverride('dbName')
    ? String(overrides?.dbName ?? '').trim()
    : toTrimmedString(tab.dbName);
  persistedDrafts.set(tabId, {
    tabId,
    title: toTrimmedString(tab.title, 'SQL Query'),
    query,
    connectionId: resolvedConnectionId,
    dbName: resolvedDbName,
    filePath: filePath || undefined,
    savedQueryId: savedQueryId || undefined,
    readOnly: tab.readOnly === true,
    updatedAt: Date.now(),
    sourceTextLength: sourceContent.length,
    recoveryTruncated: sourceContent.length > QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH,
  });
  dirtyPersistedDraftIds.add(tabId);
  deletedPersistedDraftIds.delete(tabId);
  trimPersistedDraftCount();
  schedulePersistedDraftFlush();
  return publishDraftBudgetState({
    tabId,
    sourceTextLength: sourceContent.length,
    recoveryTextLength: Math.min(sourceContent.length, QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH),
    recoveryTruncated: sourceContent.length > QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH,
    memoryRetained,
  });
};

export const setQueryTabDraft = (tabId: string, content: string): QueryTabDraftBudgetState | null => {
  ensurePersistedDraftsHydrated();
  const id = toTabId(tabId);
  if (!id) return null;
  const nextContent = String(content ?? '');
  const previousContent = drafts.get(id) ?? persistedDrafts.get(id)?.query;
  const memoryRetained = retainMemoryDraft(id, nextContent);
  const persisted = persistedDrafts.get(id);
  const state = publishDraftBudgetState({
    tabId: id,
    sourceTextLength: nextContent.length,
    recoveryTextLength: persisted?.query.length || 0,
    recoveryTruncated: persisted?.recoveryTruncated === true,
    memoryRetained,
  });
  if (previousContent !== nextContent) notifyQueryTabDraftChanged(id);
  return state;
};

export const getQueryTabDraft = (tabId: string, fallback = ''): string => {
  ensurePersistedDraftsHydrated();
  const id = toTabId(tabId);
  if (!id) return fallback;
  const memoryDraft = readMemoryDraft(id);
  if (memoryDraft !== undefined) return memoryDraft;
  const persisted = persistedDrafts.get(id);
  if (!persisted) return fallback;
  const recoveryQuery = resolvePersistedRecoveryQuery(persisted);
  if (
    persisted.recoveryTruncated
    && fallback.length >= persisted.sourceTextLength
    && fallback.startsWith(recoveryQuery)
  ) return fallback;
  return recoveryQuery;
};

export const clearQueryTabDraft = (tabId: string): void => {
  ensurePersistedDraftsHydrated();
  const id = toTabId(tabId);
  if (!id) return;
  const draftChanged = deleteMemoryDraft(id);
  const persistedChanged = persistedDrafts.delete(id);
  if (persistedChanged) {
    dirtyPersistedDraftIds.delete(id);
    deletedPersistedDraftIds.add(id);
    schedulePersistedDraftFlush();
  }
  draftBudgetStates.delete(id);
  if (draftChanged || persistedChanged) notifyQueryTabDraftChanged(id);
};

export const hasQueryTabDraft = (tabId: string): boolean => {
  ensurePersistedDraftsHydrated();
  const id = toTabId(tabId);
  return Boolean(id && (drafts.has(id) || persistedDrafts.has(id)));
};

export const persistQueryTabDraftSnapshot = (
  tab: QueryTabDraftSnapshotTab,
  content: string,
  overrides?: { connectionId?: string; dbName?: string },
): QueryTabDraftBudgetState | null => {
  const tabId = toTabId(tab.id);
  if (!tabId) return null;
  setQueryTabDraft(tabId, content);
  return upsertPersistedDraftEntry(tab, content, overrides);
};

export const getPersistedQueryTabDraftEntry = (
  tabId: string,
): PersistedQueryTabDraftEntry | null => {
  ensurePersistedDraftsHydrated();
  const id = toTabId(tabId);
  if (!id) {
    return null;
  }
  const entry = persistedDrafts.get(id);
  if (!entry) return null;
  resolvePersistedRecoveryQuery(entry);
  return entry;
};

export const listPersistedQueryTabDraftEntries = (): PersistedQueryTabDraftEntry[] => {
  ensurePersistedDraftsHydrated();
  return Array.from(persistedDrafts.values())
    .map((entry) => {
      resolvePersistedRecoveryQuery(entry);
      return entry;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const flushQueryTabDraftSnapshots = (): void => {
  flushPersistedDrafts();
};

export const setSQLFileTabDraft = (tabId: string, content: string): void => {
  setQueryTabDraft(tabId, content);
};

export const getSQLFileTabDraft = (tabId: string, fallback = ''): string => {
  return getQueryTabDraft(tabId, fallback);
};

export const clearSQLFileTabDraft = (tabId: string): void => {
  clearQueryTabDraft(tabId);
};

export const hasSQLFileTabDraft = (tabId: string): boolean => {
  return hasQueryTabDraft(tabId);
};
