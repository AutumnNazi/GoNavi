import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';
import type { SidebarActionsPlacement } from '../../utils/titlebarActionsPlacement';
import SettingsPills from './SettingsPills';

// 新版左侧搜索模式：命令面板 / 常驻过滤框。
export function SidebarSearchModeSettings() {
  const { t } = useI18n();
  const mode = useStore((state) => state.appearance.v2SidebarSearchMode ?? 'command');
  const setAppearance = useStore((state) => state.setAppearance);
  return (
    <SettingsPills
      ariaLabel={t('app.theme.ui_version.sidebar_search.title')}
      options={[
        { value: 'command', label: t('app.theme.ui_version.sidebar_search.command') },
        { value: 'filter', label: t('app.theme.ui_version.sidebar_search.filter') },
      ]}
      value={mode}
      onChange={(value) => setAppearance({ v2SidebarSearchMode: value })}
    />
  );
}

// 侧栏工具按钮位置；受控模式用于预览，默认直接更新设置。
export function SidebarActionsPlacementSettings({ value, onChange }: {
  value?: SidebarActionsPlacement; onChange?: (value: SidebarActionsPlacement) => void;
} = {}) {
  const { t } = useI18n();
  const placement = useStore((state) => state.appearance.sidebarActionsPlacement);
  const setAppearance = useStore((state) => state.setAppearance);
  return (
    <SettingsPills<SidebarActionsPlacement>
      ariaLabel={t('app.theme.sidebar_actions_placement.title')}
      dataAttribute="data-sidebar-actions-placement"
      options={[
        { value: 'toolbar', label: t('app.theme.sidebar_actions_placement.toolbar') },
        { value: 'rail', label: t('app.theme.sidebar_actions_placement.rail') },
      ]}
      value={value ?? placement}
      onChange={onChange ?? ((value) => setAppearance({ sidebarActionsPlacement: value }))}
    />
  );
}
