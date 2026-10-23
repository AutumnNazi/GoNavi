import { getDbIcon } from '../DatabaseIcons';
import { buildConnectionTypeGroups } from '../../utils/connectionTypeCatalog';
import type { PluginDataSourceDescriptor } from '../../plugins/dataSource/types';
import { buildPluginDataSourcePickerItems } from './pluginDataSourcePicker';

export function buildPickerTypeGroups(translate: NonNullable<Parameters<typeof buildConnectionTypeGroups>[0]>, plugins: readonly PluginDataSourceDescriptor[] = [], savedTypes: readonly string[] = []) {
  const groups = buildConnectionTypeGroups(translate).map(group => ({
    ...group, items: group.items.map(item => ({ ...item, icon: getDbIcon(item.key, undefined, 32) })),
  }));
  const pluginItems = buildPluginDataSourcePickerItems(plugins, savedTypes).map(item => ({ ...item, icon: getDbIcon(item.key, undefined, 32) }));
  if (pluginItems.length) groups.push({ labelKey: 'plugin.datasource.group', label: translate('plugin.datasource.group'), items: pluginItems });
  const seen = new Set<string>();
  const items = groups.flatMap(group => group.items).filter(item => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  return [{ labelKey: 'connection_modal.step1.group.all', label: translate('connection.modal.step1.group.all'), items }, ...groups];
}
