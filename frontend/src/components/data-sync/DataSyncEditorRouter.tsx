import React from 'react';
import { DataSyncTaskEditor as TransferEditor } from './DataSyncTaskEditor';
import { DataSyncBackupEditor } from './DataSyncBackupEditor';

export const DataSyncTaskEditor: React.FC<React.ComponentProps<typeof TransferEditor>> = (props) =>
  props.task.kind === 'backup' ? <DataSyncBackupEditor {...props} /> : <TransferEditor {...props} />;
