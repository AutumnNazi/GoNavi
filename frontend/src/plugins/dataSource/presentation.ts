import { t } from '../../i18n';
import { parsePluginDataSourceType } from './identity';
import { findPluginDataSource, getPluginDataSourceSnapshot } from './snapshot';
const reasons = new Set(['disabled', 'starting', 'stopping', 'faulted', 'blocked', 'runtime_unavailable', 'safe_mode', 'missing', 'invalid', 'catalog_error']);
/** Full status keys behind the dynamic lookup, kept literal for the i18n invariant. */
export const PLUGIN_DATASOURCE_STATUS_KEYS = [
  'plugin.datasource.status.disabled',
  'plugin.datasource.status.starting',
  'plugin.datasource.status.stopping',
  'plugin.datasource.status.faulted',
  'plugin.datasource.status.blocked',
  'plugin.datasource.status.runtime_unavailable',
  'plugin.datasource.status.safe_mode',
  'plugin.datasource.status.missing',
  'plugin.datasource.status.invalid',
  'plugin.datasource.status.catalog_error',
] as const;
export function pluginDataSourceUnavailableReason(type: string): string {
  if (!parsePluginDataSourceType(type)) return t('plugin.datasource.status.invalid');
  const item = findPluginDataSource(type);
  if (item?.connectable) return '';
  const reason = item?.reason || (getPluginDataSourceSnapshot().error ? 'catalog_error' : 'missing');
  return t('plugin.datasource.status.' + (reasons.has(reason) ? reason : 'runtime_unavailable'));
}
export function pluginDataSourceDisplayName(type: string): string {
  const item = findPluginDataSource(type);
  const identity = parsePluginDataSourceType(type);
  return item?.name || (identity ? identity.pluginId + ' / ' + identity.id : type);
}
