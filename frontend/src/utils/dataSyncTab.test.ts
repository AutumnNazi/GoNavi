import { afterEach, describe, expect, it } from 'vitest';

import { setCurrentLanguage, t } from '../i18n';
import { getTabDisplayKindLabel } from './tabDisplay';
import {
  buildDataSyncWorkbenchTab,
  resolveDataSyncWorkbenchTabId,
} from './dataSyncTab';

describe('dataSyncTab', () => {
  afterEach(() => {
    setCurrentLanguage('zh-CN');
  });

  it('builds one stable workbench tab for each data workflow entry', () => {
    expect(resolveDataSyncWorkbenchTabId('sync')).toBe('data-sync-workbench-sync');
    expect(resolveDataSyncWorkbenchTabId('schemaCompare')).toBe('data-sync-workbench-schema-compare');
    expect(resolveDataSyncWorkbenchTabId('dataCompare')).toBe('data-sync-workbench-data-compare');

    expect(buildDataSyncWorkbenchTab({ entryMode: 'schemaCompare' })).toMatchObject({
      id: 'data-sync-workbench-schema-compare',
      title: t('data_sync.entry_mode.schema_compare.title'),
      type: 'data-sync',
      connectionId: '',
      dataSyncEntryMode: 'schemaCompare',
    });
    expect(getTabDisplayKindLabel(buildDataSyncWorkbenchTab({ entryMode: 'sync' }))).toBe('SYNC');
  });

  it('localizes default titles without changing stable tab ids', () => {
    setCurrentLanguage('en-US');

    const tab = buildDataSyncWorkbenchTab({ entryMode: 'dataCompare' });

    expect(tab.id).toBe('data-sync-workbench-data-compare');
    expect(tab.title).toBe(t('data_sync.entry_mode.data_compare.title'));
  });
});
