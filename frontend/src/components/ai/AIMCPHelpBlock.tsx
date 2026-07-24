import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { MCPFieldState } from '../../utils/mcpServerGuidance';

export const mcpLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
};

export const buildMCPHintStyle = (mutedText: string): React.CSSProperties => ({
  fontSize: 12,
  color: mutedText,
  lineHeight: 1.6,
});

export const buildMCPFieldTone = (kind: MCPFieldState, darkMode: boolean) => {
  switch (kind) {
    case 'required':
      return {
        labelKey: 'ai_settings.mcp_server.help.field_state.required',
        color: '#b45309',
        bg: darkMode ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.12)',
      };
    case 'fixed':
      return {
        labelKey: 'ai_settings.mcp_server.help.field_state.fixed',
        color: '#2563eb',
        bg: darkMode ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)',
      };
    default:
      return {
        labelKey: 'ai_settings.mcp_server.help.field_state.optional',
        color: '#475569',
        bg: darkMode ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.12)',
      };
  }
};

interface AIMCPHelpBlockProps {
  title: string;
  description: string;
  overlayTheme: OverlayWorkbenchTheme;
  darkMode: boolean;
  fieldState: MCPFieldState;
  example?: string;
  children: React.ReactNode;
}

const AIMCPHelpBlock: React.FC<AIMCPHelpBlockProps> = ({
  title,
  description,
  overlayTheme,
  darkMode,
  fieldState,
  example,
  children,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);
  const tone = buildMCPFieldTone(fieldState, darkMode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={mcpLabelStyle}>{title}</div>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 'var(--gn-font-size-sm, 12px)',
            fontWeight: 700,
            color: tone.color,
            background: tone.bg,
          }}
        >
          {copy(tone.labelKey)}
        </span>
      </div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {description}
        {example ? (
          <>
            {' '}{copy('ai_settings.mcp_server.help.example_prefix')}<code style={{ fontFamily: 'var(--gn-font-mono)' }}>{example}</code>
          </>
        ) : null}
      </div>
      {children}
    </div>
  );
};

export default AIMCPHelpBlock;
