import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedQuery, TabData } from '../types';
import { clearQueryTabDraft, setQueryTabDraft, setSQLFileTabDraft } from './sqlFileTabDrafts';
import {
  collectApplicationQuitUnsavedSQLTargets,
  saveApplicationQuitUnsavedSQLTargets,
} from './sqlEditorApplicationQuit';

const createQueryTab = (overrides: Partial<TabData>): TabData => ({
  id: 'tab-1',
  title: 'Query',
  type: 'query',
  connectionId: 'conn-1',
  dbName: 'main',
  query: '',
  ...overrides,
});

const createSavedQuery = (overrides: Partial<SavedQuery> = {}): SavedQuery => ({
  id: 'saved-1',
  name: 'Saved query',
  sql: 'select 1;',
  connectionId: 'conn-1',
  dbName: 'main',
  createdAt: 1,
  ...overrides,
});

describe('sqlEditorApplicationQuit', () => {
  beforeEach(() => {
    clearQueryTabDraft('tab-1');
    clearQueryTabDraft('tab-2');
    clearQueryTabDraft('tab-3');
  });

  it('collects dirty external SQL file tabs by comparing the draft with disk content', async () => {
    const tab = createQueryTab({
      id: 'tab-1',
      title: 'work_order.sql',
      filePath: '/tmp/work_order.sql',
      query: 'select * from old_table;',
    });
    setSQLFileTabDraft('tab-1', 'select * from mes_work_order;');
    const readSQLFile = vi.fn().mockResolvedValue({
      success: true,
      data: { content: 'select * from old_table;' },
    });

    const targets = await collectApplicationQuitUnsavedSQLTargets([tab], [], readSQLFile);

    expect(targets).toEqual([expect.objectContaining({
      kind: 'sql-file',
      tabId: 'tab-1',
      title: 'work_order.sql',
      filePath: '/tmp/work_order.sql',
      draft: 'select * from mes_work_order;',
    })]);
  });

  it('collects dirty saved-query tabs and unnamed temporary query tabs', async () => {
    const savedQuery = createSavedQuery();
    const savedTab = createQueryTab({
      id: 'tab-2',
      title: 'Saved query',
      savedQueryId: 'saved-1',
      query: 'select 1;',
    });
    const unnamedTab = createQueryTab({
      id: 'tab-3',
      title: 'New query',
      query: 'select * from draft_only;',
    });
    setQueryTabDraft('tab-2', 'select 2;');
    setQueryTabDraft('tab-3', 'select * from draft_only;');

    const targets = await collectApplicationQuitUnsavedSQLTargets([savedTab, unnamedTab], [savedQuery], vi.fn());

    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      kind: 'saved-query',
      tabId: 'tab-2',
      title: 'Saved query',
      draft: 'select 2;',
      connectionId: 'conn-1',
      dbName: 'main',
    });
    expect(targets[1]).toMatchObject({
      kind: 'unsaved-query',
      tabId: 'tab-3',
      title: 'New query',
      draft: 'select * from draft_only;',
      connectionId: 'conn-1',
      dbName: 'main',
    });
  });

  it('ignores blank unnamed temporary query tabs', async () => {
    const unnamedTab = createQueryTab({
      id: 'tab-3',
      title: 'New query',
      query: '',
    });
    setQueryTabDraft('tab-3', '   ');

    const targets = await collectApplicationQuitUnsavedSQLTargets([unnamedTab], [], vi.fn());

    expect(targets).toEqual([]);
  });

  it('saves external SQL files, existing saved queries, and unnamed query drafts before application quit', async () => {
    const saveQuery = vi.fn(async (query: SavedQuery) => query);
    const writeSQLFile = vi.fn(async () => ({ success: true }));

    await saveApplicationQuitUnsavedSQLTargets([
      {
        kind: 'sql-file',
        tabId: 'tab-1',
        title: 'file.sql',
        filePath: '/tmp/file.sql',
        draft: 'select 1;',
      },
      {
        kind: 'saved-query',
        tabId: 'tab-2',
        title: 'Saved query',
        savedQuery: createSavedQuery(),
        draft: 'select 2;',
        connectionId: 'conn-2',
        dbName: 'reporting',
      },
      {
        kind: 'unsaved-query',
        tabId: 'tab-3',
        title: 'New query',
        draft: 'select 3;',
        connectionId: 'conn-3',
        dbName: 'scratch',
      },
    ], saveQuery, writeSQLFile);

    expect(writeSQLFile).toHaveBeenCalledWith('/tmp/file.sql', 'select 1;');
    expect(saveQuery).toHaveBeenCalledWith(expect.objectContaining({
      id: 'saved-1',
      sql: 'select 2;',
      connectionId: 'conn-2',
      dbName: 'reporting',
    }));
    expect(saveQuery).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New query',
      sql: 'select 3;',
      connectionId: 'conn-3',
      dbName: 'scratch',
    }));
  });

  it('reuses the temporary tab identity so saving on later exits does not create history copies', async () => {
    const tab = createQueryTab({
      id: 'tab-3',
      title: 'New query',
      query: 'select 3;',
    });
    const target = {
      kind: 'unsaved-query' as const,
      tabId: tab.id,
      title: tab.title,
      draft: tab.query || '',
      connectionId: tab.connectionId,
      dbName: tab.dbName || '',
    };
    const persistedQueries = new Map<string, SavedQuery>();
    const saveQuery = vi.fn(async (query: SavedQuery) => {
      persistedQueries.set(query.id, query);
      return query;
    });

    await saveApplicationQuitUnsavedSQLTargets([target], saveQuery);
    const savedQuery = Array.from(persistedQueries.values())[0];
    const targetsAfterRestart = await collectApplicationQuitUnsavedSQLTargets(
      [tab],
      [savedQuery],
      vi.fn(),
    );

    expect(savedQuery.id).toBe(tab.id);
    expect(targetsAfterRestart).toEqual([]);
  });
});
