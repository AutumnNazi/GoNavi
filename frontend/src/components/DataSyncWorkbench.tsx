import React, { useCallback } from 'react';

import { useStore } from '../store';
import type { TabData } from '../types';
import DataSyncModal from './DataSyncModal';
import type { DataSyncEntryMode } from './dataSyncEntryMode';

const resolveEntryMode = (tab: TabData): DataSyncEntryMode => {
  if (tab.dataSyncEntryMode === 'schemaCompare' || tab.dataSyncEntryMode === 'dataCompare') {
    return tab.dataSyncEntryMode;
  }
  return 'sync';
};

const DataSyncWorkbench: React.FC<{ tab: TabData }> = ({ tab }) => {
  const closeTab = useStore((state) => state.closeTab);
  const handleClose = useCallback(() => {
    closeTab(tab.id);
  }, [closeTab, tab.id]);

  return (
    <div
      data-data-sync-workbench="true"
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
    >
      <DataSyncModal
        embedded
        open
        taskKey={tab.id}
        entryMode={resolveEntryMode(tab)}
        onClose={handleClose}
      />
    </div>
  );
};

export default DataSyncWorkbench;
