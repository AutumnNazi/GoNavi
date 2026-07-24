import { t } from '../i18n';
import type { TabData } from '../types';

export const DATA_IMPORT_WORKBENCH_TAB_ID = 'data-import-workbench';

export type BuildDataImportWorkbenchTabInput = {
  connectionId?: string;
  dbName?: string;
  tableName?: string;
  title?: string;
};

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  const normalized = String(value || '').trim();
  return normalized || undefined;
};

export const buildDataImportWorkbenchTab = (
  input: BuildDataImportWorkbenchTabInput = {},
): TabData => ({
  id: DATA_IMPORT_WORKBENCH_TAB_ID,
  title: String(input.title || t('data_import.workbench.title')).trim()
    || t('data_import.workbench.title'),
  type: 'data-import' as TabData['type'],
  connectionId: normalizeOptionalText(input.connectionId) || '',
  dbName: normalizeOptionalText(input.dbName),
  tableName: normalizeOptionalText(input.tableName),
  initialTab: 'target',
});

export const resolveDataImportWorkbenchLaunchTab = (
  existingTab: TabData | undefined,
  input: BuildDataImportWorkbenchTabInput = {},
): TabData => (
  existingTab?.type === 'data-import' && existingTab.dataImportRunning
    ? existingTab
    : buildDataImportWorkbenchTab(input)
);
