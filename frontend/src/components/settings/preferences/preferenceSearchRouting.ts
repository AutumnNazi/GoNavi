import type { SettingsCenterSearchEntrySource } from '../settingsCenterSearchEntries';
import type { PreferencePage } from './preferencePages';

export function routePreferenceSearchEntry(entry: SettingsCenterSearchEntrySource): SettingsCenterSearchEntrySource {
  if (entry.group !== 'preferences') return entry;
  const label = 'labelKey' in entry ? entry.labelKey : '';
  let page: PreferencePage | undefined;
  if (entry.item === 'sidebar-metadata' || entry.item === 'sidebar-objects') page = 'sidebar-settings';
  if (entry.item === 'theme-theme') {
    page = label.includes('sidebar_search') ? 'sidebar-settings'
      : /titlebar_actions_placement|sidebar_actions_placement/.test(label) ? 'layout-settings' : 'colors-settings';
  }
  if (entry.item === 'theme-appearance') {
    page = /single_database_expansion|workbench_sidebar_auto_collapse/.test(label) ? 'sidebar-settings'
      : label.includes('navicat_layout') ? 'layout-settings' : 'fonts-settings';
  }
  if (entry.item === 'theme-workspace') page = /tab_display|tab_appearance/.test(label) ? 'tabs-settings' : 'editor-settings';
  return page ? { ...entry, group: page, item: page } : entry;
}
