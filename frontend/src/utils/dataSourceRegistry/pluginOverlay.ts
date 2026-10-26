import type { DataSourceSpec } from './types';
import { parsePluginDataSourceType } from '../../plugins/dataSource/identity';
import { findPluginDataSource } from '../../plugins/dataSource/snapshot';
import pluginIcon from '../../plugins/dataSource/pluginDataSource.svg';

// Host-created syntax/form descriptors never register a driver factory or mutate builtins.
export function getPluginDataSourceSpec(value: unknown): DataSourceSpec | undefined {
  const identity = parsePluginDataSourceType(value);
  if (!identity) return undefined;
  const item = findPluginDataSource(identity.type);
  return {
    type: identity.type, displayName: item?.name ?? identity.pluginId + ' / ' + identity.id,
    group: 'relational', wire: 'plugin', dialect: identity.type, ddlDialect: identity.dialect,
    defaultPort: item?.defaultPort ?? 0, protection: true, excelImport: false, sqlFileImport: false,
    sync: { source: false, target: false }, agent: { buildTag: '' }, variants: { default: '', items: [] },
    ui: { usernameOptional: true, defaultUser: '', ssl: false, sslCAPath: false, sslClientCert: false,
      connectionParams: true, networkSections: [], hintKey: 'plugin.datasource.read_only',
      icon: { asset: pluginIcon, color: '#15803d' }, quoting: identity.dialect === 'mysql' ? 'backtick' : identity.dialect === 'postgres' ? 'pg' : 'double',
      hiddenObjectGroups: ['routines', 'events', 'sequences'], formatDdl: false },
  };
}
