import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { SavedConnection } from '../../types';
import {
  normalizeSessionPayload,
  readSessionPayload,
  sessionConnections,
  type DatabaseSession,
  type SessionActionRequest,
  type SessionListPayload,
  type SessionQueryResult,
} from './sessionWorkbenchModel';
import {
  executeDatabaseSessionAction,
  listDatabaseSessions,
} from './sessionWorkbenchRpc';
import { useSessionWorkbenchScope } from './useSessionWorkbenchScope';

export interface UseSessionWorkbenchOptions {
  initialConnectionId?: string;
  initialDbName?: string;
}

export interface SessionWorkbenchState {
  connections: SavedConnection[];
  selectedConnection: SavedConnection | null;
  selectedConnectionId: string;
  setSelectedConnectionId: (connectionId: string) => void;
  dbName: string;
  /** The database/tenant used by the last successful server request. */
  databaseName: string;
  setDbName: (dbName: string) => void;
  applyDatabase: () => Promise<boolean>;
  filter: string;
  setFilter: (filter: string) => void;
  payload: SessionListPayload | null;
  loading: boolean;
  error: string;
  /** Monotonic context revision used to invalidate dialogs and old actions. */
  scopeRevision: number;
  refresh: (databaseOverride?: string) => Promise<boolean>;
  executeAction: (request: SessionActionRequest) => Promise<SessionQueryResult>;
}

interface SessionScopeSnapshot {
  connectionId: string;
  databaseName: string;
  draftDatabaseName: string;
  revision: number;
}

const normalized = (value: unknown): string => String(value ?? '').trim();

export const useSessionWorkbench = (
  options: UseSessionWorkbenchOptions = {},
): SessionWorkbenchState => {
  const allConnections = useStore((state) => state.connections);
  const connections = useMemo(() => sessionConnections(allConnections), [allConnections]);
  const scope = useSessionWorkbenchScope(options, connections);
  const {
    selectedConnection,
    selectedConnectionId,
    setSelectedConnectionIdState,
    dbName,
    setDbName: setScopeDbName,
    databaseName,
    setDatabaseName,
    scopeRevision: renderedScopeRevision,
    autoRefreshRevision,
    invalidateScope: invalidateScopeState,
  } = scope;
  const [filter, setFilter] = useState('');
  const [payload, setPayload] = useState<SessionListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Refs make the response guard synchronous with a user selection. A
  // promise can settle before React has committed the next render, so relying
  // only on state captured by a callback is not enough here.
  const connectionsRef = useRef(connections);
  const selectedConnectionIdRef = useRef(selectedConnectionId);
  const draftDatabaseNameRef = useRef(dbName);
  const appliedDatabaseNameRef = useRef(databaseName);
  const requestRevision = useRef(0);
  const scopeRevisionRef = useRef(renderedScopeRevision);
  connectionsRef.current = connections;
  selectedConnectionIdRef.current = selectedConnectionId;
  draftDatabaseNameRef.current = dbName;
  appliedDatabaseNameRef.current = databaseName;
  // The local invalidation helper can advance this ref before the scope hook
  // state has rendered. Never move it backwards when that state catches up.
  if (renderedScopeRevision > scopeRevisionRef.current) {
    scopeRevisionRef.current = renderedScopeRevision;
  }

  const invalidateCurrentScope = useCallback(() => {
    requestRevision.current += 1;
    scopeRevisionRef.current += 1;
    invalidateScopeState();
    setLoading(false);
  }, [invalidateScopeState]);

  const isScopeCurrent = useCallback((snapshot: SessionScopeSnapshot): boolean => (
    scopeRevisionRef.current === snapshot.revision
      && selectedConnectionIdRef.current === snapshot.connectionId
      && appliedDatabaseNameRef.current === snapshot.databaseName
      && draftDatabaseNameRef.current === snapshot.draftDatabaseName
  ), []);

  const refreshSessions = useCallback(async (
    databaseOverride: string | undefined,
    invalidateContext: boolean,
  ): Promise<boolean> => {
    if (invalidateContext) invalidateCurrentScope();

    const requestId = ++requestRevision.current;
    const requestedConnectionId = selectedConnectionIdRef.current;
    const requestedDraftDatabaseName = draftDatabaseNameRef.current;
    const requestedDatabaseName = normalized(
      databaseOverride === undefined
        ? (appliedDatabaseNameRef.current || requestedDraftDatabaseName)
        : databaseOverride,
    );
    const requestScope: SessionScopeSnapshot = {
      connectionId: requestedConnectionId,
      databaseName: requestedDatabaseName,
      draftDatabaseName: requestedDraftDatabaseName,
      revision: scopeRevisionRef.current,
    };
    const isRequestCurrent = (): boolean => (
      requestRevision.current === requestId
        && scopeRevisionRef.current === requestScope.revision
        && selectedConnectionIdRef.current === requestScope.connectionId
        && draftDatabaseNameRef.current === requestScope.draftDatabaseName
    );
    const connection = connectionsRef.current.find(
      (candidate) => candidate.id === requestedConnectionId,
    );
    if (!connection) {
      if (isRequestCurrent()) {
        setPayload(null);
        setError('no_connection');
        setLoading(false);
      }
      return false;
    }

    setLoading(true);
    setError('');
    try {
      const result = await listDatabaseSessions(connection.config, requestedDatabaseName);
      if (!isRequestCurrent()) return false;
      if (result.success !== true) {
        setPayload(null);
        setError(normalized(result.message) || 'list_failed');
        return false;
      }
      setPayload(readSessionPayload(result));
      setDatabaseName(requestedDatabaseName);
      return true;
    } catch (cause) {
      if (!isRequestCurrent()) return false;
      setPayload(null);
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      // A newer request, or a scope invalidation, owns the loading indicator.
      if (requestRevision.current === requestId) setLoading(false);
    }
  }, [invalidateCurrentScope, setDatabaseName]);

  const refresh = useCallback(
    (databaseOverride?: string): Promise<boolean> => refreshSessions(databaseOverride, true),
    [refreshSessions],
  );

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastAutoRefreshRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastAutoRefreshRevisionRef.current === autoRefreshRevision) return;
    lastAutoRefreshRevisionRef.current = autoRefreshRevision;
    setFilter('');
    void refreshRef.current();
  }, [autoRefreshRevision]);

  const setSelectedConnectionId = useCallback((connectionId: string) => {
    const nextConnectionId = normalized(connectionId);
    if (nextConnectionId === selectedConnectionIdRef.current) return;
    const nextConnection = connectionsRef.current.find(
      (candidate) => candidate.id === nextConnectionId,
    );
    invalidateCurrentScope();
    setSelectedConnectionIdState(nextConnectionId);
    setScopeDbName(normalized(nextConnection?.config.database));
    setDatabaseName('');
    setPayload(null);
    setError('');
    setFilter('');
  }, [invalidateCurrentScope, setDatabaseName, setScopeDbName, setSelectedConnectionIdState]);

  const setDbName = useCallback((value: string) => {
    const next = normalized(value);
    if (next === draftDatabaseNameRef.current) return;
    invalidateCurrentScope();
    setScopeDbName(next);
  }, [invalidateCurrentScope, setScopeDbName]);

  const applyDatabase = useCallback(
    (): Promise<boolean> => refresh(draftDatabaseNameRef.current),
    [refresh],
  );

  const executeAction = useCallback(async (
    request: SessionActionRequest,
  ): Promise<SessionQueryResult> => {
    const requestedConnectionId = selectedConnectionIdRef.current;
    const requestedDatabaseName = appliedDatabaseNameRef.current;
    const requestedDraftDatabaseName = draftDatabaseNameRef.current;
    const actionScope: SessionScopeSnapshot = {
      connectionId: requestedConnectionId,
      databaseName: requestedDatabaseName,
      draftDatabaseName: requestedDraftDatabaseName,
      revision: scopeRevisionRef.current,
    };
    const connection = connectionsRef.current.find(
      (candidate) => candidate.id === requestedConnectionId,
    );
    if (!connection) return { success: false, message: 'no_connection' };

    const staleResult = (result: SessionQueryResult): SessionQueryResult => ({
      ...result,
      stale: true,
    });

    try {
      const result = await executeDatabaseSessionAction(
        connection.config,
        requestedDatabaseName,
        request,
      );
      if (!isScopeCurrent(actionScope)) return staleResult(result);
      // Refresh the same applied scope used for the action. The input field
      // may contain an unapplied database/tenant while a confirmation modal
      // is open; refreshing from that draft would switch context silently.
      if (result.success === true) {
        await refreshSessions(requestedDatabaseName, false);
        if (!isScopeCurrent(actionScope)) return staleResult(result);
      }
      return result;
    } catch (cause) {
      const result: SessionQueryResult = {
        success: false,
        message: cause instanceof Error ? cause.message : String(cause),
      };
      return isScopeCurrent(actionScope) ? result : staleResult(result);
    }
  }, [isScopeCurrent, refreshSessions]);

  return {
    connections,
    selectedConnection,
    selectedConnectionId,
    setSelectedConnectionId,
    dbName,
    databaseName,
    setDbName,
    applyDatabase,
    filter,
    setFilter,
    payload: payload ? normalizeSessionPayload(payload) : null,
    loading,
    error,
    scopeRevision: scopeRevisionRef.current,
    refresh,
    executeAction,
  };
};

export const sessionRowByKey = (
  sessions: DatabaseSession[],
  key: string,
): DatabaseSession | null => sessions.find((session) => session.key === key) || null;
