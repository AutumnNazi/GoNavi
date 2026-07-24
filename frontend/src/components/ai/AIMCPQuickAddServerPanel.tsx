import React from 'react';
import { Button, Input } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import type { I18nParams } from '../../i18n';
import { useOptionalI18n } from '../../i18n/provider';
import type { AIMCPServerConfig } from '../../types';
import {
  parseMCPCommandDraft,
  type ParseMCPCommandDraftResult,
} from '../../utils/mcpCommandDraft';
import {
  buildMCPLaunchPreview,
  MCP_COMMAND_PARSE_EXAMPLE,
} from '../../utils/mcpServerGuidance';
import { buildMCPQuickAddServerSeed } from '../../utils/mcpServerDraftSeed';
import { MCP_SERVER_DRAFT_TEMPLATES, type MCPServerDraftTemplate } from '../../utils/mcpServerTemplates';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AIMCPCommandDraftPreview from './AIMCPCommandDraftPreview';
import { buildMCPHintStyle, mcpLabelStyle } from './AIMCPHelpBlock';

interface AIMCPQuickAddServerPanelProps {
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  hideHeading?: boolean;
  onAddServer: (seed?: Partial<AIMCPServerConfig>) => void;
}

const renderParseSummary = (
  rawCommandDraft: string,
  parsedCommandDraft: ParseMCPCommandDraftResult,
  overlayTheme: OverlayWorkbenchTheme,
  copy: (key: string, params?: I18nParams, fallback?: string) => string,
) => {
  if (!rawCommandDraft.trim()) {
    return copy('ai_settings.mcp_server.guide.full_command.support_hint');
  }
  if (!parsedCommandDraft.ok || !parsedCommandDraft.draft) {
    return parsedCommandDraft.errorKey
      ? copy(parsedCommandDraft.errorKey, undefined, parsedCommandDraft.error)
      : (parsedCommandDraft.error || copy(
        'ai_settings.mcp_server.command_parse.error.failed',
        undefined,
        'Failed to parse the full command. Check the command format.',
      ));
  }
  const envCount = Object.keys(parsedCommandDraft.draft.env || {}).length;
  return (
    <span style={{ color: overlayTheme.mutedText }}>
      {copy('ai_settings.mcp_server.guide.full_command.parsed_summary', {
        command: parsedCommandDraft.draft.command,
        argsCount: parsedCommandDraft.draft.args.length,
        envCount,
      })}
    </span>
  );
};

const localizeTemplateSeed = (
  template: MCPServerDraftTemplate,
  copy: (key: string, params?: I18nParams, fallback?: string) => string,
): Partial<AIMCPServerConfig> => ({
  ...template.seed,
  name: copy(template.seedNameKey, undefined, String(template.seed.name || template.title)),
});

const AIMCPQuickAddServerPanel: React.FC<AIMCPQuickAddServerPanelProps> = ({
  cardBorder,
  inputBg,
  darkMode,
  overlayTheme,
  hideHeading = false,
  onAddServer,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: I18nParams,
    fallback?: string,
  ) => {
    const translate = i18n?.t ?? ((catalogKey: string, catalogParams?: I18nParams) =>
      catalogTranslate('en-US', catalogKey, catalogParams));
    const translated = translate(key, params);
    return translated === key ? (fallback ?? key) : translated;
  };
  const [rawCommandDraft, setRawCommandDraft] = React.useState('');
  const parsedCommandDraft = parseMCPCommandDraft(rawCommandDraft);

  const handleAddFromCommand = () => {
    if (!parsedCommandDraft.ok || !parsedCommandDraft.draft) {
      return;
    }
    onAddServer(buildMCPQuickAddServerSeed(parsedCommandDraft.draft, copy));
    setRawCommandDraft('');
  };

  return (
    <div
      className="gonavi-ai-mcp-quick-add"
      style={{
        padding: '4px 0 14px',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {!hideHeading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText, fontSize: 14 }}>
            {copy('ai_settings.mcp_server.quick_add.title', undefined, 'Quick add from one command')}
          </div>
          <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
            {copy(
              'ai_settings.mcp_server.quick_add.description',
              undefined,
              'Choose the closest template, or paste a full startup command from the README. GoNavi will split it into command, args, and env, then create an editable MCP draft.',
            )}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="middle" icon={<PlusOutlined />} onClick={() => onAddServer()} style={{ borderRadius: 8 }}>
          {copy('ai_settings.mcp_server.section.action.add_server', undefined, 'Add MCP service')}
        </Button>
      </div>
      <details className="gonavi-ai-mcp-disclosure gonavi-ai-mcp-template-disclosure">
        <summary>
          <span style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>
            {copy('ai_settings.mcp_server.quick_add.templates_title', undefined, 'Common startup templates')}
          </span>
          <span className="gonavi-ai-mcp-summary-note" style={{ color: overlayTheme.mutedText }}>
            {copy(
              'ai_settings.mcp_server.quick_add.templates_description',
              undefined,
              'If you are not sure how to split command and args, click a template to create a draft. Each card shows the command GoNavi will actually launch.',
            )}
          </span>
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 6, padding: '4px 0 8px' }}>
          {MCP_SERVER_DRAFT_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              title={`${copy(template.descriptionKey, undefined, template.description)}\n${buildMCPLaunchPreview(String(template.seed.command || ''), template.seed.args)}\n${copy(template.detailKey, undefined, template.detail)}`}
              onClick={() => onAddServer(localizeTemplateSeed(template, copy))}
              style={{
                textAlign: 'left',
                minHeight: 38,
                padding: '7px 9px',
                border: 'none',
                borderLeft: '3px solid transparent',
                borderRadius: 4,
                background: 'transparent',
                color: overlayTheme.titleText,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {copy(template.titleKey, undefined, template.title)}
              </div>
            </button>
          ))}
        </div>
      </details>
      <Input.TextArea
        autoSize={{ minRows: 1, maxRows: 3 }}
        value={rawCommandDraft}
        onChange={(event) => setRawCommandDraft(event.target.value)}
        placeholder={copy('ai_settings.mcp_server.guide.full_command.placeholder', { example: MCP_COMMAND_PARSE_EXAMPLE })}
        style={{ borderRadius: 10, background: inputBg, border: `1px solid ${cardBorder}`, fontFamily: 'var(--gn-font-mono)' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...buildMCPHintStyle(parsedCommandDraft.ok || !rawCommandDraft.trim() ? overlayTheme.mutedText : '#dc2626') }}>
          {renderParseSummary(rawCommandDraft, parsedCommandDraft, overlayTheme, copy)}
        </div>
        <Button
          icon={<PlusOutlined />}
          onClick={handleAddFromCommand}
          disabled={!parsedCommandDraft.ok}
          style={{ borderRadius: 10, fontWeight: 600 }}
        >
          {copy('ai_settings.mcp_server.quick_add.action.parse_and_add', undefined, 'Parse and add draft')}
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
  );
};

export default AIMCPQuickAddServerPanel;
