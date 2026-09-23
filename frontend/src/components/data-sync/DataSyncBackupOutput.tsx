import React from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import type { DataSyncBackupEditorProps } from './dataSyncBackupEditorProps';

export const DataSyncBackupOutput: React.FC<DataSyncBackupEditorProps> = ({ task, onPatch }) => {
  const tr = useOptionalI18n()?.t || translate;
  const backup = task.backup || { directory: '', content: 'both' as const };
  return <section className="gn-data-sync-section">
    <h2>{tr('data_sync.backup.directory')}</h2>
    <label className="gn-data-sync-field"><span>{tr('data_sync.backup.directory')}</span>
      <input className="gn-data-sync-control" value={backup.directory} onChange={(event) => onPatch({ backup: { ...backup, directory: event.target.value } })} />
      <small>{tr('data_sync.backup.directory_help')}</small>
    </label>
    <label className="gn-data-sync-field"><span>{tr('data_sync.backup.content')}</span>
      <select className="gn-data-sync-control" value={backup.content} onChange={(event) => onPatch({ backup: { ...backup, content: event.target.value as typeof backup.content } })}>
        <option value="both">{tr('data_sync.backup.content_both')}</option>
        <option value="schema">{tr('data_sync.backup.content_schema')}</option>
        <option value="data">{tr('data_sync.backup.content_data')}</option>
      </select>
    </label>
    <p className="gn-data-sync-inline-note" role="note">{tr('data_sync.backup.consistency')}</p>
  </section>;
};
