import { SHORTCUT_ACTION_META, SHORTCUT_ACTION_ORDER } from '../../../utils/shortcuts';
import {
  defineSettingsCenterPageEntries as page,
  type SettingsCenterSearchEntrySource,
} from '../settingsCenterSearchEntries';

/**
 * Settings inside the tool-center pages (数据与安全) that render inside the
 * settings center. The editor/driver tools and the workbench tabs (SQL audit,
 * request diagnostics, DML snapshot, data sync/compare) open their own
 * surfaces and are reachable as title-bar or menu entries only. The shortcut
 * manager lives under 偏好设置 as a preference.
 */
export const TOOLS_SEARCH_ENTRIES: ReadonlyArray<SettingsCenterSearchEntrySource> = [
  ...page('config', 'data-root-saved-queries', [
    'app.data_root.saved_query_directory.apply_title',
  ]),

  ...page('config', 'security-update', [
    'security_update.settings.scope_title',
    'security_update.settings.action.start',
    'security_update.settings.action.retry_check',
  ]),

  {
    group: 'preferences',
    item: 'shortcut-settings',
    // One row per shortcut; the list and its texts live in utils/shortcuts.
    resolve: () => SHORTCUT_ACTION_ORDER.map((action) => ({
      id: action,
      label: SHORTCUT_ACTION_META[action].label,
      description: SHORTCUT_ACTION_META[action].description,
    })),
  },
];
