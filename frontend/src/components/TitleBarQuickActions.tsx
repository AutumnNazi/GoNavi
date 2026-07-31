import React from 'react';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { MoreOutlined } from '@ant-design/icons';

export interface TitleBarQuickAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  priority?: 'primary' | 'secondary';
  menu?: TitleBarQuickAction[];
}

interface TitleBarQuickActionsProps {
  label: string;
  moreLabel: string;
  actions: TitleBarQuickAction[];
}

const TitleBarQuickActions: React.FC<TitleBarQuickActionsProps> = ({ label, moreLabel, actions }) => {
  const primaryActions = actions.filter((action) => action.priority !== 'secondary');
  const secondaryActions = actions.filter((action) => action.priority === 'secondary');
  const buildMenuItems = (menuActions: TitleBarQuickAction[]): MenuProps['items'] => menuActions.map((action) => ({
    key: action.key,
    icon: action.icon,
    label: action.label,
    onClick: action.onClick,
    disabled: action.disabled,
    children: action.menu ? buildMenuItems(action.menu) : undefined,
  }));
  const menuItems = buildMenuItems(secondaryActions);

  return (
    <div className="gn-v2-titlebar-quick-actions" data-titlebar-quick-actions="true" role="group" aria-label={label}>
      <div className="gn-v2-titlebar-quick-primary">
        {primaryActions.map((action) => (
          action.menu && action.menu.length > 0 ? (
            <Tooltip key={action.key} title={action.menu.map((menuAction) => menuAction.label).join('、')} placement="bottom" mouseEnterDelay={0.35}>
              <Dropdown menu={{ items: buildMenuItems(action.menu) }} trigger={['click']} placement="bottomLeft">
                <button
                  type="button"
                  className="gn-v2-titlebar-quick-action gn-v2-titlebar-quick-menu"
                  data-titlebar-quick-menu={action.key}
                  aria-label={action.label}
                  title={action.label}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              </Dropdown>
            </Tooltip>
          ) : (
            <Tooltip key={action.key} title={action.label} placement="bottom" mouseEnterDelay={0.35}>
              <button
                type="button"
                className="gn-v2-titlebar-quick-action"
                data-titlebar-quick-action={action.key}
                aria-label={action.label}
                title={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            </Tooltip>
          )
        ))}
      </div>
      {secondaryActions.length > 0 && (
        <Tooltip title={secondaryActions.map((action) => action.label).join('、')} placement="bottom" mouseEnterDelay={0.35}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomLeft">
            <button
              type="button"
              className="gn-v2-titlebar-quick-more"
              aria-label={moreLabel}
              title={moreLabel}
              data-titlebar-quick-more="true"
            >
              <MoreOutlined aria-hidden="true" />
              <span>{moreLabel}</span>
            </button>
          </Dropdown>
        </Tooltip>
      )}
    </div>
  );
};

export default TitleBarQuickActions;
