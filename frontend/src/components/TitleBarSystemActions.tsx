import React from 'react';
import { Button, Tooltip } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

import TitleBarPreferencesPill from './titlebar/TitleBarPreferencesPill';
import { TitlebarSparkIcon } from './titlebar/gonaviTitlebarIcons';

type TitleBarSystemActionsProps = {
  aiAssistantLabel: string;
  settingsLabel: string;
  aiActive: boolean;
  onToggleAI: () => void;
  onOpenSettings: () => void;
  /** 主题段文案；不传则不渲染胶囊的主题行为（保持旧的设置按钮语义）。 */
  themeLabel?: string;
  isDarkTheme?: boolean;
  onToggleTheme?: () => void;
  themeTooltip?: string;
};

const TitleBarSystemActions: React.FC<TitleBarSystemActionsProps> = ({
  aiAssistantLabel,
  settingsLabel,
  aiActive,
  onToggleAI,
  onOpenSettings,
  themeLabel,
  isDarkTheme = false,
  onToggleTheme,
  themeTooltip,
}) => (
  <div
    className="gn-v2-titlebar-system-actions"
    data-titlebar-system-actions="true"
    data-no-titlebar-toggle="true"
    role="toolbar"
    aria-label={`${aiAssistantLabel} / ${settingsLabel}`}
    onDoubleClick={(event) => event.stopPropagation()}
  >
    <Tooltip title={aiAssistantLabel} placement="bottom" mouseEnterDelay={0.35}>
      <Button
        size="small"
        type="text"
        className={`gn-v2-titlebar-system-action${aiActive ? ' is-active' : ''}`}
        /* 定制图标必须显式定尺：antd 只对内置 .anticon 施加尺寸，
           传 size="100%" 会填满按钮内容槽、比相邻图标大近一倍。 */
        icon={<TitlebarSparkIcon size="1.42em" />}
        aria-label={aiAssistantLabel}
        aria-pressed={aiActive}
        data-gonavi-ai-entry-action="true"
        onClick={onToggleAI}
      />
    </Tooltip>
    {themeLabel && onToggleTheme ? (
      <TitleBarPreferencesPill
        preferencesLabel={settingsLabel}
        themeLabel={themeLabel}
        isDarkTheme={isDarkTheme}
        onOpenPreferences={onOpenSettings}
        onToggleTheme={onToggleTheme}
        themeTooltip={themeTooltip}
      />
    ) : (
      <Tooltip title={settingsLabel} placement="bottom" mouseEnterDelay={0.35}>
        <Button
          size="small"
          type="text"
          className="gn-v2-titlebar-system-action"
          icon={<SettingOutlined />}
          aria-label={settingsLabel}
          data-sidebar-settings-action="true"
          data-titlebar-settings-action="true"
          onClick={onOpenSettings}
        />
      </Tooltip>
    )}
  </div>
);

export default TitleBarSystemActions;
