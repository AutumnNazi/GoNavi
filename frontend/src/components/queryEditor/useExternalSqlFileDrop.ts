import { useEffect } from 'react';
import { message } from 'antd';

import { t } from '../../i18n';
import { useStore } from '../../store';
import { getSQLFileTabDraft } from '../../utils/sqlFileTabDrafts';
import { ReadSQLFile } from '../../../wailsjs/go/app/App';
import { OnFileDrop, OnFileDropOff } from '../../../wailsjs/runtime';
import {
  formatRejectedSqlDropNames,
  openDroppedSqlFiles,
  partitionSqlDropPaths,
  sortSqlDropPaths,
  type ExternalSqlFileDropContext,
  type ExternalSqlFileDropDeps,
} from './externalSqlFileDrop';

// Wails 的 OnFileDrop 只允许注册一次（后续调用被运行时静默跳过），而查询
// 编辑器会随标签页多实例挂载。这里用模块级引用计数保证整个窗口只注册一个
// 回调；回调内全部状态在事件发生时从 store 读取，避免闭包过期。
let sharedDropRegistrationCount = 0;
let sharedDropCleanup: (() => void) | null = null;

const buildDropDeps = (): ExternalSqlFileDropDeps => ({
  readSqlFile: ReadSQLFile,
  getSnapshot: () => {
    const state = useStore.getState();
    return {
      tabs: state.tabs,
      externalSQLDirectories: state.externalSQLDirectories,
    };
  },
  getSQLFileTabDraft,
  addTab: (tab) => useStore.getState().addTab(tab),
  setActiveTab: (tabId) => useStore.getState().setActiveTab(tabId),
  notify: (level, text) => {
    message[level](text);
  },
  translate: (key, params) => t(key, params),
});

const resolveActiveDropContext = (): ExternalSqlFileDropContext => {
  const state = useStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return {
    connectionId: String(activeTab?.connectionId || '').trim(),
    dbName: String(activeTab?.dbName || '').trim(),
  };
};

const handleExternalSqlFileDrop = (
  _x: number,
  _y: number,
  paths: string[],
): void => {
  const { sqlFiles, rejectedPaths } = partitionSqlDropPaths(paths);
  if (rejectedPaths.length > 0) {
    message.warning(t('query_editor.message.external_sql_drop_rejected_files', {
      count: rejectedPaths.length,
      names: formatRejectedSqlDropNames(rejectedPaths),
    }));
  }
  if (sqlFiles.length === 0) return;
  void openDroppedSqlFiles(
    buildDropDeps(),
    sortSqlDropPaths(sqlFiles),
    resolveActiveDropContext(),
  );
};

const isWailsFileDropRuntimeAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  const runtime = (window as { runtime?: { OnFileDrop?: unknown; OnFileDropOff?: unknown } }).runtime;
  return typeof runtime?.OnFileDrop === 'function'
    && typeof runtime?.OnFileDropOff === 'function';
};

export const useExternalSqlFileDrop = (): void => {
  useEffect(() => {
    if (!isWailsFileDropRuntimeAvailable()) return undefined;
    if (sharedDropRegistrationCount === 0) {
      // useDropTarget=true：只有拖到带 --wails-drop-target 样式的元素上才回调
      //（样式挂在 QueryEditor 的 Monaco stage 上，见 App.css）。
      OnFileDrop(handleExternalSqlFileDrop, true);
      sharedDropCleanup = () => OnFileDropOff();
    }
    sharedDropRegistrationCount += 1;
    return () => {
      sharedDropRegistrationCount -= 1;
      if (sharedDropRegistrationCount === 0 && sharedDropCleanup) {
        sharedDropCleanup();
        sharedDropCleanup = null;
      }
    };
  }, []);
};
