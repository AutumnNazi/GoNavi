import { t } from '../i18n';
import type { TabData } from '../types';

export const DATA_IMPORT_WORKBENCH_TAB_ID = 'data-import-workbench';

export type DataImportMode = 'table' | 'database';

export type BuildDataImportWorkbenchTabInput = {
  connectionId?: string;
  dbName?: string;
  tableName?: string;
  mode?: DataImportMode;
  launchKey?: string;
  title?: string;
};

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  const normalized = String(value || '').trim();
  return normalized || undefined;
};

export const buildDataImportWorkbenchTab = (
  input: BuildDataImportWorkbenchTabInput = {},
): TabData => {
  const mode: DataImportMode = input.mode === 'database' ? 'database' : 'table';
  const launchKey = normalizeOptionalText(input.launchKey)
    || `data-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: DATA_IMPORT_WORKBENCH_TAB_ID,
    title: String(input.title || t('data_import.workbench.title')).trim()
      || t('data_import.workbench.title'),
    type: 'data-import' as TabData['type'],
    connectionId: normalizeOptionalText(input.connectionId) || '',
    dbName: normalizeOptionalText(input.dbName),
    tableName: mode === 'table' ? normalizeOptionalText(input.tableName) : undefined,
    dataImportMode: mode,
    dataImportLaunchKey: launchKey,
    initialTab: 'target',
  };
};

export const resolveDataImportWorkbenchLaunchTab = (
  existingTab: TabData | undefined,
  input: BuildDataImportWorkbenchTabInput = {},
): TabData => (
  existingTab?.type === 'data-import' && existingTab.dataImportRunning
    ? existingTab
    : buildDataImportWorkbenchTab(input)
);
