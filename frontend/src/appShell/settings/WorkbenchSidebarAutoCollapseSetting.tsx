import { Switch } from 'antd';
import type { ThemeAppearanceSettingsSectionProps } from './ThemeAppearanceSettingsSection';

type Props = Pick<ThemeAppearanceSettingsSectionProps, 'appearance' | 'setAppearance' | 't' | 'renderThemeSettingsRow'>;

export const WorkbenchSidebarAutoCollapseSetting = ({ appearance, setAppearance, t, renderThemeSettingsRow }: Props) => (
  <>{renderThemeSettingsRow({
    label: t('app.theme.appearance.workbench_sidebar_auto_collapse_title'),
    hint: t('app.theme.appearance.workbench_sidebar_auto_collapse_hint'),
    control: <Switch
      aria-label={t('app.theme.appearance.workbench_sidebar_auto_collapse_title')}
      checked={appearance.workbenchSidebarAutoCollapse === true}
      onChange={checked => setAppearance({ workbenchSidebarAutoCollapse: checked })}
    />,
  })}</>
);
