import React from 'react';
import { EditOutlined, LockOutlined, WarningOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AISafetyLevel } from '../../types';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AISettingsChoiceGroup from './AISettingsChoiceGroup';

const SAFETY_OPTIONS: {
  labelKey: string;
  value: AISafetyLevel;
  descKey: string;
  icon: React.ReactNode;
  lightIconColor: string;
  darkIconColor: string;
}[] = [
  { labelKey: 'ai_settings.safety.readonly.label', value: 'readonly', descKey: 'ai_settings.safety.readonly.desc', icon: <LockOutlined />, lightIconColor: '#16a34a', darkIconColor: '#4ade80' },
  { labelKey: 'ai_settings.safety.readwrite.label', value: 'readwrite', descKey: 'ai_settings.safety.readwrite.desc', icon: <EditOutlined />, lightIconColor: '#d97706', darkIconColor: '#fbbf24' },
  { labelKey: 'ai_settings.safety.full.label', value: 'full', descKey: 'ai_settings.safety.full.desc', icon: <WarningOutlined />, lightIconColor: '#dc2626', darkIconColor: '#f87171' },
];

interface AISettingsSafetySectionProps {
  safetyLevel: AISafetyLevel;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBg: string;
  cardBorder: string;
  onChange: (level: AISafetyLevel) => void;
}

const AISettingsSafetySection: React.FC<AISettingsSafetySectionProps> = ({
  safetyLevel,
  darkMode,
  overlayTheme,
  cardBorder,
  onChange,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);

  const options = SAFETY_OPTIONS.map((option) => ({
    value: option.value,
    title: copy(option.labelKey),
    description: copy(option.descKey),
    icon: option.icon,
    iconColor: darkMode ? option.darkIconColor : option.lightIconColor,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--gn-font-sans)' }}>
      <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', lineHeight: '18px', color: overlayTheme.mutedText, marginBottom: 10 }}>
        {copy('ai_settings.safety.description')}
      </div>
      <AISettingsChoiceGroup
        ariaLabel={copy('ai_settings.safety.description')}
        value={safetyLevel}
        options={options}
        className="gonavi-ai-safety-choice"
        overlayTheme={overlayTheme}
        cardBorder={cardBorder}
        onChange={onChange}
      />
    </div>
  );
};

export default AISettingsSafetySection;
