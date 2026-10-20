import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';
import type { TitlebarActionsDisplay, TitlebarActionsPlacement, TitlebarActionsPlacementSettings as ActionsSettings } from '../../utils/titlebarActionsPlacement';
import SettingsPills, { type PillOption } from './SettingsPills';

import './TitlebarActionsPlacementSettings.css';

type Values = Pick<ActionsSettings, 'titlebarActionsPlacement' | 'titlebarActionsDisplay'>;
type Props = { value?: Values; onChange?: (patch: Partial<Values>) => void; section?: 'all' | 'placement' | 'display' };

// 功能入口位置及标题栏显示方式；受控模式用于预览，默认直接更新设置。
export default function TitlebarActionsPlacementSettings({ value, onChange, section = 'all' }: Props = {}) {
  const { t } = useI18n();
  const activePlacement = useStore((state) => state.appearance.titlebarActionsPlacement);
  const activeDisplay = useStore((state) => state.appearance.titlebarActionsDisplay);
  const setAppearance = useStore((state) => state.setAppearance);
  const placement = value?.titlebarActionsPlacement ?? activePlacement;
  const display = value?.titlebarActionsDisplay ?? activeDisplay;
  const update = onChange ?? setAppearance;
  const placementOptions: PillOption<TitlebarActionsPlacement>[] = [
    { value: 'toolbar', label: t('app.theme.titlebar_actions_placement.toolbar') },
    { value: 'titlebar', label: t('app.theme.titlebar_actions_placement.titlebar') },
  ];
  const displayOptions: PillOption<TitlebarActionsDisplay>[] = [
    { value: 'text', label: t('app.theme.titlebar_actions_placement.display.text') },
    { value: 'icon', label: t('app.theme.titlebar_actions_placement.display.icon') },
    { value: 'icon-text', label: t('app.theme.titlebar_actions_placement.display.icon_text') },
  ];
  const displayControl = <SettingsPills
    ariaLabel={t('app.theme.titlebar_actions_placement.display_title')}
    dataAttribute="data-titlebar-actions-display" options={displayOptions} value={display}
    onChange={(value) => update({ titlebarActionsDisplay: value })}
  />;
  if (section === 'display') return displayControl;

  return (
    <div data-titlebar-actions-placement-settings="true">
      <SettingsPills
        ariaLabel={t('app.theme.titlebar_actions_placement.title')}
        dataAttribute="data-titlebar-actions-placement"
        options={placementOptions}
        value={placement}
        onChange={(value) => update({ titlebarActionsPlacement: value })}
      />
      {section === 'all' && placement === 'titlebar' && (
        <div className="gonavi-settings-row is-stacked gn-titlebar-actions-display-settings" data-titlebar-actions-display-settings="true">
          <div>
            <div className="gonavi-settings-label">{t('app.theme.titlebar_actions_placement.display_title')}</div>
            <div className="gonavi-settings-label-hint">{t('app.theme.titlebar_actions_placement.display_hint')}</div>
          </div>
          <div className="gonavi-settings-control">
            {displayControl}
          </div>
        </div>
      )}
    </div>
  );
}
