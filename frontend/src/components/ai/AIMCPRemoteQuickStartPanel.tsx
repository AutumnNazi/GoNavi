import React from 'react';

import {
  buildRemoteMCPParameterGuides,
  type RemoteMCPClientQuickStart,
} from '../../utils/mcpClientInstallStatus';
import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

interface AIMCPRemoteQuickStartPanelProps {
  quickStart: RemoteMCPClientQuickStart;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBorder: string;
}

interface RemoteCommandCardProps {
  title: string;
  children: React.ReactNode;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBorder: string;
}

const remoteCodeStyle = (overlayTheme: OverlayWorkbenchTheme): React.CSSProperties => ({
  display: 'block',
  marginTop: 8,
  fontFamily: 'var(--gn-font-mono)',
  fontSize: 'var(--gn-font-size-sm, 12px)',
  color: overlayTheme.titleText,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

const RemoteCommandCard: React.FC<RemoteCommandCardProps> = ({
  title,
  children,
  overlayTheme,
  cardBorder,
}) => (
  <div
    style={{
      padding: '10px 10px 10px 0',
      borderBottom: `1px solid ${cardBorder}`,
      background: 'transparent',
    }}
  >
    <div style={{ fontWeight: 700, fontSize: 12, color: overlayTheme.titleText }}>
      {title}
    </div>
    {children}
  </div>
);

const AIMCPRemoteQuickStartPanel: React.FC<AIMCPRemoteQuickStartPanelProps> = ({
  quickStart,
  darkMode,
  overlayTheme,
  cardBorder,
}) => {
  const i18n = useOptionalI18n();
  const copy = i18n?.t ?? ((key, params) => catalogTranslate('en-US', key, params));
  const parameterGuides = buildRemoteMCPParameterGuides(copy);

  return (
  <div
    style={{
      padding: '14px 0 0',
      borderTop: `1px solid ${cardBorder}`,
      background: 'transparent',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}
  >
    <div style={{ fontWeight: 700, fontSize: 13, color: overlayTheme.titleText }}>
      {copy('ai_settings.mcp_server.remote_quick_start.title', { displayName: quickStart.displayName })}
    </div>
    <div style={{ fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.7 }}>
      {copy('ai_settings.mcp_server.remote_quick_start.description')}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
      {parameterGuides.map((item) => (
        <div
          key={item.key}
          style={{
            padding: '10px 10px 10px 0',
            borderBottom: `1px solid ${cardBorder}`,
            background: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: overlayTheme.titleText }}>
              {item.title}
            </div>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 999,
                fontSize: 'var(--gn-font-size-sm, 12px)',
                color: item.required ? '#dc2626' : overlayTheme.mutedText,
                background: item.required
                  ? (darkMode ? 'rgba(248,113,113,0.12)' : 'rgba(254,226,226,0.7)')
                  : (darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)'),
              }}
            >
              {copy(item.required
                ? 'ai_settings.mcp_server.remote_quick_start.badge.required'
                : 'ai_settings.mcp_server.remote_quick_start.badge.optional')}
            </span>
          </div>
          <div style={{ fontSize: 12, color: overlayTheme.titleText, lineHeight: 1.6 }}>
            {copy('ai_settings.mcp_server.remote_quick_start.fill_prefix')}{item.fill}
          </div>
          <div style={{ fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.6 }}>
            {copy('ai_settings.mcp_server.remote_quick_start.example_prefix')}<code style={{ fontFamily: 'var(--gn-font-mono)' }}>{item.example}</code>
          </div>
          <div style={{ fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.6 }}>
            {copy('ai_settings.mcp_server.remote_quick_start.avoid_prefix')}{item.avoid}
          </div>
        </div>
      ))}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
      <RemoteCommandCard
        title={copy('ai_settings.mcp_server.remote_quick_start.card.cloud_agent')}
        darkMode={darkMode}
        overlayTheme={overlayTheme}
        cardBorder={cardBorder}
      >
        <code style={remoteCodeStyle(overlayTheme)}>
          {quickStart.configJson}
        </code>
      </RemoteCommandCard>
      <RemoteCommandCard
        title={copy('ai_settings.mcp_server.remote_quick_start.card.cli_config')}
        darkMode={darkMode}
        overlayTheme={overlayTheme}
        cardBorder={cardBorder}
      >
        <code style={remoteCodeStyle(overlayTheme)}>
          {quickStart.configCommand}
        </code>
        <div style={{ marginTop: 8, fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.6 }}>
          {copy('ai_settings.mcp_server.remote_quick_start.card.cli_config_note', {
            displayName: quickStart.displayName,
          })}
        </div>
      </RemoteCommandCard>
      <RemoteCommandCard
        title={copy('ai_settings.mcp_server.remote_quick_start.card.windows_launch')}
        darkMode={darkMode}
        overlayTheme={overlayTheme}
        cardBorder={cardBorder}
      >
        <code style={remoteCodeStyle(overlayTheme)}>
          {quickStart.launchCommand}
        </code>
        <div style={{ marginTop: 8, fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.6 }}>
          {copy('ai_settings.mcp_server.remote_quick_start.card.standalone_binary', {
            command: quickStart.standaloneCommand,
          })}
        </div>
      </RemoteCommandCard>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, color: overlayTheme.titleText }}>
          {copy('ai_settings.mcp_server.remote_quick_start.section.verification')}
        </div>
        <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {quickStart.verificationSteps.map((item) => (
            <div key={item} style={{ fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.6 }}>
              {item}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12, color: overlayTheme.titleText }}>
          {copy('ai_settings.mcp_server.remote_quick_start.section.security')}
        </div>
        <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {quickStart.securityNotes.map((item) => (
            <div key={item} style={{ fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.6 }}>
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
  );
};

export default AIMCPRemoteQuickStartPanel;
