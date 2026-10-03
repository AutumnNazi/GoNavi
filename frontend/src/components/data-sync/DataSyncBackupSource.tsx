import React from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import type { DataSyncBackupEditorProps } from './dataSyncBackupEditorProps';
import { DataSyncEndpointSelector } from './DataSyncEndpointSelector';
import { useDataSyncSavedConnections, useDataSyncDatabases } from './useDataSyncMetadata';

export const DataSyncBackupSource: React.FC<DataSyncBackupEditorProps> = ({ task, gateway, connectionTree = [], t, onPatch }) => {
  const tr = useOptionalI18n()?.t || translate;
  const connections = useDataSyncSavedConnections(gateway);
  const databases = useDataSyncDatabases(gateway, task.source.connectionId,
    connections.items.some((connection) => connection.id === task.source.connectionId));
  return <section className="gn-data-sync-section">
    <h2>{tr('data_sync.backup.title')}</h2>
    <p>{tr('data_sync.backup.source_help')}</p>
    <label className="gn-data-sync-field">
      <span>{t('editor.task_name')}</span>
      <input className="gn-data-sync-control" value={task.name} onChange={(event) => onPatch({ name: event.target.value })} />
    </label>
    <DataSyncEndpointSelector role="source" title={t('editor.source_endpoint')} endpoint={task.source}
      connections={connections} databases={databases} connectionTree={connectionTree} t={t}
      onConnectionChange={(connection) => onPatch({
        source: { connectionId: connection?.id || '', connectionName: connection?.name || '', type: connection?.type || '', database: '', schema: '' }, mappings: [],
      })}
      onDatabaseChange={(database) => onPatch({ source: { ...task.source, database, schema: '' }, mappings: [] })}
      onSchemaChange={(schema) => onPatch({ source: { ...task.source, schema }, mappings: [] })}
    />
  </section>;
};
