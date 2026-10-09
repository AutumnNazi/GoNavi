import type { QueryEditorResultSet } from '../components/QueryEditorResultsPanel';
import type { TabData } from '../types';

export type QueryEditorResultSessionSnapshot = {
  resultSets: QueryEditorResultSet[];
  activeResultKey: string;
  isResultPanelVisible?: boolean;
  /** Serializable Monaco cursor, selection, scroll, and contribution state. */
  editorViewState?: unknown;
};

const cache = new Map<string, QueryEditorResultSessionSnapshot>();
const listeners = new Map<string, Set<(snapshot: QueryEditorResultSessionSnapshot | null) => void>>();

// 会话缓存上限：限制常驻的结果集会话数量，防止 detach/attach 或反复挂载时大量结果集
// （含大行数 rows）堆积在内存中拖垮低配机。
// 取 24 而非 32：GoNavi 单条快照比 yxdb 更大（额外含 Monaco editorViewState），
// 同条目数下内存占用更高；而真实并发量是「编辑器已卸载但仍持有会话的标签页」数，
// 远低于该值，收紧不会影响正常使用。
const QUERY_EDITOR_RESULT_SESSION_MAX_ENTRIES = 24;

const notifyQueryEditorResultSession = (
  tabId: string,
  snapshot: QueryEditorResultSessionSnapshot | null,
): void => {
  listeners.get(tabId)?.forEach((listener) => listener(snapshot));
};

// 记录一次写入并把该条目移到队尾（Map 迭代序 = 写入序，队首最旧）。
// 之所以按「写入」而非「读取」定序：peekQueryEditorResultSession 被 nativeDetachedWindowHost
// 在打开窗口等只读路径调用，让它改序会把一次查看算作一次访问，反而挤掉真正在用的会话。
const touchQueryEditorResultSession = (id: string): void => {
  const snapshot = cache.get(id);
  if (!snapshot) return;
  cache.delete(id);
  cache.set(id, snapshot);
};

// 淘汰最久未写入的条目，保持缓存大小在上限内。
// 淘汰时显式通知 null：订阅方（分离窗口同步）据此走「保留上一份快照」的既有分支，
// 不会把 null 当成「会话为空」广播出去。
const evictQueryEditorResultSessionsIfNeeded = (): void => {
  while (cache.size > QUERY_EDITOR_RESULT_SESSION_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
    notifyQueryEditorResultSession(oldestKey, null);
  }
};

export const saveQueryEditorResultSession = (
  tabId: string,
  snapshot: QueryEditorResultSessionSnapshot,
): void => {
  const id = String(tabId || '').trim();
  if (!id) return;
  const nextSnapshot = {
    resultSets: Array.isArray(snapshot.resultSets) ? snapshot.resultSets : [],
    activeResultKey: String(snapshot.activeResultKey || ''),
    isResultPanelVisible: snapshot.isResultPanelVisible,
    ...(snapshot.editorViewState !== undefined
      ? { editorViewState: snapshot.editorViewState }
      : {}),
  };
  cache.set(id, nextSnapshot);
  // Map 对已存在的 key 赋值不会改变迭代序，必须显式搬运才能把这次写入记为最新，
  // 否则「长期存在的标签页反复保存」会被当成最旧条目优先淘汰。
  touchQueryEditorResultSession(id);
  evictQueryEditorResultSessionsIfNeeded();
  notifyQueryEditorResultSession(id, nextSnapshot);
};

export const saveQueryEditorResultSessionForOpenTab = (
  tabId: string,
  snapshot: QueryEditorResultSessionSnapshot,
  tabs: readonly Pick<TabData, 'id'>[] | null | undefined,
): boolean => {
  const id = String(tabId || '').trim();
  if (!id || !Array.isArray(tabs) || !tabs.some((tab) => tab.id === id)) {
    return false;
  }
  saveQueryEditorResultSession(id, snapshot);
  return true;
};

export const saveQueryEditorResultSessionForOpenQueryTab = (
  tab: Pick<TabData, 'id' | 'type'> | null | undefined,
  snapshot: QueryEditorResultSessionSnapshot | null | undefined,
  tabs: readonly Pick<TabData, 'id'>[] | null | undefined,
): boolean => (
  tab?.type === 'query' && snapshot
    ? saveQueryEditorResultSessionForOpenTab(tab.id, snapshot, tabs)
    : false
);

export const takeQueryEditorResultSession = (
  tabId: string,
): QueryEditorResultSessionSnapshot | null => {
  const id = String(tabId || '').trim();
  if (!id) return null;
  const snapshot = cache.get(id) || null;
  if (snapshot) {
    cache.delete(id);
    notifyQueryEditorResultSession(id, null);
  }
  return snapshot;
};

export const peekQueryEditorResultSession = (
  tabId: string,
): QueryEditorResultSessionSnapshot | null => {
  const id = String(tabId || '').trim();
  if (!id) return null;
  return cache.get(id) || null;
};

export const clearQueryEditorResultSession = (tabId: string): void => {
  const id = String(tabId || '').trim();
  if (!id) return;
  cache.delete(id);
  notifyQueryEditorResultSession(id, null);
};

export const subscribeQueryEditorResultSession = (
  tabId: string,
  listener: (snapshot: QueryEditorResultSessionSnapshot | null) => void,
): (() => void) => {
  const id = String(tabId || '').trim();
  if (!id) return () => undefined;
  const tabListeners = listeners.get(id) || new Set();
  tabListeners.add(listener);
  listeners.set(id, tabListeners);
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(id);
    }
  };
};
