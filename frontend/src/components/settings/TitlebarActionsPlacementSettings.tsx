import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';
import type { TitlebarActionsDisplay, TitlebarActionsPlacement } from '../../utils/titlebarActionsPlacement';

import './TitlebarActionsPlacementSettings.css';

interface PillOption<T extends string> {
  value: T;
  label: string;
}

interface SettingsPillsProps<T extends string> {
  ariaLabel: string;
  dataAttribute: string;
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** 与「新版左侧搜索模式」一致的分段按钮。 */
function SettingsPills<T extends string>({ ariaLabel, dataAttribute, options, value, onChange }: SettingsPillsProps<T>) {
  return (
    <div className="gonavi-settings-pills" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`gonavi-settings-pill${active ? ' is-active' : ''}`}
            aria-pressed={active}
            {...{ [dataAttribute]: option.value }}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 功能入口位置：独立工具条（图标 + 文字）或标题栏 GoNavi 右侧。
 * 选择标题栏后，再提供纯文字 / 纯图标 / 图标 + 文字三种显示方式。
 */
export default function TitlebarActionsPlacementSettings() {
  const { t } = useI18n();
  const placement = useStore((state) => state.appearance.titlebarActionsPlacement);
  const display = useStore((state) => state.appearance.titlebarActionsDisplay);
  const setAppearance = useStore((state) => state.setAppearance);
  const placementOptions: PillOption<TitlebarActionsPlacement>[] = [
    { value: 'toolbar', label: t('app.theme.titlebar_actions_placement.toolbar') },
    { value: 'titlebar', label: t('app.theme.titlebar_actions_placement.titlebar') },
  ];
  const displayOptions: PillOption<TitlebarActionsDisplay>[] = [
    { value: 'text', label: t('app.theme.titlebar_actions_placement.display.text') },
    { value: 'icon', label: t('app.theme.titlebar_actions_placement.display.icon') },
    { value: 'icon-text', label: t('app.theme.titlebar_actions_placement.display.icon_text') },
  ];

  return (
    <div data-titlebar-actions-placement-settings="true">
      <SettingsPills
        ariaLabel={t('app.theme.titlebar_actions_placement.title')}
        dataAttribute="data-titlebar-actions-placement"
        options={placementOptions}
        value={placement}
        onChange={(value) => setAppearance({ titlebarActionsPlacement: value })}
      />
      {placement === 'titlebar' && (
        <div className="gonavi-settings-row is-stacked gn-titlebar-actions-display-settings" data-titlebar-actions-display-settings="true">
          <div>
            <div className="gonavi-settings-label">{t('app.theme.titlebar_actions_placement.display_title')}</div>
            <div className="gonavi-settings-label-hint">{t('app.theme.titlebar_actions_placement.display_hint')}</div>
          </div>
          <div className="gonavi-settings-control">
            <SettingsPills
              ariaLabel={t('app.theme.titlebar_actions_placement.display_title')}
              dataAttribute="data-titlebar-actions-display"
              options={displayOptions}
              value={display}
              onChange={(value) => setAppearance({ titlebarActionsDisplay: value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
