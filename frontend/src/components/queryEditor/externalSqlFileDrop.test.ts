import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../../types';
import {
  formatRejectedSqlDropNames,
  openDroppedSqlFile,
  openDroppedSqlFiles,
  partitionSqlDropPaths,
  resolveSqlDropFileTitle,
  resolveSqlDropOpenContext,
  sortSqlDropPaths,
  type ExternalSqlFileDropDeps,
  type ExternalSqlFileDropStoreSnapshot,
} from './externalSqlFileDrop';

type NotifyCall = { level: 'info' | 'warning' | 'error'; text: string };

const createDeps = (options?: {
  snapshot?: ExternalSqlFileDropStoreSnapshot;
  readResults?: Record<string, { success: boolean; message?: string; data?: unknown }>;
  tabs?: TabData[];
}): {
  deps: ExternalSqlFileDropDeps;
  addedTabs: TabData[];
  activatedTabIds: string[];
  notifications: NotifyCall[];
  drafts: Map<string, string>;
} => {
  const addedTabs: TabData[] = [];
  const activatedTabIds: string[] = [];
  const notifications: NotifyCall[] = [];
  const drafts = new Map<string, string>();
  const snapshot: ExternalSqlFileDropStoreSnapshot = options?.snapshot ?? {
    tabs: options?.tabs ?? [],
    externalSQLDirectories: [],
  };
  const readResults = options?.readResults ?? {};
  const deps: ExternalSqlFileDropDeps = {
    readSqlFile: vi.fn(async (filePath: string) => {
      const result = readResults[filePath];
      if (!result) {
        throw new Error(`unexpected read: ${filePath}`);
      }
      return result;
    }),
    getSnapshot: () => snapshot,
    getSQLFileTabDraft: (tabId, fallback) => drafts.get(tabId) ?? fallback,
    addTab: (tab) => addedTabs.push(tab),
    setActiveTab: (tabId) => activatedTabIds.push(tabId),
    notify: (level, text) => notifications.push({ level, text }),
    translate: (key, params) => {
      const suffix = params ? Object.values(params).join('|') : '';
      return suffix ? `${key}:${suffix}` : key;
    },
  };
  return { deps, addedTabs, activatedTabIds, notifications, drafts };
};

const FILE_PATH = 'D:/reports/daily.sql';
const FILE_TAB_ID = 'external-sql-tab:conn-1:app:D:/reports/daily.sql';

describe('partitionSqlDropPaths', () => {
  it('只接受 .sql 文件并忽略大小写', () => {
    const result = partitionSqlDropPaths([
      'D:/a.sql',
      'D:/b.SQL',
      'D:/c.sql.gz',
      'D:/d.txt',
      '',
    ]);
    expect(result.sqlFiles).toEqual(['D:/a.sql', 'D:/b.SQL']);
    expect(result.rejectedPaths).toEqual(['D:/c.sql.gz', 'D:/d.txt']);
  });

  it('按大小写去重同一路径', () => {
    const result = partitionSqlDropPaths(['D:/a.sql', 'd:/A.SQL']);
    expect(result.sqlFiles).toEqual(['D:/a.sql']);
    expect(result.rejectedPaths).toEqual([]);
  });

  it('容忍非数组输入', () => {
    expect(partitionSqlDropPaths(undefined)).toEqual({ sqlFiles: [], rejectedPaths: [] });
    expect(partitionSqlDropPaths(null)).toEqual({ sqlFiles: [], rejectedPaths: [] });
  });
});

describe('sortSqlDropPaths', () => {
  it('按归一化路径稳定排序并统一分隔符', () => {
    expect(sortSqlDropPaths([
      'D:/reports/z.sql',
      'D:\\reports\\a.sql',
      'D:/reports/m.sql',
    ])).toEqual([
      'D:\\reports\\a.sql',
      'D:/reports/m.sql',
      'D:/reports/z.sql',
    ]);
  });

  it('不修改原数组', () => {
    const input = ['b.sql', 'a.sql'];
    sortSqlDropPaths(input);
    expect(input).toEqual(['b.sql', 'a.sql']);
  });
});

describe('resolveSqlDropFileTitle / formatRejectedSqlDropNames', () => {
  it('从 Windows 与 POSIX 路径提取文件名', () => {
    expect(resolveSqlDropFileTitle('D:\\reports\\daily.sql')).toBe('daily.sql');
    expect(resolveSqlDropFileTitle('/home/user/init.sql')).toBe('init.sql');
  });

  it('拒绝列表只预览前三个名字', () => {
    expect(formatRejectedSqlDropNames(['1.txt', '2.csv', '3.json', '4.xml']))
      .toBe('1.txt、2.csv、3.json');
  });
});

describe('resolveSqlDropOpenContext', () => {
  it('外部 SQL 目录的文件级绑定优先于拖放目标上下文', () => {
    const directories = [{
      id: 'dir-1',
      name: 'reports',
      path: 'D:/reports',
      fileBindings: [{
        filePath: 'D:/reports/daily.sql',
        connectionId: 'conn-bound',
        dbName: 'analytics',
      }],
      createdAt: 0,
    }] as any;
    const context = resolveSqlDropOpenContext(directories, 'D:/reports/daily.sql', {
      connectionId: 'conn-1',
      dbName: 'app',
    });
    expect(context).toEqual({ connectionId: 'conn-bound', dbName: 'analytics' });
  });

  it('无文件级绑定时继承所属目录的默认连接', () => {
    const directories = [{
      id: 'dir-1',
      name: 'reports',
      path: 'D:/reports',
      connectionId: 'conn-dir',
      dbName: 'analytics',
      createdAt: 0,
    }] as any;
    const context = resolveSqlDropOpenContext(directories, 'D:/reports/daily.sql', {
      connectionId: 'conn-1',
      dbName: 'app',
    });
    expect(context).toEqual({ connectionId: 'conn-dir', dbName: 'analytics' });
  });

  it('目录无默认连接时沿用拖放目标上下文', () => {
    const directories = [{
      id: 'dir-1',
      name: 'reports',
      path: 'D:/reports',
      createdAt: 0,
    }] as any;
    const context = resolveSqlDropOpenContext(directories, 'D:/reports/daily.sql', {
      connectionId: 'conn-1',
      dbName: 'app',
    });
    expect(context).toEqual({ connectionId: 'conn-1', dbName: 'app' });
  });

  it('文件级绑定优先于目录默认连接', () => {
    const directories = [{
      id: 'dir-1',
      name: 'reports',
      path: 'D:/reports',
      connectionId: 'conn-dir',
      dbName: 'analytics',
      fileBindings: [{
        filePath: 'D:/reports/daily.sql',
        connectionId: 'conn-file',
        dbName: 'sales',
      }],
      createdAt: 0,
    }] as any;
    const context = resolveSqlDropOpenContext(directories, 'D:/reports/daily.sql', {
      connectionId: 'conn-1',
      dbName: 'app',
    });
    expect(context).toEqual({ connectionId: 'conn-file', dbName: 'sales' });
  });

  it('无绑定时沿用拖放目标上下文', () => {
    const context = resolveSqlDropOpenContext([], FILE_PATH, {
      connectionId: 'conn-1',
      dbName: 'app',
    });
    expect(context).toEqual({ connectionId: 'conn-1', dbName: 'app' });
  });
});

describe('openDroppedSqlFile', () => {
  it('为新的 .sql 文件创建带 filePath 的查询标签页', async () => {
    const { deps, addedTabs, activatedTabIds, notifications } = createDeps({
      readResults: { [FILE_PATH]: { success: true, data: 'SELECT 1' } },
    });
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(addedTabs).toHaveLength(1);
    expect(addedTabs[0]).toMatchObject({
      id: FILE_TAB_ID,
      title: 'daily.sql',
      type: 'query',
      connectionId: 'conn-1',
      dbName: 'app',
      query: 'SELECT 1',
      filePath: FILE_PATH,
    });
    expect(activatedTabIds).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('读取失败时提示错误且不建标签页', async () => {
    const { deps, addedTabs, notifications } = createDeps({
      readResults: { [FILE_PATH]: { success: false, message: 'file not found' } },
    });
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(addedTabs).toHaveLength(0);
    expect(notifications).toEqual([{
      level: 'error',
      text: 'sidebar.message.read_sql_file_failed:file not found',
    }]);
  });

  it('读取抛出异常时提示错误', async () => {
    const { deps, notifications } = createDeps();
    const depsWithThrow: ExternalSqlFileDropDeps = {
      ...deps,
      readSqlFile: () => Promise.reject(new Error('boom')),
    };
    await openDroppedSqlFile(depsWithThrow, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(notifications).toEqual([{
      level: 'error',
      text: 'sidebar.message.read_sql_file_failed:boom',
    }]);
  });

  it('已有同文件标签页且内容一致时只切换不重建', async () => {
    const existingTab: TabData = {
      id: FILE_TAB_ID,
      title: 'daily.sql',
      type: 'query',
      connectionId: 'conn-1',
      dbName: 'app',
      query: 'SELECT 1',
      filePath: FILE_PATH,
    } as TabData;
    const { deps, addedTabs, activatedTabIds, notifications } = createDeps({
      tabs: [existingTab],
      readResults: { [FILE_PATH]: { success: true, data: 'SELECT 1' } },
    });
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(addedTabs).toHaveLength(0);
    expect(activatedTabIds).toEqual([FILE_TAB_ID]);
    expect(notifications).toEqual([]);
  });

  it('已有标签页存在未保存修改时不静默覆盖', async () => {
    const existingTab: TabData = {
      id: FILE_TAB_ID,
      title: 'daily.sql',
      type: 'query',
      connectionId: 'conn-1',
      dbName: 'app',
      query: 'SELECT 1',
      filePath: FILE_PATH,
    } as TabData;
    const { deps, addedTabs, activatedTabIds, notifications, drafts } = createDeps({
      tabs: [existingTab],
      readResults: { [FILE_PATH]: { success: true, data: 'SELECT 2' } },
    });
    drafts.set(FILE_TAB_ID, 'SELECT 1 -- draft');
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(addedTabs).toHaveLength(0);
    expect(activatedTabIds).toEqual([FILE_TAB_ID]);
    expect(notifications).toEqual([{
      level: 'info',
      text: 'query_editor.message.external_sql_drop_existing_tab_preserved:daily.sql',
    }]);
  });

  it('超限大文件转入 SQL 执行工作台标签页', async () => {
    const { deps, addedTabs, notifications } = createDeps({
      readResults: {
        [FILE_PATH]: {
          success: true,
          data: { isLargeFile: true, filePath: FILE_PATH, fileSizeMB: '80.0' },
        },
      },
    });
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(addedTabs).toHaveLength(1);
    expect(addedTabs[0]).toMatchObject({
      type: 'sql-file-execution',
      connectionId: 'conn-1',
      dbName: 'app',
      filePath: FILE_PATH,
    });
    expect(notifications).toEqual([]);
  });

  it('超限大文件且无连接上下文时仅提示', async () => {
    const { deps, addedTabs, notifications } = createDeps({
      readResults: {
        [FILE_PATH]: {
          success: true,
          data: { isLargeFile: true, filePath: FILE_PATH, fileSizeMB: '80.0' },
        },
      },
    });
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: '', dbName: '' });
    expect(addedTabs).toHaveLength(0);
    expect(notifications).toEqual([{
      level: 'warning',
      text: 'query_editor.message.external_sql_drop_large_file_no_connection:daily.sql',
    }]);
  });

  it('读取期间已有标签页被关闭时基于最新快照重建标签', async () => {
    const existingTab: TabData = {
      id: FILE_TAB_ID,
      title: 'daily.sql',
      type: 'query',
      connectionId: 'conn-1',
      dbName: 'app',
      query: 'SELECT 1',
      filePath: FILE_PATH,
    } as TabData;
    const snapshot: ExternalSqlFileDropStoreSnapshot = {
      tabs: [existingTab],
      externalSQLDirectories: [],
    };
    const { deps, addedTabs, activatedTabIds } = createDeps({ snapshot });
    const depsWithLateClose: ExternalSqlFileDropDeps = {
      ...deps,
      readSqlFile: async () => {
        // 模拟读取期间用户关闭了同文件标签页
        snapshot.tabs = [];
        return { success: true, data: 'SELECT 1' };
      },
    };
    await openDroppedSqlFile(depsWithLateClose, FILE_PATH, { connectionId: 'conn-1', dbName: 'app' });
    expect(activatedTabIds).toEqual([]);
    expect(addedTabs).toHaveLength(1);
    expect(addedTabs[0]).toMatchObject({ id: FILE_TAB_ID, query: 'SELECT 1' });
  });

  it('无连接上下文时仍可打开普通大小的文件', async () => {
    const { deps, addedTabs } = createDeps({
      readResults: { [FILE_PATH]: { success: true, data: 'SELECT 1' } },
    });
    await openDroppedSqlFile(deps, FILE_PATH, { connectionId: '', dbName: '' });
    expect(addedTabs).toHaveLength(1);
    expect(addedTabs[0]).toMatchObject({
      id: 'external-sql-tab:::D:/reports/daily.sql',
      type: 'query',
      filePath: FILE_PATH,
    });
  });
});

describe('openDroppedSqlFiles', () => {
  it('按传入顺序逐个打开', async () => {
    const { deps, addedTabs } = createDeps({
      readResults: {
        'D:/a.sql': { success: true, data: 'A' },
        'D:/b.sql': { success: true, data: 'B' },
      },
    });
    await openDroppedSqlFiles(deps, ['D:/a.sql', 'D:/b.sql'], { connectionId: 'conn-1', dbName: 'app' });
    expect(addedTabs.map((tab) => tab.query)).toEqual(['A', 'B']);
  });
});
