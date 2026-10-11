import { describe, expect, it } from 'vitest';
import type { SavedConnection } from '../types';
import { buildMockDataWorkbenchTab, buildMockDataWorkbenchTabId, canGenerateMockData } from './mockDataTab';

const connection = (type: string, extra: Record<string, unknown> = {}): Pick<SavedConnection, 'config'> => ({
  config: { type, host: 'localhost', port: 3306, user: 'root', ...extra } as SavedConnection['config'],
});

describe('mockDataTab', () => {
  it('builds one tab per table so reopening the same table switches back to it', () => {
    const tab = buildMockDataWorkbenchTab({ connectionId: 'c1', dbName: 'app', tableName: 'public.users', schemaName: 'public' });
    expect(tab).toMatchObject({ type: 'mock-data', connectionId: 'c1', dbName: 'app', tableName: 'public.users', schemaName: 'public' });
    expect(tab.id).toBe(buildMockDataWorkbenchTabId({ connectionId: 'c1', dbName: 'app', tableName: 'public.users' }));
    expect(tab.id).not.toBe(buildMockDataWorkbenchTabId({ connectionId: 'c1', dbName: 'app', tableName: 'public.orders' }));
  });

  it('enables mock data only for relational sources that allow writing data', () => {
    expect(canGenerateMockData(connection('mysql'))).toBe(true);
    expect(canGenerateMockData(connection('kingbase'))).toBe(true);
    expect(canGenerateMockData(connection('oracle'))).toBe(true);
    expect(canGenerateMockData(connection('mongodb'))).toBe(false);
    expect(canGenerateMockData(connection('redis'))).toBe(false);
    expect(canGenerateMockData(connection('iotdb'))).toBe(false);
    expect(canGenerateMockData(connection('mysql', { protection: { restrictDataImport: true } }))).toBe(false);
    expect(canGenerateMockData(connection('mysql', { protection: { restrictDataEdit: true } }))).toBe(false);
    expect(canGenerateMockData(null)).toBe(false);
  });
});
