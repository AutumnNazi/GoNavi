import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchSavedQueryLocateFallback } from '../queryEditor/queryEditorLineTableLocate';
import { dispatchSidebarActiveQueryTableLocate, resolveSidebarActiveTabLocateAction } from './sidebarLocateActiveTab';

describe('resolveSidebarActiveTabLocateAction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dispatches saved-query fallback when the cursor line has no table', () => {
    const target = new EventTarget();
    const events: unknown[] = [];
    target.addEventListener('gonavi:locate-sidebar-object', (event) => {
      events.push((event as CustomEvent).detail);
    });
    target.addEventListener('gonavi:locate-active-query-table', (event) => {
      dispatchSavedQueryLocateFallback((event as CustomEvent).detail);
    });
    vi.stubGlobal('window', target);
    vi.stubGlobal('CustomEvent', class extends Event {
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        super(type);
        this.detail = init.detail;
      }
    });

    const action = resolveSidebarActiveTabLocateAction({
      tab: { id: 'saved-1', type: 'query', savedQueryId: 'saved-1', connectionId: 'conn-1', dbName: 'main' },
      hasConnection: true,
    });
    expect(action.kind).toBe('query-line-table');
    if (action.kind === 'query-line-table') {
      dispatchSidebarActiveQueryTableLocate(action);
    }
    expect(events).toEqual([expect.objectContaining({ savedQueryId: 'saved-1', objectGroup: 'savedQueries' })]);
  });

  it('routes saved-query locate through the editor cursor with a saved-query fallback', () => {
    expect(resolveSidebarActiveTabLocateAction({
      tab: {
        id: 'sq-rfm',
        title: 'RFM 三维客户分析',
        type: 'query',
        connectionId: 'conn-kb',
        dbName: 'gonavi_kingbase_lab',
        savedQueryId: 'sq-rfm',
      },
      hasConnection: true,
    })).toMatchObject({
      kind: 'query-line-table',
      fallbackRequest: {
        objectGroup: 'savedQueries',
        savedQueryId: 'sq-rfm',
        savedQueryName: 'RFM 三维客户分析',
      },
    });
  });

  it('still locates a saved query when the host is not connected', () => {
    expect(resolveSidebarActiveTabLocateAction({
      tab: {
        id: 'sq-rfm',
        type: 'query',
        savedQueryId: 'sq-rfm',
      },
      hasConnection: false,
    })).toMatchObject({
      kind: 'object',
      request: { objectGroup: 'savedQueries', savedQueryId: 'sq-rfm' },
    });
  });

  it('keeps current-line table locate for unsaved query tabs', () => {
    expect(resolveSidebarActiveTabLocateAction({
      tab: {
        id: 'query-1',
        type: 'query',
        connectionId: 'conn-kb',
        dbName: 'gonavi_kingbase_lab',
      },
      hasConnection: true,
    })).toEqual({ kind: 'query-line-table' });
  });

  it('does not use current-line table locate for external SQL files', () => {
    expect(resolveSidebarActiveTabLocateAction({
      tab: {
        id: 'file-1',
        type: 'query',
        filePath: '/tmp/rfm.sql',
        connectionId: 'conn-kb',
        dbName: 'gonavi_kingbase_lab',
      },
      hasConnection: true,
    })).toMatchObject({
      kind: 'object',
      request: { objectGroup: 'externalSqlFiles', filePath: '/tmp/rfm.sql' },
    });
  });

  it('locates object-edit query tabs as database objects', () => {
    expect(resolveSidebarActiveTabLocateAction({
      tab: {
        id: 'query-edit-routine-1',
        type: 'query',
        queryMode: 'object-edit',
        connectionId: 'conn-1',
        dbName: 'main',
        routineName: 'public.fn_total',
      },
      hasConnection: true,
    })).toMatchObject({
      kind: 'object',
      request: { objectGroup: 'routines', tableName: 'public.fn_total' },
    });
  });

  it('marks unsaved query tabs without a connection as unavailable', () => {
    expect(resolveSidebarActiveTabLocateAction({
      tab: {
        id: 'query-1',
        type: 'query',
        connectionId: 'conn-kb',
        dbName: 'gonavi_kingbase_lab',
      },
      hasConnection: false,
    })).toEqual({ kind: 'unavailable' });
  });
});
