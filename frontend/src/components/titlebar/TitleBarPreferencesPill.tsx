import { Button, Tooltip } from 'antd';

import { TitlebarSettingsIcon, TitlebarSunIcon } from './gonaviTitlebarIcons';
import './titleBarPreferencesPill.css';

export interface TitleBarPreferencesPillProps {
  /** 「偏好设置」段文案。 */
  preferencesLabel: string;
  /** 「主题」段文案。 */
  themeLabel: string;
  /** 当前是否暗色，用于切换图标语义与 aria-pressed。 */
  isDarkTheme: boolean;
  onOpenPreferences: () => void;
  onToggleTheme: () => void;
  /** 主题按钮的 tooltip，例如「切换到浅色」。 */
  themeTooltip?: string;
  preferencesTestId?: string;
  themeTestId?: string;
}

/**
 * 标题栏右侧的「偏好设置 │ 主题」分段胶囊。
 *
 * 参考稿里这两段共用一个白色圆角容器，中间以细竖线分隔；
 * 主题段是一键切换明暗，不弹菜单。
 */
export default function TitleBarPreferencesPill({
  preferencesLabel,
  themeLabel,
  isDarkTheme,
  onOpenPreferences,
  onToggleTheme,
  themeTooltip,
  preferencesTestId = 'gonavi-titlebar-preferences-action',
  themeTestId = 'gonavi-titlebar-theme-action',
}: TitleBarPreferencesPillProps) {
  const themeButton = (
    <Button
      type="text"
      size="small"
      className="gn-preferences-pill-segment gn-preferences-pill-theme"
      data-gonavi-theme-toggle-action="true"
      data-testid={themeTestId}
      aria-label={themeLabel}
      aria-pressed={isDarkTheme}
      onClick={onToggleTheme}
    >
      <TitlebarSunIcon className="gn-preferences-pill-icon" />
      <span className="gn-preferences-pill-label">{themeLabel}</span>
    </Button>
  );

  return (
    <div className="gn-preferences-pill" data-gonavi-preferences-pill="true">
      <Button
        type="text"
        size="small"
        className="gn-preferences-pill-segment gn-preferences-pill-preferences"
        data-gonavi-preferences-action="true"
        data-testid={preferencesTestId}
        aria-label={preferencesLabel}
        onClick={onOpenPreferences}
      >
        <TitlebarSettingsIcon className="gn-preferences-pill-icon" />
        <span className="gn-preferences-pill-label">{preferencesLabel}</span>
      </Button>
      <span className="gn-preferences-pill-divider" aria-hidden="true" />
      {themeTooltip ? (
        <Tooltip title={themeTooltip}>{themeButton}</Tooltip>
      ) : (
        themeButton
      )}
    </div>
  );
}
