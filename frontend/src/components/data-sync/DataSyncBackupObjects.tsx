import React, { useState } from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import type { DataSyncBackupEditorProps } from './dataSyncBackupEditorProps';
import { DataSyncObjectPicker } from './DataSyncObjectPicker';
import { createDataSyncTableMapping } from './model';
import { useDataSyncObjects } from './useDataSyncMetadata';

export const DataSyncBackupObjects: React.FC<DataSyncBackupEditorProps> = ({ task, gateway, t, onPatch }) => {
  const tr = useOptionalI18n()?.t || translate;
  const objects = useDataSyncObjects(gateway, task.source);
  const [open, setOpen] = useState(false);
  return <section className="gn-data-sync-section">
    <h2>{tr('data_sync.backup.objects')}</h2>
    {objects.error ? <p role="alert">{objects.error}</p> : null}
    <button className="gn-data-sync-button" disabled={objects.status !== 'ready'} onClick={() => setOpen(true)}>{tr('data_sync.backup.add_objects')}</button>
    <ul className="gn-data-sync-backup-objects">
      {task.mappings.map((mapping) => <li key={mapping.id}>
        <label><input type="checkbox" checked={mapping.enabled} onChange={(event) => onPatch({ mappings: task.mappings.map((item) => item.id === mapping.id ? { ...item, enabled: event.target.checked } : item) })} /> {mapping.sourceObject}</label>
        <button className="gn-data-sync-button" onClick={() => onPatch({ mappings: task.mappings.filter((item) => item.id !== mapping.id) })}>{tr('data_sync.backup.remove')}</button>
      </li>)}
    </ul>
    <DataSyncObjectPicker open={open} objects={objects.items.filter((item) => item.kind === 'table')}
      mappedSourceNames={task.mappings.map((mapping) => mapping.sourceObject)} t={t} onClose={() => setOpen(false)}
      onConfirm={(names) => {
        onPatch({ mappings: [...task.mappings, ...names.map((name) => ({ ...createDataSyncTableMapping(`${task.id}:backup:${name}`), sourceObject: name, targetObject: '', targetMode: 'existing_only' as const }))] });
        setOpen(false);
      }} />
  </section>;
};
