import React from 'react';
import {
  ApiOutlined,
  AppstoreOutlined,
  ExperimentOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

export type AISettingsSectionKey =
  | 'providers'
  | 'safety'
  | 'context'
  | 'mcp'
  | 'skills'
  | 'prompts'
  | 'tools';

export const AI_SETTINGS_NAV_ITEMS: Array<{
  key: AISettingsSectionKey;
  titleKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
}> = [
  { key: 'providers', titleKey: 'ai_settings.nav.providers.title', descriptionKey: 'ai_settings.nav.providers.description', icon: <ApiOutlined /> },
  { key: 'safety', titleKey: 'ai_settings.nav.safety.title', descriptionKey: 'ai_settings.nav.safety.description', icon: <SafetyCertificateOutlined /> },
  { key: 'context', titleKey: 'ai_settings.nav.context.title', descriptionKey: 'ai_settings.nav.context.description', icon: <RobotOutlined /> },
  { key: 'mcp', titleKey: 'ai_settings.nav.mcp.title', descriptionKey: 'ai_settings.nav.mcp.description', icon: <AppstoreOutlined /> },
  { key: 'skills', titleKey: 'ai_settings.nav.skills.title', descriptionKey: 'ai_settings.nav.skills.description', icon: <ExperimentOutlined /> },
  { key: 'tools', titleKey: 'ai_settings.nav.tools.title', descriptionKey: 'ai_settings.nav.tools.description', icon: <ToolOutlined /> },
  { key: 'prompts', titleKey: 'ai_settings.nav.prompts.title', descriptionKey: 'ai_settings.nav.prompts.description', icon: <ExperimentOutlined /> },
];

interface AISettingsSidebarProps {
  activeSection: AISettingsSectionKey;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  onSelectSection: (section: AISettingsSectionKey) => void;
}

const AISettingsSidebar: React.FC<AISettingsSidebarProps> = ({
  activeSection,
  darkMode,
  overlayTheme,
  onSelectSection,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);

  return (
    <div
      className="gonavi-ai-settings-sidebar"
      style={{
        minHeight: 0,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '0 14px 24px 0',
        borderRight: `1px solid ${overlayTheme.divider}`,
      }}
    >
      <div style={{ marginBottom: 10, paddingLeft: 10, fontSize: 'var(--gn-font-size-sm, 12px)', fontWeight: 700, color: overlayTheme.titleText }}>{copy('ai_settings.nav.title')}</div>
      <div
        role="tablist"
        aria-label={copy('ai_settings.nav.title')}
        aria-orientation="vertical"
        style={{ display: 'grid', borderTop: `1px solid ${overlayTheme.divider}` }}
      >
        {AI_SETTINGS_NAV_ITEMS.map((item, itemIndex) => {
          const active = activeSection === item.key;
          return (
            <button
              className={`gonavi-ai-settings-nav-item${active ? ' is-active' : ''}`}
              key={item.key}
              id={`gonavi-ai-settings-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`gonavi-ai-settings-panel-${item.key}`}
              tabIndex={active ? 0 : -1}
              title={`${copy(item.titleKey)} - ${copy(item.descriptionKey)}`}
              onClick={() => onSelectSection(item.key)}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  return;
                }
                event.preventDefault();
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? AI_SETTINGS_NAV_ITEMS.length - 1
                    : event.key === 'ArrowDown'
                      ? (itemIndex + 1) % AI_SETTINGS_NAV_ITEMS.length
                      : (itemIndex - 1 + AI_SETTINGS_NAV_ITEMS.length) % AI_SETTINGS_NAV_ITEMS.length;
                onSelectSection(AI_SETTINGS_NAV_ITEMS[nextIndex].key);
                const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
                tabs?.[nextIndex]?.focus();
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                minHeight: 44,
                padding: '10px 10px',
                borderRadius: 0,
                border: 'none',
                borderBottom: `1px solid ${overlayTheme.divider}`,
                borderLeft: `3px solid ${active ? overlayTheme.selectedText : 'transparent'}`,
                background: active ? overlayTheme.selectedBg : 'transparent',
                color: active ? (darkMode ? '#f5f7ff' : '#162033') : (darkMode ? 'rgba(255,255,255,0.82)' : '#3f4b5e'),
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, color: active ? overlayTheme.iconColor : overlayTheme.mutedText }}>{item.icon}</span>
                <span style={{ fontSize: 'var(--gn-font-size, 14px)', fontWeight: 700 }}>{copy(item.titleKey)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AISettingsSidebar;
