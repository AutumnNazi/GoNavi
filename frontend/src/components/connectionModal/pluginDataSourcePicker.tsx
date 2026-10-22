import type { ConnectionTypeCatalogItem, ConnectionTypeCatalogTranslator } from '../../utils/connectionTypeCatalog';
import type { PluginDataSourceDescriptor } from '../../plugins/dataSource/types';
import { isPluginDataSourceNamespace } from '../../plugins/dataSource/identity';
import { findPluginDataSource } from '../../plugins/dataSource/snapshot';
import { pluginDataSourceDisplayName, pluginDataSourceUnavailableReason } from '../../plugins/dataSource/presentation';
import { t } from '../../i18n';

export function buildPluginDataSourcePickerItems(items: readonly PluginDataSourceDescriptor[], savedTypes: readonly string[]): ConnectionTypeCatalogItem[] {
  const names = new Map(items.map((item) => [item.type, item.name]));
  for (const type of savedTypes) if (isPluginDataSourceNamespace(type) && !names.has(type)) names.set(type, pluginDataSourceDisplayName(type));
  return [...names].map(([key, name]) => ({ key, name }));
}
export function pluginDataSourcePickerHint(type: string, translate: ConnectionTypeCatalogTranslator = t): string {
  const item = findPluginDataSource(type);
  return pluginDataSourceUnavailableReason(type) || (item?.available ? translate(item.readOnly ? 'plugin.datasource.read_only_description' : 'plugin.datasource.read_write_description') : translate('plugin.datasource.start_on_connect'));
}
export function PluginDataSourcePickerStatus({ type }: { type: string }) {
  const item = findPluginDataSource(type);
  return <span className="gn-conn-type-card-tag">{t(item?.available ? 'plugin.datasource.status.running' : 'plugin.datasource.status.' + (item?.state ?? 'missing'))}</span>;
}
