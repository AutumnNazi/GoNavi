import type { ExternalSQLDirectory, TabData } from '../../types';
import {
  buildExternalSQLTabId,
  normalizeExternalSQLPath,
  resolveExternalSQLFileBinding,
} from '../../utils/externalSqlTree';
import { buildSQLFileExecutionWorkbenchTab } from '../../utils/sqlFileExecutionTab';
import { normalizeSQLFileReadContent } from '../../utils/sqlFileTabDirty';

const SQL_DROP_FILE_PATTERN = /\.sql$/i;
const REJECTED_NAME_PREVIEW_LIMIT = 3;

export type SqlDropPathPartition = {
  sqlFiles: string[];
  rejectedPaths: string[];
};

const toTrimmedPath = (value: unknown): string => String(value ?? '').trim();

// 拖入路径先去重再分区：只有扩展名 .sql（大小写不敏感）的文件进入编辑器
// 打开流程，其余路径留给上层提示。.sql.gz 等压缩文件不匹配，会被明确拒绝。
export const partitionSqlDropPaths = (paths: unknown): SqlDropPathPartition => {
  const list = Array.isArray(paths) ? paths : [];
  const sqlFiles: string[] = [];
  const rejectedPaths: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const path = toTrimmedPath(raw);
    if (!path) continue;
    const dedupeKey = path.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (SQL_DROP_FILE_PATTERN.test(path)) {
      sqlFiles.push(path);
    } else {
      rejectedPaths.push(path);
    }
  }
  return { sqlFiles, rejectedPaths };
};

const compareSqlDropPaths = (left: string, right: string): number => {
  const normalizedLeft = left.replace(/\\/g, '/').toLowerCase();
  const normalizedRight = right.replace(/\\/g, '/').toLowerCase();
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
};

// 多文件拖入按路径排序保证稳定的建标签顺序，不依赖系统给出的拖放顺序。
export const sortSqlDropPaths = (paths: string[]): string[] => (
  [...paths].sort(compareSqlDropPaths)
);

export const resolveSqlDropFileTitle = (filePath: string): string => {
  const normalized = toTrimmedPath(filePath).replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : normalized;
};

export const formatRejectedSqlDropNames = (rejectedPaths: string[]): string => (
  rejectedPaths
    .slice(0, REJECTED_NAME_PREVIEW_LIMIT)
    .map(resolveSqlDropFileTitle)
    .join('、')
);

export type ExternalSqlFileDropReadResult = {
  success: boolean;
  message?: string;
  data?: unknown;
};

export type ExternalSqlFileDropStoreSnapshot = {
  tabs: TabData[];
  externalSQLDirectories: ExternalSQLDirectory[];
};

export type ExternalSqlFileDropDeps = {
  readSqlFile: (filePath: string) => Promise<ExternalSqlFileDropReadResult>;
  getSnapshot: () => ExternalSqlFileDropStoreSnapshot;
  getSQLFileTabDraft: (tabId: string, fallback: string) => string;
  addTab: (tab: TabData) => void;
  setActiveTab: (tabId: string) => void;
  notify: (level: 'info' | 'warning' | 'error', text: string) => void;
  translate: (key: string, params?: Record<string, string>) => string;
};

export type ExternalSqlFileDropContext = {
  connectionId: string;
  dbName: string;
};

type LargeFilePayload = {
  isLargeFile?: unknown;
  filePath?: unknown;
  fileSizeMB?: unknown;
};

const readLargeFilePayload = (data: unknown): LargeFilePayload | null => {
  if (!data || typeof data !== 'object') return null;
  const payload = data as LargeFilePayload;
  return payload.isLargeFile === true ? payload : null;
};

// 找到包含拖入文件的外部 SQL 目录（最长路径匹配，与
// resolveExternalSQLFileBinding 的目录匹配规则一致）。
const findSqlDropDirectory = (
  directories: ExternalSQLDirectory[],
  filePath: string,
): ExternalSQLDirectory | undefined => {
  const normalizedFilePath = normalizeExternalSQLPath(filePath);
  if (!normalizedFilePath) return undefined;
  const matching = directories
    .map((directory) => {
      const raw = normalizeExternalSQLPath(directory.path);
      return {
        directory,
        dirPath: raw === '/' ? '/' : raw.replace(/\/+$/u, ''),
      };
    })
    .filter(({ dirPath }) => Boolean(dirPath) && (
      dirPath === '/'
        ? normalizedFilePath.startsWith('/')
        : normalizedFilePath === dirPath || normalizedFilePath.startsWith(`${dirPath}/`)
    ))
    .sort((left, right) => right.dirPath.length - left.dirPath.length);
  return matching[0]?.directory;
};

// 解析拖入文件的连接上下文：文件级显式绑定 > 所属目录的默认连接 >
// 拖放目标查询标签页的连接与库。目录默认连接与侧栏打开同一文件时的
// 继承语义对齐，避免同一文件因入口不同落在不同标签页。
export const resolveSqlDropOpenContext = (
  directories: ExternalSQLDirectory[],
  filePath: string,
  fallbackContext: ExternalSqlFileDropContext,
): ExternalSqlFileDropContext => {
  const binding = resolveExternalSQLFileBinding(directories, filePath, {
    connectionId: fallbackContext.connectionId,
    dbName: fallbackContext.dbName,
  });
  if (binding && binding.connectionId) {
    return {
      connectionId: binding.connectionId,
      dbName: String(binding.dbName || '').trim(),
    };
  }
  const directory = findSqlDropDirectory(directories, filePath);
  const directoryConnectionId = String(directory?.connectionId || '').trim();
  if (directoryConnectionId) {
    return {
      connectionId: directoryConnectionId,
      dbName: String(directory?.dbName || '').trim(),
    };
  }
  return fallbackContext;
};

// 打开单个拖入的 .sql 文件：
// - 复用 ReadSQLFile 的后端路径校验与 50MB 上限；
// - 超限文件转入 SQL 执行工作台（需要连接上下文）；
// - 同一文件已有标签页时绝不静默覆盖，只切换过去；
// - 新文件建带 filePath 的查询标签页，天然获得保存/脏检查能力。
// store 快照在读取完成后才获取：读取期间标签页可能被关闭或新建，
// 基于过期快照决策会切换到已关闭的标签或覆盖刚建好的内容。
export const openDroppedSqlFile = async (
  deps: ExternalSqlFileDropDeps,
  filePath: string,
  fallbackContext: ExternalSqlFileDropContext,
): Promise<void> => {
  const fileTitle = resolveSqlDropFileTitle(filePath);

  let result: ExternalSqlFileDropReadResult;
  try {
    result = await deps.readSqlFile(filePath);
  } catch (error) {
    deps.notify('error', deps.translate('sidebar.message.read_sql_file_failed', {
      error: error instanceof Error ? error.message : String(error),
    }));
    return;
  }
  if (!result.success) {
    deps.notify('error', deps.translate('sidebar.message.read_sql_file_failed', {
      error: String(result.message || '').trim() || filePath,
    }));
    return;
  }

  const snapshot = deps.getSnapshot();
  const openContext = resolveSqlDropOpenContext(
    snapshot.externalSQLDirectories,
    filePath,
    fallbackContext,
  );

  const largeFile = readLargeFilePayload(result.data);
  if (largeFile) {
    if (!openContext.connectionId) {
      deps.notify('warning', deps.translate('query_editor.message.external_sql_drop_large_file_no_connection', {
        name: fileTitle,
      }));
      return;
    }
    deps.addTab(buildSQLFileExecutionWorkbenchTab({
      connectionId: openContext.connectionId,
      dbName: openContext.dbName || undefined,
      filePath: toTrimmedPath(largeFile.filePath) || filePath,
      fileName: fileTitle,
      fileSizeMB: toTrimmedPath(largeFile.fileSizeMB) || undefined,
      autoStart: false,
    }));
    return;
  }

  const content = normalizeSQLFileReadContent(result.data);
  const tabId = buildExternalSQLTabId(openContext.connectionId, openContext.dbName, filePath);
  const existingTab = snapshot.tabs.find((tab) => tab.id === tabId);
  if (existingTab) {
    // 标签页当前内容（草稿优先）与磁盘文件不一致时可能是未保存修改，
    // 也可能是文件在磁盘上被更新；两种情况都不覆盖，仅提示并切换。
    if (existingTab.type === 'query') {
      const currentContent = deps.getSQLFileTabDraft(tabId, String(existingTab.query ?? ''));
      if (currentContent !== content) {
        deps.notify('info', deps.translate('query_editor.message.external_sql_drop_existing_tab_preserved', {
          name: fileTitle,
        }));
      }
    }
    deps.setActiveTab(tabId);
    return;
  }

  deps.addTab({
    id: tabId,
    title: fileTitle,
    type: 'query',
    connectionId: openContext.connectionId,
    ...(openContext.dbName ? { dbName: openContext.dbName } : {}),
    query: content,
    filePath,
  });
};

export const openDroppedSqlFiles = async (
  deps: ExternalSqlFileDropDeps,
  sqlFiles: string[],
  fallbackContext: ExternalSqlFileDropContext,
): Promise<void> => {
  for (const filePath of sqlFiles) {
    await openDroppedSqlFile(deps, filePath, fallbackContext);
  }
};
