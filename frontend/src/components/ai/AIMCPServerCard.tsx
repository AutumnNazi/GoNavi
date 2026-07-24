import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { AIMCPServerConfig, AIMCPToolDescriptor } from '../../types';
import { parseMCPCommandDraft } from '../../utils/mcpCommandDraft';
import { formatMCPEnvDraft, parseMCPEnvDraft } from '../../utils/mcpEnvDraft';
import { buildMCPLaunchPreview } from '../../utils/mcpServerGuidance';
import { validateMCPServerDraft } from '../../utils/mcpServerValidation';
import AIMCPServerFormPanel from './AIMCPServerFormPanel';
import AIMCPServerGuidePanel from './AIMCPServerGuidePanel';

interface AIMCPServerCardProps {
  server: AIMCPServerConfig;
  serverTools: AIMCPToolDescriptor[];
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  loading: boolean;
  onChange: (patch: Partial<AIMCPServerConfig>) => void;
  onTest: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export const AIMCPServerCard: React.FC<AIMCPServerCardProps> = ({
  server,
  serverTools,
  cardBorder,
  inputBg,
  darkMode,
  overlayTheme,
  loading,
  onChange,
  onTest,
  onSave,
  onDelete,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);
  const [rawCommandDraft, setRawCommandDraft] = React.useState('');
  const [envDraft, setEnvDraft] = React.useState(() => formatMCPEnvDraft(server.env));
  const [expanded, setExpanded] = React.useState(() => server.id.startsWith('mcp-draft-'));
  const launchPreview = buildMCPLaunchPreview(server.command, server.args);
  const parsedCommandDraft = parseMCPCommandDraft(rawCommandDraft);
  const parsedEnvDraft = parseMCPEnvDraft(envDraft);
  const validation = validateMCPServerDraft(server, parsedEnvDraft, i18n?.t);

  React.useEffect(() => {
    setEnvDraft(formatMCPEnvDraft(server.env));
  }, [server.id]);

  const handleApplyCommandDraft = () => {
    if (!parsedCommandDraft.ok || !parsedCommandDraft.draft) {
      return;
    }
    setEnvDraft(formatMCPEnvDraft(parsedCommandDraft.draft.env));
    onChange({
      command: parsedCommandDraft.draft.command,
      args: parsedCommandDraft.draft.args,
      env: parsedCommandDraft.draft.env,
    });
  };

  const handleEnvDraftChange = (nextValue: string) => {
    setEnvDraft(nextValue);
    onChange({ env: parseMCPEnvDraft(nextValue).env });
  };

  return (
    <details
      className="gonavi-ai-mcp-server-row gonavi-ai-mcp-disclosure"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      style={{ borderLeft: `3px solid ${overlayTheme.selectedText}`, borderBottom: `1px solid ${cardBorder}`, background: 'transparent' }}
    >
      <summary>
        <span className="gonavi-ai-mcp-server-summary-name" style={{ fontWeight: 700, color: overlayTheme.titleText }}>
          {server.name.trim() || copy('ai_settings.mcp_server.section.unnamed_draft')}
        </span>
        <span
          style={{
            padding: '2px 7px',
            borderRadius: 999,
            fontSize: 'var(--gn-font-size-sm, 12px)',
            fontWeight: 700,
            color: server.enabled ? overlayTheme.selectedText : overlayTheme.mutedText,
            background: server.enabled ? overlayTheme.selectedBg : 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          {copy(server.enabled
            ? 'ai_settings.mcp_server.form.enabled.option.enabled'
            : 'ai_settings.mcp_server.form.enabled.option.disabled')}
        </span>
      </summary>
      <div style={{ padding: '4px 0 18px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <details className="gonavi-ai-mcp-disclosure gonavi-ai-mcp-server-guide-disclosure">
          <summary>
            <span style={{ fontWeight: 700, color: overlayTheme.titleText }}>
              {copy('ai_settings.mcp_server.guide.order.title')}
            </span>
            <span className="gonavi-ai-mcp-summary-note" style={{ color: overlayTheme.mutedText }}>
              {copy('ai_settings.mcp_server.guide.full_command.title')}
            </span>
          </summary>
          <AIMCPServerGuidePanel
            cardBorder={cardBorder}
            inputBg={inputBg}
            darkMode={darkMode}
            overlayTheme={overlayTheme}
            rawCommandDraft={rawCommandDraft}
            parsedCommandDraft={parsedCommandDraft}
            onApplyCommandDraft={handleApplyCommandDraft}
            onRawCommandDraftChange={setRawCommandDraft}
          />
        </details>
        <AIMCPServerFormPanel
          server={server}
          serverTools={serverTools}
          launchPreview={launchPreview}
          envDraft={envDraft}
          parsedEnvDraft={parsedEnvDraft}
          validation={validation}
          cardBorder={cardBorder}
          inputBg={inputBg}
          darkMode={darkMode}
          overlayTheme={overlayTheme}
          loading={loading}
          onChange={onChange}
          onEnvDraftChange={handleEnvDraftChange}
          onTest={onTest}
          onSave={onSave}
          onDelete={onDelete}
        />
      </div>
    </details>
  );
};

export default AIMCPServerCard;
