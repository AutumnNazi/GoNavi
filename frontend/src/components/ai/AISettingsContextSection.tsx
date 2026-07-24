import React from 'react';
import { DatabaseOutlined, ExpandOutlined, LayoutOutlined, ProfileOutlined, TableOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AIChatOpenMode } from '../../store';
import type { AIContextLevel } from '../../types';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AISettingsChoiceGroup from './AISettingsChoiceGroup';

const CONTEXT_OPTIONS: {
  labelKey: string;
  value: AIContextLevel;
  descKey: string;
  icon: React.ReactNode;
  lightIconColor: string;
  darkIconColor: string;
}[] = [
  { labelKey: 'ai_settings.context.schema_only.label', value: 'schema_only', descKey: 'ai_settings.context.schema_only.desc', icon: <TableOutlined />, lightIconColor: '#0284c7', darkIconColor: '#38bdf8' },
  { labelKey: 'ai_settings.context.with_samples.label', value: 'with_samples', descKey: 'ai_settings.context.with_samples.desc', icon: <DatabaseOutlined />, lightIconColor: '#d97706', darkIconColor: '#fbbf24' },
  { labelKey: 'ai_settings.context.with_results.label', value: 'with_results', descKey: 'ai_settings.context.with_results.desc', icon: <ProfileOutlined />, lightIconColor: '#16a34a', darkIconColor: '#4ade80' },
];

const OPEN_MODE_OPTIONS: {
  labelKey: string;
  value: AIChatOpenMode;
  descKey: string;
  icon: React.ReactNode;
  lightIconColor: string;
  darkIconColor: string;
}[] = [
  { labelKey: 'ai_settings.open_mode.dock.label', value: 'dock', descKey: 'ai_settings.open_mode.dock.desc', icon: <LayoutOutlined />, lightIconColor: '#2563eb', darkIconColor: '#60a5fa' },
  { labelKey: 'ai_settings.open_mode.detached.label', value: 'detached', descKey: 'ai_settings.open_mode.detached.desc', icon: <ExpandOutlined />, lightIconColor: '#7c3aed', darkIconColor: '#a78bfa' },
];

interface AISettingsContextSectionProps {
  contextLevel: AIContextLevel;
  openMode: AIChatOpenMode;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBg: string;
  cardBorder: string;
  onChange: (level: AIContextLevel) => void;
  onOpenModeChange: (mode: AIChatOpenMode) => void;
}

const AISettingsContextSection: React.FC<AISettingsContextSectionProps> = ({
  contextLevel,
  openMode,
  darkMode,
  overlayTheme,
  cardBorder,
  onChange,
  onOpenModeChange,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);

  const openModeOptions = OPEN_MODE_OPTIONS.map((option) => ({
    value: option.value,
    title: copy(option.labelKey),
    description: copy(option.descKey),
    icon: option.icon,
    iconColor: darkMode ? option.darkIconColor : option.lightIconColor,
  }));
  const contextOptions = CONTEXT_OPTIONS.map((option) => ({
    value: option.value,
    title: copy(option.labelKey),
    description: copy(option.descKey),
    icon: option.icon,
    iconColor: darkMode ? option.darkIconColor : option.lightIconColor,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--gn-font-sans)' }}>
      <h3 style={{ fontSize: 'var(--gn-font-size, 14px)', lineHeight: '20px', fontWeight: 600, color: overlayTheme.titleText, margin: '0 0 2px' }}>
        {copy('ai_settings.open_mode.title')}
      </h3>
      <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', lineHeight: '18px', color: overlayTheme.mutedText, marginBottom: 10 }}>
        {copy('ai_settings.open_mode.description')}
      </div>
      <AISettingsChoiceGroup
        ariaLabel={copy('ai_settings.open_mode.title')}
        value={openMode}
        options={openModeOptions}
        className="gonavi-ai-context-choice"
        overlayTheme={overlayTheme}
        cardBorder={cardBorder}
        onChange={onOpenModeChange}
      />

      <h3 style={{ fontSize: 'var(--gn-font-size, 14px)', lineHeight: '20px', fontWeight: 600, color: overlayTheme.titleText, margin: '24px 0 2px' }}>
        {copy('ai_settings.context.section_title')}
      </h3>
      <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', lineHeight: '18px', color: overlayTheme.mutedText, marginBottom: 10 }}>
        {copy('ai_settings.context.description')}
      </div>
      <AISettingsChoiceGroup
        ariaLabel={copy('ai_settings.context.section_title')}
        value={contextLevel}
        options={contextOptions}
        className="gonavi-ai-context-choice"
        overlayTheme={overlayTheme}
        cardBorder={cardBorder}
        onChange={onChange}
      />
    </div>
  );
};

export default AISettingsContextSection;
