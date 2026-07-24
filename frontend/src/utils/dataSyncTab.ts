import type { TabData } from '../types';
import { t } from '../i18n';
import {
  resolveDataSyncEntryModePresentation,
  type DataSyncEntryMode,
} from '../components/dataSyncEntryMode';

type BuildDataSyncWorkbenchTabInput = {
  entryMode: DataSyncEntryMode;
  title?: string;
};

const DATA_SYNC_ENTRY_MODE_SLUGS: Record<DataSyncEntryMode, string> = {
  sync: 'sync',
  schemaCompare: 'schema-compare',
  dataCompare: 'data-compare',
};

export const resolveDataSyncWorkbenchTabId = (
  entryMode: DataSyncEntryMode,
): string => `data-sync-workbench-${DATA_SYNC_ENTRY_MODE_SLUGS[entryMode]}`;

export const buildDataSyncWorkbenchTab = (
  input: BuildDataSyncWorkbenchTabInput,
): TabData => {
  const presentation = resolveDataSyncEntryModePresentation(input.entryMode, t);
  const title = String(input.title || presentation.title).trim() || presentation.title;

  return {
    id: resolveDataSyncWorkbenchTabId(input.entryMode),
    title,
    type: 'data-sync',
    connectionId: '',
    dataSyncEntryMode: input.entryMode,
  };
};
