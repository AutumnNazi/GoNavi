import type { ConnectionConfig } from '../../typeDefs/connectionTypes';
import type { DataSourceCapabilityContract } from '../../utils/dataSourceCapabilities';
import { parsePluginDataSourceType } from './identity';
import { findPluginDataSource } from './snapshot';

type PluginCapabilityConfig = Pick<ConnectionConfig, 'pluginWritable' | 'readOnly'> | null | undefined;

export function pluginDataSourceCapabilities(type: string, directType: boolean, config?: PluginCapabilityConfig): DataSourceCapabilityContract {
  const identity = parsePluginDataSourceType(type);
  const source = findPluginDataSource(type);
  const available = directType && Boolean(identity && source?.available);
  // A declared writable source stays closed until this connection opts in;
  // the backend enforces the same rule before exposing transactions.
  const writable = available && source?.readOnly === false && config?.pluginWritable === true && config?.readOnly !== true;
  const unsupported = () => ({ supported: false, messageKey: 'plugin.datasource.read_only' });
  const readable = () => ({ supported: available, ...(available ? {} : { messageKey: 'plugin.datasource.status.runtime_unavailable' }) });
  return {
    type, query: readable(), metadata: readable(), cancel: readable(), transaction: writable ? readable() : unsupported(),
    pagination: unsupported(), schema: unsupported(), sampling: unsupported(), streaming: unsupported(), dangerousOperations: unsupported(),
    ui: { explainDiagnosis: false, sqlQueryExport: false, copyInsert: false, mockData: false, copyTable: false,
      createDatabase: false, createDatabaseCharset: false, renameDatabase: false, dropDatabase: false, messagePublish: false,
      forceReadOnlyQueryResult: !writable, forceReadOnlyStructureDesigner: !writable, userManagement: false },
    navigation: { primaryVisibilitySupported: available, primaryKind: available ? 'database' : 'none',
      secondarySchemaVisibilitySupported: false, schemaIdentifierCaseSensitive: identity?.dialect === 'postgres' },
  };
}
