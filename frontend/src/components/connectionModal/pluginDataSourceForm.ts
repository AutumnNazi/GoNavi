import type { ConnectionConfig, SavedConnection } from '../../types';
import { isPluginDataSourceNamespace, parsePluginDataSourceType } from '../../plugins/dataSource/identity';
import { findPluginDataSource } from '../../plugins/dataSource/snapshot';
import { pluginDataSourceUnavailableReason } from '../../plugins/dataSource/presentation';
import { t } from '../../i18n';

export const pluginTransportDefaults = {
  useSSL: false, sslMode: 'disable', sslCAPath: '', sslCertPath: '', sslKeyPath: '',
  useSSH: false, useProxy: false, useHttpTunnel: false, driver: '', dsn: '', uri: '', driverVariant: '',
  keepAliveEnabled: false, keepAliveSQL: '', hosts: [], topology: 'single', jvm: undefined,
};
export function hasUnsupportedPluginTransport(values: Record<string, unknown>): boolean {
  return ['useSSL', 'useSSH', 'useProxy', 'useHttpTunnel', 'keepAliveEnabled'].some((key) => values[key] === true)
    || (typeof values.driverVariant === 'string' && !['', 'auto'].includes(values.driverVariant))
    || (typeof values.sslMode === 'string' && !['', 'disable'].includes(values.sslMode))
    || (values.hosts != null && (!Array.isArray(values.hosts) || values.hosts.length > 0)) || (values.jvm != null)
    || (typeof values.topology === 'string' && !['', 'single'].includes(values.topology))
    || ['sslCAPath', 'sslCertPath', 'sslKeyPath', 'driver', 'dsn', 'uri', 'keepAliveSQL'].some((key) => String(values[key] ?? '').trim() !== '');
}
export function pluginDataSourceNewValues(type: string) {
  return { ...pluginTransportDefaults, type, host: '', port: findPluginDataSource(type)?.defaultPort ?? 0, user: '', password: '',
    database: '', connectionParams: '', savePassword: true, restrictDataEdit: true, restrictStructureEdit: true,
    restrictScriptExecution: true, restrictDataImport: true, timeout: 30 };
}
export function pluginDataSourceInitialValues(config: ConnectionConfig): Record<string, unknown> {
  if (!isPluginDataSourceNamespace(config.type)) return {};
  return { hosts: config.hosts ?? [], topology: config.topology ?? 'single', jvm: config.jvm, host: config.host, port: config.port, user: config.user, password: config.password, database: config.database ?? '',
    driverVariant: config.driverVariant ?? '', connectionParams: config.connectionParams ?? '', uri: config.uri ?? '', dsn: config.dsn ?? '', driver: config.driver ?? '',
    useSSL: config.useSSL === true, sslMode: config.sslMode ?? 'disable', sslCAPath: config.sslCAPath ?? '',
    sslCertPath: config.sslCertPath ?? '', sslKeyPath: config.sslKeyPath ?? '', useSSH: config.useSSH === true,
    useProxy: config.useProxy === true, useHttpTunnel: config.useHttpTunnel === true,
    keepAliveEnabled: config.keepAliveEnabled === true, keepAliveSQL: config.keepAliveSQL ?? '',
    restrictDataEdit: config.protection?.restrictDataEdit === true || !config.pluginWritable,
    restrictStructureEdit: config.protection?.restrictStructureEdit === true || !config.pluginWritable,
    restrictScriptExecution: config.protection?.restrictScriptExecution === true || !config.pluginWritable,
    restrictDataImport: config.protection?.restrictDataImport === true || !config.pluginWritable };
}
export function buildPluginDataSourceConfig(values: Record<string, unknown>, forPersist: boolean, initial?: SavedConnection | null): ConnectionConfig {
  const type = typeof values.type === 'string' ? values.type : '';
  if (!parsePluginDataSourceType(type) && (!forPersist || initial?.config.type !== type)) throw new Error(t('plugin.datasource.status.invalid'));
  if (hasUnsupportedPluginTransport(values)) throw new Error(t('plugin.datasource.unsupported_transport'));
  if (!forPersist) { const reason = pluginDataSourceUnavailableReason(type); if (reason) throw new Error(reason); }
  const port = Number(values.port ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(t('plugin.datasource.invalid_port'));
  const text = (key: string) => typeof values[key] === 'string' ? values[key] as string : '';
  const writable = findPluginDataSource(type)?.readOnly === false || (initial?.config.type === type && initial.config.pluginWritable === true);
  const flag = (key: string) => !writable || values[key] === true;
  const protection = { restrictDataEdit: flag('restrictDataEdit'), restrictStructureEdit: flag('restrictStructureEdit'),
    restrictScriptExecution: flag('restrictScriptExecution'), restrictDataImport: flag('restrictDataImport') };
  const readOnly = Object.values(protection).every(Boolean);
  return { id: initial?.id || text('id') || undefined, type, host: text('host'), port, user: text('user'), password: text('password'),
    database: text('database'), connectionParams: text('connectionParams'), savePassword: values.savePassword !== false,
    timeout: Math.min(300, Math.max(1, Number(values.timeout) || 30)), readOnly, pluginWritable: writable, sslMode: 'disable',
    protection };
}
