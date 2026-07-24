import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { MCPServerDraftIssue, MCPServerDraftValidation } from '../../utils/mcpServerValidation';
import { buildMCPHintStyle, mcpLabelStyle } from './AIMCPHelpBlock';

interface AIMCPServerValidationPanelProps {
  validation: MCPServerDraftValidation;
  cardBorder: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
}

const getIssueTone = (issue: MCPServerDraftIssue, darkMode: boolean) => {
  if (issue.severity === 'error') {
    return {
      labelKey: 'ai_settings.mcp_server.validation.severity.error',
      color: '#dc2626',
      bg: darkMode ? 'rgba(220,38,38,0.18)' : 'rgba(220,38,38,0.10)',
    };
  }
  if (issue.severity === 'warning') {
    return {
      labelKey: 'ai_settings.mcp_server.validation.severity.warning',
      color: '#b45309',
      bg: darkMode ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.12)',
    };
  }
  return {
    labelKey: 'ai_settings.mcp_server.validation.severity.info',
    color: '#2563eb',
    bg: darkMode ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)',
  };
};

const AIMCPServerValidationPanel: React.FC<AIMCPServerValidationPanelProps> = ({
  validation,
  cardBorder,
  darkMode,
  overlayTheme,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);
  const hasIssues = validation.issues.length > 0;
  const summaryText = validation.errorCount > 0
    ? copy('ai_settings.mcp_server.validation.summary.errors', { count: validation.errorCount })
    : validation.warningCount > 0
      ? copy('ai_settings.mcp_server.validation.summary.warnings', { count: validation.warningCount })
      : copy('ai_settings.mcp_server.validation.summary.ready');

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: `1px solid ${cardBorder}`,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>
        {copy('ai_settings.mcp_server.validation.title')}
      </div>
      <div style={buildMCPHintStyle(validation.errorCount > 0 ? '#dc2626' : overlayTheme.mutedText)}>
        {summaryText}
      </div>
      {hasIssues ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {validation.issues.map((issue) => {
            const tone = getIssueTone(issue, darkMode);
            return (
              <div
                key={issue.key}
                style={{
                  padding: '8px 10px 8px 0',
                  borderBottom: `1px solid ${cardBorder}`,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                  <span style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>{issue.title}</span>
                </div>
                <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{issue.detail}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default AIMCPServerValidationPanel;
