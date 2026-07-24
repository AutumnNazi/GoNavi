import React from 'react';
import { Button, Input, Popconfirm, Select } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { AIMCPServerConfig, AIMCPToolDescriptor } from '../../types';
import type { ParsedMCPEnvDraft } from '../../utils/mcpEnvDraft';
import type { MCPServerDraftValidation } from '../../utils/mcpServerValidation';
import AIMCPHelpBlock, { buildMCPHintStyle, mcpLabelStyle } from './AIMCPHelpBlock';
import AIMCPArgumentHints from './AIMCPArgumentHints';
import AIMCPEnvHints from './AIMCPEnvHints';
import AIMCPServerValidationPanel from './AIMCPServerValidationPanel';
import AIMCPToolSchemaSummary from './AIMCPToolSchemaSummary';

interface AIMCPServerFormPanelProps {
  server: AIMCPServerConfig;
  serverTools: AIMCPToolDescriptor[];
  launchPreview: string;
  envDraft: string;
  parsedEnvDraft: ParsedMCPEnvDraft;
  validation: MCPServerDraftValidation;
  cardBorder: string;
  inputBg: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  loading: boolean;
  onChange: (patch: Partial<AIMCPServerConfig>) => void;
  onEnvDraftChange: (value: string) => void;
  onTest: () => void;
  onSave: () => void;
  onDelete: () => void;
}

const AIMCPServerFormPanel: React.FC<AIMCPServerFormPanelProps> = ({
  server,
  serverTools,
  launchPreview,
  envDraft,
  parsedEnvDraft,
  validation,
  cardBorder,
  inputBg,
  darkMode,
  overlayTheme,
  loading,
  onChange,
  onEnvDraftChange,
  onTest,
  onSave,
  onDelete,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);
  const envStatusText = envDraft.trim()
    ? parsedEnvDraft.invalidLines.length > 0
      ? copy('ai_settings.mcp_server.form.env_status.invalid', {
        validCount: parsedEnvDraft.validLines,
        invalidCount: parsedEnvDraft.invalidLines.length,
        invalidLines: parsedEnvDraft.invalidLines.slice(0, 2).join(' / '),
      })
      : copy('ai_settings.mcp_server.form.env_status.valid', { count: parsedEnvDraft.validLines })
    : copy('ai_settings.mcp_server.form.env_status.empty');

  return (
    <>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px', gap: 12 }}>
      <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.name.title')} description={copy('ai_settings.mcp_server.form.name.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="required" example="Filesystem / Browser / GitHub">
        <Input
          value={server.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={copy('ai_settings.mcp_server.form.name.placeholder')}
          style={{ borderRadius: 10, background: inputBg, border: `1px solid ${cardBorder}` }}
        />
      </AIMCPHelpBlock>
      <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.enabled.title')} description={copy('ai_settings.mcp_server.form.enabled.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="optional">
        <Select
          value={server.enabled ? 'enabled' : 'disabled'}
          onChange={(value) => onChange({ enabled: value === 'enabled' })}
          options={[{ label: copy('ai_settings.mcp_server.form.enabled.option.enabled'), value: 'enabled' }, { label: copy('ai_settings.mcp_server.form.enabled.option.disabled'), value: 'disabled' }]}
        />
      </AIMCPHelpBlock>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '132px minmax(0,1fr) 132px', gap: 12 }}>
      <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.transport.title')} description={copy('ai_settings.mcp_server.form.transport.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="fixed">
        <Select
          value={server.transport}
          onChange={(value) => onChange({ transport: value as AIMCPServerConfig['transport'] })}
          options={[{ label: 'stdio', value: 'stdio' }]}
        />
      </AIMCPHelpBlock>
      <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.command.title')} description={copy('ai_settings.mcp_server.form.command.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="required" example="npx / node / uvx / python / docker">
        <Input
          value={server.command}
          onChange={(event) => onChange({ command: event.target.value })}
          placeholder={copy('ai_settings.mcp_server.form.command.placeholder')}
          style={{ borderRadius: 10, background: inputBg, border: `1px solid ${cardBorder}` }}
        />
      </AIMCPHelpBlock>
      <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.timeout.title')} description={copy('ai_settings.mcp_server.form.timeout.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="optional" example="20">
        <Input
          type="number"
          min={3}
          max={120}
          value={server.timeoutSeconds}
          onChange={(event) => onChange({ timeoutSeconds: Number(event.target.value) || 20 })}
          placeholder={copy('ai_settings.mcp_server.form.timeout.placeholder')}
          style={{ borderRadius: 10, background: inputBg, border: `1px solid ${cardBorder}` }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: copy('ai_settings.mcp_server.form.timeout.preset.default'), value: 20 },
            { label: copy('ai_settings.mcp_server.form.timeout.preset.relaxed'), value: 45 },
            { label: copy('ai_settings.mcp_server.form.timeout.preset.slow'), value: 60 },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ timeoutSeconds: option.value })}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: `1px solid ${cardBorder}`,
                background: server.timeoutSeconds === option.value
                  ? (darkMode ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)')
                  : (darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.75)'),
                color: server.timeoutSeconds === option.value ? '#2563eb' : overlayTheme.mutedText,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </AIMCPHelpBlock>
    </div>

    <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.args.title')} description={copy('ai_settings.mcp_server.form.args.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="optional" example="-y / @modelcontextprotocol/server-filesystem / --stdio / server.js / run / --rm / -i / image">
      <Select
        mode="tags"
        value={server.args || []}
        onChange={(value) => onChange({ args: value })}
        placeholder={copy('ai_settings.mcp_server.form.args.placeholder')}
        style={{ width: '100%' }}
      />
      <AIMCPArgumentHints
        command={server.command}
        args={server.args}
        onArgsChange={(args) => onChange({ args })}
        onCommandArgsChange={(command, args) => onChange({ command, args })}
        cardBorder={cardBorder}
        darkMode={darkMode}
        overlayTheme={overlayTheme}
      />
    </AIMCPHelpBlock>

    {launchPreview && (
      <div style={{ padding: '2px 0 2px 12px', borderLeft: `3px solid ${overlayTheme.selectedText}`, background: 'transparent' }}>
        <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.form.launch_preview.title')}</div>
        <div style={{ ...buildMCPHintStyle(overlayTheme.mutedText), marginTop: 4 }}>
          {copy('ai_settings.mcp_server.form.launch_preview.description')}
        </div>
        <code style={{ display: 'block', marginTop: 8, fontFamily: 'var(--gn-font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {launchPreview}
        </code>
      </div>
    )}

    <AIMCPHelpBlock title={copy('ai_settings.mcp_server.form.env.title')} description={copy('ai_settings.mcp_server.form.env.description')} overlayTheme={overlayTheme} darkMode={darkMode} fieldState="optional" example="OPENAI_API_KEY=...">
      <Input.TextArea
        rows={3}
        value={envDraft}
        onChange={(event) => onEnvDraftChange(event.target.value)}
        placeholder={copy('ai_settings.mcp_server.form.env.placeholder')}
        style={{ borderRadius: 10, background: inputBg, border: `1px solid ${cardBorder}`, fontFamily: 'var(--gn-font-mono)' }}
      />
      <div style={{ ...buildMCPHintStyle(parsedEnvDraft.invalidLines.length > 0 ? '#d97706' : overlayTheme.mutedText) }}>
        {envStatusText}
      </div>
      <AIMCPEnvHints
        command={server.command}
        args={server.args}
        env={parsedEnvDraft.env}
        cardBorder={cardBorder}
        darkMode={darkMode}
        overlayTheme={overlayTheme}
      />
    </AIMCPHelpBlock>

    <AIMCPServerValidationPanel
      validation={validation}
      cardBorder={cardBorder}
      darkMode={darkMode}
      overlayTheme={overlayTheme}
    />

    <AIMCPToolSchemaSummary
      tools={serverTools}
      cardBorder={cardBorder}
      darkMode={darkMode}
      overlayTheme={overlayTheme}
    />

    <div style={{ padding: '10px 0', background: 'transparent' }}>
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>{copy('ai_settings.mcp_server.form.instructions.title')}</div>
      <div style={{ ...buildMCPHintStyle(overlayTheme.mutedText), marginTop: 4 }}>
        <strong>{copy('ai_settings.mcp_server.form.instructions.test_title')}</strong>
        {' '}{copy('ai_settings.mcp_server.form.instructions.test_description')}
        {' '}<strong>{copy('ai_settings.mcp_server.form.instructions.save_title')}</strong>
        {' '}{copy('ai_settings.mcp_server.form.instructions.save_description')}
        {serverTools.length > 0
          ? ` ${copy('ai_settings.mcp_server.form.instructions.tools_found')}`
          : ` ${copy('ai_settings.mcp_server.form.instructions.test_first')}`}
      </div>
    </div>

    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Button onClick={onTest} loading={loading} disabled={!validation.canTest} style={{ borderRadius: 10 }}>{copy('ai_settings.mcp_server.form.action.test')}</Button>
      <Button type="primary" onClick={onSave} loading={loading} disabled={!validation.canSave} style={{ borderRadius: 10, fontWeight: 600 }}>{copy('ai_settings.mcp_server.form.action.save')}</Button>
      <Popconfirm title={copy('ai_settings.mcp_server.form.action.delete_confirm')} okText={copy('ai_settings.mcp_server.form.action.delete_ok')} cancelText={copy('ai_settings.mcp_server.form.action.delete_cancel')} onConfirm={onDelete}>
        <Button danger icon={<DeleteOutlined />} style={{ borderRadius: 10 }}>{copy('ai_settings.mcp_server.form.action.delete')}</Button>
      </Popconfirm>
    </div>
  </>
  );
};

export default AIMCPServerFormPanel;
