import { afterEach, describe, expect, it } from 'vitest';
import { buildPickerTypeGroups } from '../../components/connectionModal/connectionTypePickerCatalog';
import { pluginDataSourceUnavailableReason } from './presentation';
import { replacePluginDataSources } from './snapshot';
import { decodePluginDataSources } from './decode';
import { getDataSourceCapabilities } from '../../utils/dataSourceCapabilities';
const type = 'plugin:demo.source:reader:mysql';
const item = { type, pluginId: 'demo.source', id: 'reader', name: 'Read-only fixture', dialect: 'mysql', defaultPort: 0, version: '1',
  generation: 0, available: false, connectable: true, state: 'starting', readOnly: true, reason: 'starting' };
afterEach(() => replacePluginDataSources({ items: [] }));
describe('plugin-only connection selector', () => {
  it('lists eligible and inactive sources without replacing builtin groups', () => {
    const sources = decodePluginDataSources({ items: [item] }); replacePluginDataSources({ items: sources });
    const groups = buildPickerTypeGroups((key) => key, sources, ['plugin:missing.source:reader:sqlite']);
    expect(groups.some((group) => group.items.some((entry) => entry.key === 'mysql'))).toBe(true);
    const plugins = groups.find((group) => group.labelKey === 'plugin.datasource.group')!;
    expect(plugins.items.map((entry) => entry.key)).toEqual([type, 'plugin:missing.source:reader:sqlite']);
    expect(pluginDataSourceUnavailableReason(type)).toBe('');
    expect(getDataSourceCapabilities({ type }).query.supported).toBe(false);
    expect(pluginDataSourceUnavailableReason('plugin:missing.source:reader:sqlite')).toBeTruthy();
  });
  it('keeps disabled datasource cards identifiable but not eligible', () => {
    replacePluginDataSources({ items: [{ ...item, state: 'disabled', connectable: false, reason: 'disabled' }] });
    expect(pluginDataSourceUnavailableReason(type)).toBeTruthy();
  });
});
