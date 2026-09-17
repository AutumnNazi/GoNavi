import { describe, expect, it } from 'vitest';

import { resolveSidebarActiveTabLocateAction } from './sidebarLocateActiveTab';

describe('resolveSidebarActiveTabLocateAction', () => {
  it('locates the saved query itself instead of the current SQL line', () => {
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
      kind: 'object',
      request: {
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
