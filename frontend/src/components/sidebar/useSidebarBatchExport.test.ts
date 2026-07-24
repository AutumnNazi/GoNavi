import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SavedConnection } from '../../types';
import { showSQLExportOptionsDialog } from '../SQLExportOptionsDialog';
import { resolveBatchWorkbenchContext, useSidebarBatchExport } from './useSidebarBatchExport';

vi.mock('../SQLExportOptionsDialog', () => ({
  showSQLExportOptionsDialog: vi.fn(),
}));

const connections = [
  {
    id: 'es-1',
    name: 'Search',
    config: { type: 'elasticsearch' },
  },
  {
    id: 'sql-1',
    name: 'SQL',
    config: { type: 'postgresql' },
  },
] as SavedConnection[];

describe('resolveBatchWorkbenchContext', () => {
  it('prefills the selected SQL connection and database', () => {
    expect(resolveBatchWorkbenchContext([{
      type: 'view',
      dataRef: { id: 'sql-1', dbName: 'app' },
    }], connections)).toEqual({ connectionId: 'sql-1', dbName: 'app' });
  });

  it('falls back to a SQL-export-capable connection without carrying an unsupported database', () => {
    expect(resolveBatchWorkbenchContext([{
      type: 'database',
      title: 'search-index',
      dataRef: { id: 'es-1' },
    }], connections)).toEqual({ connectionId: 'sql-1', dbName: '' });
  });
});

describe('useSidebarBatchExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [false, 'schema'],
    [true, 'backup'],
  ] as const)('opens database export mode %s directly in the workbench', async (includeData, contentMode) => {
    const addTab = vi.fn();
    const { handleExportDatabaseSQL } = useSidebarBatchExport({
      connections,
      selectedNodesRef: { current: [] },
      addTab,
    });

    await handleExportDatabaseSQL({
      type: 'database',
      title: 'app',
      dataRef: { id: 'sql-1', dbName: 'app' },
    }, includeData);

    expect(showSQLExportOptionsDialog).not.toHaveBeenCalled();
    expect(addTab).toHaveBeenCalledOnce();
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      exportWorkbenchMode: 'database',
      connectionId: 'sql-1',
      dbName: 'app',
      tableExportContentMode: contentMode,
      tableExportIncludeDropIfExists: false,
      tableExportLaunchKey: expect.stringMatching(/^database-/),
      tableExportRequestKey: undefined,
    }));
  });
});
