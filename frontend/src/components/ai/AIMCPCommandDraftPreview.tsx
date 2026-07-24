import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { ParsedMCPCommandDraft } from '../../utils/mcpCommandDraft';

interface AIMCPCommandDraftPreviewProps {
  draft: ParsedMCPCommandDraft;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBorder: string;
}

const chipStyle = (darkMode: boolean, overlayTheme: OverlayWorkbenchTheme): React.CSSProperties => ({
  padding: '4px 8px',
  borderRadius: 999,
  fontSize: 12,
  color: overlayTheme.titleText,
  background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
  fontFamily: 'var(--gn-font-mono)',
});

const sectionTitleStyle = (overlayTheme: OverlayWorkbenchTheme): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 700,
  color: overlayTheme.titleText,
});

const sectionHintStyle = (overlayTheme: OverlayWorkbenchTheme): React.CSSProperties => ({
  fontSize: 'var(--gn-font-size-sm, 12px)',
  color: overlayTheme.mutedText,
  lineHeight: 1.6,
});

const AIMCPCommandDraftPreview: React.FC<AIMCPCommandDraftPreviewProps> = ({
  draft,
  darkMode,
  overlayTheme,
  cardBorder,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);
  const envKeys = Object.keys(draft.env || {});

  return (
    <div
      style={{
        padding: '10px 0 0 12px',
        borderLeft: `3px solid ${overlayTheme.selectedText}`,
        borderBottom: `1px solid ${cardBorder}`,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div>
        <div style={sectionTitleStyle(overlayTheme)}>
          {copy('ai_settings.mcp_server.command_preview.title')}
        </div>
        <div style={{ ...sectionHintStyle(overlayTheme), marginTop: 4 }}>
          {copy('ai_settings.mcp_server.command_preview.description')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={sectionTitleStyle(overlayTheme)}>
            {copy('ai_settings.mcp_server.command_preview.env_title')}
          </div>
          <div style={sectionHintStyle(overlayTheme)}>
            {envKeys.length > 0
              ? copy('ai_settings.mcp_server.command_preview.env_count', { count: envKeys.length })
              : copy('ai_settings.mcp_server.command_preview.env_empty')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {envKeys.length > 0 ? envKeys.map((key) => (
              <span key={key} style={chipStyle(darkMode, overlayTheme)}>{key}</span>
            )) : <span style={chipStyle(darkMode, overlayTheme)}>{copy('ai_settings.mcp_server.command_preview.empty_value')}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={sectionTitleStyle(overlayTheme)}>
            {copy('ai_settings.mcp_server.command_preview.command_title')}
          </div>
          <div style={sectionHintStyle(overlayTheme)}>
            {copy('ai_settings.mcp_server.command_preview.command_hint')}
          </div>
          <code style={{ ...chipStyle(darkMode, overlayTheme), borderRadius: 10, display: 'inline-block' }}>
            {draft.command}
          </code>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={sectionTitleStyle(overlayTheme)}>
            {copy('ai_settings.mcp_server.command_preview.args_title')}
          </div>
          <div style={sectionHintStyle(overlayTheme)}>
            {draft.args.length > 0
              ? copy('ai_settings.mcp_server.command_preview.args_count', { count: draft.args.length })
              : copy('ai_settings.mcp_server.command_preview.args_empty')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {draft.args.length > 0 ? draft.args.map((arg) => (
              <span key={arg} style={chipStyle(darkMode, overlayTheme)}>{arg}</span>
            )) : <span style={chipStyle(darkMode, overlayTheme)}>{copy('ai_settings.mcp_server.command_preview.empty_value')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIMCPCommandDraftPreview;
