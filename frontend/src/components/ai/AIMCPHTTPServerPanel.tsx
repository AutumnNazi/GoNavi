import React from 'react';
import { Button, Input, Switch, Tag } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AIMCPHTTPServerStatus } from '../../types';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

export interface AIMCPHTTPServerDraft {
  addr: string;
  path: string;
  authorizationHeader: string;
  /** false 时注册 execute_sql，允许查少量样例数据 */
  schemaOnly: boolean;
}

export interface AIMCPHTTPServerPanelProps {
  status: AIMCPHTTPServerStatus;
  draft: AIMCPHTTPServerDraft;
  loading: boolean;
  cardBg: string;
  cardBorder: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  onDraftChange: (patch: Partial<AIMCPHTTPServerDraft>) => void;
  onToggle: (checked: boolean) => void;
  onCopyURL: () => void;
  onCopyAuthorization: () => void;
}

const AIMCPHTTPServerPanel: React.FC<AIMCPHTTPServerPanelProps> = ({
  status,
  draft,
  loading,
  darkMode,
  overlayTheme,
  onDraftChange,
  onToggle,
  onCopyURL,
  onCopyAuthorization,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);
  const enabled = status?.enabled === true;
  const running = status?.running === true;
  const url = String(status?.url || '').trim();
  const authorizationHeader = String(status?.authorizationHeader || '').trim();
  const inputStyle: React.CSSProperties = {
    borderRadius: 10,
    background: darkMode ? 'rgba(15,23,42,0.82)' : '#fff',
    fontFamily: 'var(--gn-font-mono)',
  };

  return (
    <div
      className="gonavi-ai-mcp-http-panel"
      style={{
        padding: '14px 0 0',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', paddingBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: overlayTheme.titleText }}>
              {copy('ai_settings.mcp_http.panel.title')}
            </div>
            <Tag color={running ? 'success' : 'default'} style={{ marginInlineEnd: 0 }}>
              {copy(running ? 'ai_settings.mcp_http.panel.status.running' : 'ai_settings.mcp_http.panel.status.stopped')}
            </Tag>
            <Tag color={draft.schemaOnly || status.schemaOnly ? 'blue' : 'green'} style={{ marginInlineEnd: 0 }}>
              {draft.schemaOnly || (running && status.schemaOnly)
                ? copy('ai_settings.mcp_http.panel.mode.schema_only')
                : copy('ai_settings.mcp_http.panel.mode.limited_query')}
            </Tag>
          </div>
        </div>
        <Switch
          aria-label={`${copy('ai_settings.mcp_http.panel.title')}: ${copy(enabled ? 'ai_settings.mcp_http.panel.switch.on' : 'ai_settings.mcp_http.panel.switch.off')}`}
          checked={enabled}
          loading={loading}
          onChange={onToggle}
        />
      </div>
      {enabled && !running && status.message && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 0 10px', color: '#dc2626', fontSize: 12 }}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{status.message}</span>
          <Button size="small" disabled={loading} onClick={() => onToggle(true)} style={{ flexShrink: 0 }}>
            {copy('ai_settings.mcp_http.panel.retry_start')}
          </Button>
        </div>
      )}
      <details className="gonavi-ai-mcp-disclosure gonavi-ai-mcp-http-disclosure">
        <summary>
          <span style={{ fontWeight: 700, color: overlayTheme.titleText }}>
            {copy('ai_settings.mcp_http.panel.details_summary')}
          </span>
          <span className="gonavi-ai-mcp-summary-note" style={{ color: overlayTheme.mutedText }}>
            {copy('ai_settings.mcp_http.panel.description')}
          </span>
        </summary>
        <div
          style={{
            background: 'transparent',
            padding: '4px 0 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--gn-font-size-sm, 12px)', fontWeight: 700, color: overlayTheme.mutedText }}>
              {copy('ai_settings.mcp_http.panel.addr_label')}
            </span>
            <Input
              size="small"
              value={draft.addr}
              disabled={running || loading}
              placeholder="127.0.0.1:8765"
              onChange={(event) => onDraftChange({ addr: event.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--gn-font-size-sm, 12px)', fontWeight: 700, color: overlayTheme.mutedText }}>Authorization</span>
            <Input.Password
              size="small"
              value={draft.authorizationHeader}
              disabled={loading}
              readOnly={running || loading}
              placeholder={copy('ai_settings.mcp_http.panel.authorization_placeholder')}
              autoComplete="off"
              onChange={(event) => onDraftChange({ authorizationHeader: event.target.value })}
              style={inputStyle}
            />
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>
              {copy('ai_settings.mcp_http.panel.limited_query.label')}
            </div>
            <div style={{ marginTop: 2, fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText, lineHeight: 1.6 }}>
              {copy('ai_settings.mcp_http.panel.limited_query.hint')}
            </div>
          </div>
          <Switch
            aria-label={`${copy('ai_settings.mcp_http.panel.limited_query.label')}: ${copy(!draft.schemaOnly ? 'ai_settings.mcp_http.panel.limited_query.on' : 'ai_settings.mcp_http.panel.limited_query.off')}`}
            checked={!draft.schemaOnly}
            disabled={running || loading}
            onChange={(checked) => onDraftChange({ schemaOnly: !checked })}
          />
        </div>
          {!(enabled && !running && status.message) && (
            <div style={{ fontSize: 12, color: overlayTheme.mutedText, lineHeight: 1.7 }}>
              {running
                ? status.message || copy('ai_settings.mcp_http.panel.running_hint')
                : copy('ai_settings.mcp_http.panel.stopped_hint')}
            </div>
          )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <code
            style={{
              fontSize: 12,
              color: overlayTheme.titleText,
              background: darkMode ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.04)',
              borderRadius: 4,
              padding: '4px 7px',
            }}
          >
            {url || 'http://127.0.0.1:8765/mcp'}
          </code>
          <Button size="small" icon={<CopyOutlined />} disabled={!running || !url} onClick={onCopyURL}>
            {copy('ai_settings.mcp_http.panel.copy_url')}
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={!running || !authorizationHeader}
            onClick={onCopyAuthorization}
          >
            {copy('ai_settings.mcp_http.panel.copy_authorization')}
          </Button>
        </div>
        </div>
      </details>
    </div>
  );
};

export default AIMCPHTTPServerPanel;
