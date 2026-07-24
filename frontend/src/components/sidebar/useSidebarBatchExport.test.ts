import { describe, expect, it } from 'vitest';

import type { SavedConnection } from '../../types';
import { resolveBatchWorkbenchContext } from './useSidebarBatchExport';

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
