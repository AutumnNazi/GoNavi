import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { buildMCPEnvHintProfile } from '../../utils/mcpEnvHints';
import { buildMCPHintStyle, mcpLabelStyle } from './AIMCPHelpBlock';

interface AIMCPEnvHintsProps {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cardBorder: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
}

const categoryLabel = {
  secret: 'ai_settings.mcp_server.env_hints.category.secret',
  endpoint: 'ai_settings.mcp_server.env_hints.category.endpoint',
  proxy: 'ai_settings.mcp_server.env_hints.category.proxy',
  path: 'ai_settings.mcp_server.env_hints.category.path',
  runtime: 'ai_settings.mcp_server.env_hints.category.runtime',
  generic: 'ai_settings.mcp_server.env_hints.category.generic',
};

const categoryColor = {
  secret: '#b45309',
  endpoint: '#2563eb',
  proxy: '#0f766e',
  path: '#7c3aed',
  runtime: '#475569',
  generic: '#64748b',
};

const AIMCPEnvHints: React.FC<AIMCPEnvHintsProps> = ({
  command,
  args,
  env,
  cardBorder,
  darkMode,
  overlayTheme,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);
  const profile = buildMCPEnvHintProfile(command, args, env, copy);
  if (!profile) {
    return null;
  }

  return (
    <div
      className="gonavi-ai-mcp-env-hints"
      style={{
        padding: '10px 0',
        borderTop: `1px solid ${cardBorder}`,
        borderBottom: `1px solid ${cardBorder}`,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>
        {copy('ai_settings.mcp_server.env_hints.title')}
      </div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {copy('ai_settings.mcp_server.env_hints.summary', {
          envVarCount: profile.envVarCount,
          secretLikeCount: profile.secretLikeCount,
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {profile.items.map((item) => (
          <div
            className="gonavi-ai-mcp-env-hint-row"
            key={item.key}
            style={{
              padding: '8px 10px 8px 0',
              borderBottom: `1px solid ${cardBorder}`,
              background: 'transparent',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <code style={{ fontFamily: 'var(--gn-font-mono)', fontSize: 12, color: overlayTheme.titleText }}>{item.key}</code>
              <span
                style={{
                  padding: '1px 7px',
                  borderRadius: 999,
                  fontSize: 'var(--gn-font-size-sm, 12px)',
                  fontWeight: 700,
                  color: categoryColor[item.category],
                  background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
                }}
              >
                {copy(categoryLabel[item.category])}
              </span>
              {item.known ? (
                <span style={buildMCPHintStyle('#16a34a')}>
                  {copy('ai_settings.mcp_server.env_hints.recognized')}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>{item.label}</div>
            <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{item.detail}</div>
            <div style={buildMCPHintStyle(item.empty || item.placeholder ? '#b45309' : overlayTheme.mutedText)}>
              {copy('ai_settings.mcp_server.env_hints.value_hint_prefix')}{item.valueHint}
              {item.empty ? copy('ai_settings.mcp_server.env_hints.empty_value') : ''}
              {item.placeholder ? copy('ai_settings.mcp_server.env_hints.placeholder_value') : ''}
            </div>
          </div>
        ))}
      </div>
      {profile.warnings.length > 0 ? (
        <div style={buildMCPHintStyle('#b45309')}>
          {copy('ai_settings.mcp_server.env_hints.warning_prefix', {
            warnings: profile.warnings.join(copy('ai_settings.mcp_server.env_hints.action_separator')),
          })}
        </div>
      ) : null}
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {copy('ai_settings.mcp_server.env_hints.next_actions', {
          actions: profile.nextActions.join(copy('ai_settings.mcp_server.env_hints.action_separator')),
        })}
      </div>
    </div>
  );
};

export default AIMCPEnvHints;
