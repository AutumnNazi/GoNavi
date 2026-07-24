import React from 'react';
import { Button, Input } from 'antd';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { ParseMCPCommandDraftResult } from '../../utils/mcpCommandDraft';
import {
  MCP_COMMAND_EXAMPLES,
  MCP_COMMAND_PARSE_EXAMPLE,
  MCP_FIELD_GUIDES,
  MCP_SERVER_FILL_STEPS,
  MCP_TROUBLESHOOTING_GUIDES,
} from '../../utils/mcpServerGuidance';
import AIMCPCommandDraftPreview from './AIMCPCommandDraftPreview';
import AIMCPFieldGuideCard from './AIMCPFieldGuideCard';
import { buildMCPHintStyle, mcpLabelStyle } from './AIMCPHelpBlock';

interface AIMCPServerGuidePanelProps {
  cardBorder: string;
  inputBg: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  rawCommandDraft: string;
  parsedCommandDraft: ParseMCPCommandDraftResult;
  onApplyCommandDraft: () => void;
  onRawCommandDraftChange: (value: string) => void;
}

const AIMCPServerGuidePanel: React.FC<AIMCPServerGuidePanelProps> = ({
  cardBorder,
  inputBg,
  darkMode,
  overlayTheme,
  rawCommandDraft,
  parsedCommandDraft,
  onApplyCommandDraft,
  onRawCommandDraftChange,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);

  return (
    <>
    <div style={{ padding: '2px 0 2px 12px', borderLeft: `3px solid ${overlayTheme.selectedText}`, background: 'transparent' }}>
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.guide.examples.title')}</div>
      <div style={{ ...buildMCPHintStyle(overlayTheme.mutedText), marginTop: 4 }}>
        {copy('ai_settings.mcp_server.guide.examples.description')}
        {' '}
        <code style={{ fontFamily: 'var(--gn-font-mono)' }}>{MCP_COMMAND_EXAMPLES.join(' / ')}</code>
      </div>
    </div>

    <div style={{ padding: '12px 0', borderBottom: `1px solid ${cardBorder}`, background: 'transparent', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.guide.order.title')}</div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {copy('ai_settings.mcp_server.guide.order.description')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {MCP_SERVER_FILL_STEPS.map((item) => (
          <span
            key={item.step}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              color: overlayTheme.titleText,
              background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
            }}
          >
            {item.step}. {copy(item.titleKey)}
          </span>
        ))}
      </div>
    </div>

    <div style={{ padding: '12px 0', borderBottom: `1px solid ${cardBorder}`, background: 'transparent', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.guide.field_lookup.title')}</div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {copy('ai_settings.mcp_server.guide.field_lookup.description')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {MCP_FIELD_GUIDES.map((item) => (
          <AIMCPFieldGuideCard
            key={item.key}
            item={item}
            cardBorder={cardBorder}
            darkMode={darkMode}
            overlayTheme={overlayTheme}
          />
        ))}
      </div>
    </div>

    <div style={{ padding: '12px 0', borderBottom: `1px solid ${cardBorder}`, background: 'transparent', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.guide.troubleshooting.title')}</div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {copy('ai_settings.mcp_server.guide.troubleshooting.description')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
        {MCP_TROUBLESHOOTING_GUIDES.map((item) => (
          <div
            key={item.key}
            style={{
              padding: '10px 10px 10px 0',
              borderBottom: `1px solid ${cardBorder}`,
              background: 'transparent',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>{copy(item.symptomKey)}</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: overlayTheme.titleText }}>
              {copy('ai_settings.mcp_server.guide.troubleshooting.cause_label')}{copy(item.likelyCauseKey)}
            </div>
            <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{copy('ai_settings.mcp_server.guide.troubleshooting.fix_label')}{copy(item.fixKey)}</div>
            {item.example ? (
              <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
                {copy('ai_settings.mcp_server.guide.troubleshooting.example_label')}
                {' '}
                <code style={{ fontFamily: 'var(--gn-font-mono)' }}>{item.example}</code>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>

    <div style={{ padding: '12px 0', borderBottom: `1px solid ${cardBorder}`, background: 'transparent', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.guide.full_command.title')}</div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        {copy('ai_settings.mcp_server.guide.full_command.description')}
      </div>
      <Input.TextArea
        rows={2}
        value={rawCommandDraft}
        onChange={(event) => onRawCommandDraftChange(event.target.value)}
        placeholder={copy('ai_settings.mcp_server.guide.full_command.placeholder', { example: MCP_COMMAND_PARSE_EXAMPLE })}
        style={{ borderRadius: 10, background: inputBg, border: `1px solid ${cardBorder}`, fontFamily: 'var(--gn-font-mono)' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...buildMCPHintStyle(parsedCommandDraft.ok ? overlayTheme.mutedText : '#dc2626') }}>
          {rawCommandDraft.trim()
            ? parsedCommandDraft.ok && parsedCommandDraft.draft
              ? copy('ai_settings.mcp_server.guide.full_command.parsed_summary', {
                command: parsedCommandDraft.draft.command,
                argsCount: parsedCommandDraft.draft.args.length,
                envCount: Object.keys(parsedCommandDraft.draft.env).length,
              })
              : parsedCommandDraft.error
            : copy('ai_settings.mcp_server.guide.full_command.support_hint')}
        </div>
        <Button onClick={onApplyCommandDraft} disabled={!parsedCommandDraft.ok} style={{ borderRadius: 10 }}>
          {copy('ai_settings.mcp_server.guide.full_command.apply')}
        </Button>
      </div>
      {parsedCommandDraft.ok && parsedCommandDraft.draft && rawCommandDraft.trim() && (
        <AIMCPCommandDraftPreview
          draft={parsedCommandDraft.draft}
          darkMode={darkMode}
          overlayTheme={overlayTheme}
          cardBorder={cardBorder}
        />
      )}
    </div>
    </>
  );
};

export default AIMCPServerGuidePanel;
